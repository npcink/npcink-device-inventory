use anyhow::Result;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use local_ip_address::list_afinet_netifas;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::net::IpAddr;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::{
    Components, CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System,
};

mod platform;

const RUNTIME_HISTORY_MAX_SAMPLES: usize = 8_640;
const ADVANCED_RUNTIME_CACHE_TTL: Duration = Duration::from_secs(15);
pub const INVENTORY_SCHEMA: &str = "npcink-hardware-inventory-v3";
static RUNTIME_HISTORY: OnceLock<Mutex<VecDeque<Value>>> = OnceLock::new();
static ADVANCED_RUNTIME_CACHE: OnceLock<Mutex<Option<(Instant, Value)>>> = OnceLock::new();

/// Both local inspection and normal uploads use the same complete hardware inventory.
pub fn collect_static_data() -> Result<Value> {
    platform::with_collection_budget(|| collect_inventory_with(platform::enrich))
}

pub fn collect_upload_data() -> Result<Value> {
    collect_static_data()
}

pub(crate) fn collect_inventory_with(
    enrich: impl FnOnce(&mut Map<String, Value>),
) -> Result<Value> {
    let system = System::new_with_specifics(
        RefreshKind::new()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    );

    let disks = Disks::new_with_refreshed_list();
    let networks = Networks::new_with_refreshed_list();
    let network_ips = network_ip_map();
    let macs = collect_macs(&networks, &network_ips);
    let hardware_uuid = platform::hardware_uuid().unwrap_or_default();

    let mut root = Map::new();
    root.insert("os".to_string(), collect_os());
    root.insert("cpu".to_string(), collect_cpu(&system));
    root.insert("mem".to_string(), collect_memory(&system));
    root.insert("memLayout".to_string(), json!([]));
    root.insert("fsSize".to_string(), collect_fs_size(&disks));
    root.insert("system".to_string(), collect_system(&hardware_uuid));
    root.insert("diskLayout".to_string(), collect_disks(&disks));
    root.insert("net".to_string(), collect_networks(&networks, &network_ips));
    root.insert(
        "uuid".to_string(),
        json!({ "hardware": hardware_uuid, "macs": macs }),
    );
    root.insert(
        "collector".to_string(),
        json!({
            "name": env!("CARGO_PKG_NAME"),
            "version": env!("CARGO_PKG_VERSION"),
            "runtime": "rust",
            "schema": INVENTORY_SCHEMA,
            "observation_id": new_observation_id(),
            "collected_at": Utc::now().to_rfc3339(),
        }),
    );

    finish_identity_collection(root, enrich)
}

pub fn valid_observation_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            14 => b == b'4',
            19 => matches!(b, b'8' | b'9' | b'a' | b'b'),
            _ => b.is_ascii_digit() || (b'a'..=b'f').contains(&b),
        })
}

fn new_observation_id() -> String {
    use rand::RngCore;
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|value| format!("{value:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

pub fn collect_runtime_status() -> Result<Value> {
    let system = System::new_with_specifics(
        RefreshKind::new()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    );

    let disks = Disks::new_with_refreshed_list();
    let networks = Networks::new_with_refreshed_list();
    let network_ips = network_ip_map();
    let components = Components::new_with_refreshed_list();

    let cpu_usage = system.global_cpu_info().cpu_usage();
    let total_memory = system.total_memory();
    let available_memory = system.available_memory();
    let used_memory = match system.used_memory() {
        used if used > 0 => used.min(total_memory),
        _ if available_memory > 0 => total_memory.saturating_sub(available_memory),
        _ => 0,
    };
    let (total_disk, available_disk, disk_mount) = runtime_disk_usage(&disks);
    let used_disk = total_disk.saturating_sub(available_disk);
    let default_net = collect_networks(&networks, &network_ips)
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| {
                    item.get("default")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .or_else(|| items.first())
        })
        .cloned()
        .unwrap_or_else(|| json!({}));

    let temperatures = components
        .iter()
        .filter_map(|component| {
            let temperature = component.temperature();
            if !temperature.is_finite() || !(0.0..=130.0).contains(&temperature) {
                return None;
            }
            Some(json!({
                "label": component.label(),
                "temperature_c": temperature,
                "critical_c": component.critical(),
            }))
        })
        .collect::<Vec<_>>();

    let status = json!({
        "collected_at": Utc::now().to_rfc3339(),
        "cpu": {
            "usage_percent": cpu_usage,
            "cores": system.cpus().len(),
        },
        "memory": {
            "total": total_memory,
            "used": used_memory,
            "available": available_memory,
        },
        "disk": {
            "total": total_disk,
            "used": used_disk,
            "available": available_disk,
            "mount": disk_mount,
        },
        "network": default_net,
        "temperatures": temperatures,
        "advanced": collect_advanced_runtime_status(),
    });
    record_runtime_sample(&status);
    Ok(status)
}

pub fn runtime_history(range_minutes: Option<u64>) -> Value {
    Value::Array(runtime_history_samples(range_minutes))
}

pub fn runtime_history_summary(range_minutes: Option<u64>) -> Value {
    let samples = runtime_history_samples(range_minutes);
    runtime_history_summary_for_samples(&samples, range_minutes)
}

pub fn runtime_chart(range_minutes: Option<u64>, max_points: usize) -> Value {
    let samples = runtime_history_samples(range_minutes);
    let max_points = max_points.clamp(2, 240);
    let chart_samples = downsample_runtime_samples(&samples, max_points);
    let timestamps = chart_samples
        .iter()
        .filter_map(sample_collected_at)
        .map(|time| time.timestamp())
        .collect::<Vec<_>>();

    json!({
        "sample_count": samples.len(),
        "point_count": chart_samples.len(),
        "points": {
            "time": timestamps,
            "cpu": chart_values(&chart_samples, |sample| number_at(sample, "/cpu/usage_percent")),
            "memory": chart_values(&chart_samples, runtime_memory_used_percent),
            "temperature": chart_values(&chart_samples, primary_runtime_temperature),
            "power": chart_values(&chart_samples, |sample| number_at(sample, "/advanced/system_power_w")),
            "gpu": chart_values(&chart_samples, |sample| number_at(sample, "/advanced/gpu_usage_percent")),
        },
    })
}

fn runtime_history_store() -> &'static Mutex<VecDeque<Value>> {
    RUNTIME_HISTORY.get_or_init(|| Mutex::new(VecDeque::with_capacity(RUNTIME_HISTORY_MAX_SAMPLES)))
}

fn record_runtime_sample(status: &Value) {
    let Ok(mut samples) = runtime_history_store().lock() else {
        return;
    };
    samples.push_back(status.clone());
    while samples.len() > RUNTIME_HISTORY_MAX_SAMPLES {
        samples.pop_front();
    }
}

fn runtime_history_samples(range_minutes: Option<u64>) -> Vec<Value> {
    let samples = runtime_history_store()
        .lock()
        .map(|samples| samples.iter().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    let Some(range_minutes) = range_minutes.filter(|minutes| *minutes > 0) else {
        return samples;
    };
    let cutoff = Utc::now() - ChronoDuration::minutes(range_minutes as i64);
    samples
        .into_iter()
        .filter(|sample| {
            sample_collected_at(sample)
                .map(|collected_at| collected_at >= cutoff)
                .unwrap_or(false)
        })
        .collect()
}

fn runtime_history_summary_for_samples(samples: &[Value], range_minutes: Option<u64>) -> Value {
    let cpu_values = sample_numbers(samples, "/cpu/usage_percent");
    let memory_used_values = sample_numbers(samples, "/memory/used");
    let temperature_values = samples
        .iter()
        .filter_map(primary_runtime_temperature)
        .collect::<Vec<_>>();
    let system_power_values = sample_numbers(samples, "/advanced/system_power_w");
    let gpu_usage_values = sample_numbers(samples, "/advanced/gpu_usage_percent");
    let swap_used_values = sample_numbers(samples, "/advanced/swap_used");
    let latest = samples.last();

    json!({
        "sample_count": samples.len(),
        "range_minutes": range_minutes,
        "started_at": samples.first().and_then(sample_collected_at).map(|time| time.to_rfc3339()),
        "ended_at": latest.and_then(sample_collected_at).map(|time| time.to_rfc3339()),
        "advanced_available": samples.iter().any(|sample| sample.pointer("/advanced/available").and_then(Value::as_bool).unwrap_or(false)),
        "cpu": {
            "latest_percent": latest.and_then(|sample| number_at(sample, "/cpu/usage_percent")),
            "average_percent": average(&cpu_values),
            "max_percent": max_number(&cpu_values),
        },
        "memory": {
            "latest_used_bytes": latest.and_then(|sample| u64_at(sample, "/memory/used")),
            "latest_total_bytes": latest.and_then(|sample| u64_at(sample, "/memory/total")),
            "max_used_bytes": max_number(&memory_used_values).map(|value| value as u64),
            "max_used_percent": max_memory_used_percent(samples),
        },
        "disk": {
            "latest_used_bytes": latest.and_then(|sample| u64_at(sample, "/disk/used")),
            "latest_available_bytes": latest.and_then(|sample| u64_at(sample, "/disk/available")),
            "latest_total_bytes": latest.and_then(|sample| u64_at(sample, "/disk/total")),
            "mount": latest.and_then(|sample| sample.pointer("/disk/mount")).and_then(Value::as_str),
        },
        "temperature": {
            "latest_c": latest.and_then(primary_runtime_temperature),
            "max_c": max_number(&temperature_values),
        },
        "power": {
            "latest_system_w": latest.and_then(|sample| number_at(sample, "/advanced/system_power_w")),
            "average_system_w": average(&system_power_values),
            "max_system_w": max_number(&system_power_values),
        },
        "gpu": {
            "latest_usage_percent": latest.and_then(|sample| number_at(sample, "/advanced/gpu_usage_percent")),
            "max_usage_percent": max_number(&gpu_usage_values),
        },
        "swap": {
            "latest_used_bytes": latest.and_then(|sample| u64_at(sample, "/advanced/swap_used")),
            "latest_total_bytes": latest.and_then(|sample| u64_at(sample, "/advanced/swap_total")),
            "max_used_bytes": max_number(&swap_used_values).map(|value| value as u64),
        },
    })
}

fn sample_collected_at(sample: &Value) -> Option<DateTime<Utc>> {
    let text = sample.get("collected_at")?.as_str()?;
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|time| time.with_timezone(&Utc))
}

fn sample_numbers(samples: &[Value], pointer: &str) -> Vec<f64> {
    samples
        .iter()
        .filter_map(|sample| number_at(sample, pointer))
        .collect()
}

fn number_at(sample: &Value, pointer: &str) -> Option<f64> {
    sample.pointer(pointer).and_then(|value| {
        value
            .as_f64()
            .or_else(|| value.as_u64().map(|number| number as f64))
    })
}

fn u64_at(sample: &Value, pointer: &str) -> Option<u64> {
    sample.pointer(pointer).and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_f64().map(|number| number as u64))
    })
}

fn primary_runtime_temperature(sample: &Value) -> Option<f64> {
    number_at(sample, "/advanced/cpu_temperature_c").or_else(|| {
        sample
            .get("temperatures")
            .and_then(Value::as_array)
            .and_then(|temperatures| {
                temperatures
                    .iter()
                    .find_map(|item| number_at(item, "/temperature_c"))
            })
    })
}

fn average(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    Some(values.iter().sum::<f64>() / values.len() as f64)
}

fn max_number(values: &[f64]) -> Option<f64> {
    values.iter().copied().reduce(f64::max)
}

fn max_memory_used_percent(samples: &[Value]) -> Option<f64> {
    samples
        .iter()
        .filter_map(runtime_memory_used_percent)
        .reduce(f64::max)
}

fn runtime_memory_used_percent(sample: &Value) -> Option<f64> {
    let used = number_at(sample, "/memory/used")?;
    let total = number_at(sample, "/memory/total")?;
    if total <= 0.0 {
        return None;
    }
    Some((used / total) * 100.0)
}

fn downsample_runtime_samples(samples: &[Value], max_points: usize) -> Vec<Value> {
    if samples.len() <= max_points {
        return samples.to_vec();
    }
    let bucket_size = samples.len().div_ceil(max_points);
    samples
        .chunks(bucket_size)
        .filter_map(|bucket| bucket.last().cloned())
        .collect()
}

fn chart_values<F>(samples: &[Value], getter: F) -> Vec<Value>
where
    F: Fn(&Value) -> Option<f64>,
{
    samples
        .iter()
        .map(|sample| getter(sample).map_or(Value::Null, Value::from))
        .collect()
}

fn collect_advanced_runtime_status() -> Value {
    let cache = ADVANCED_RUNTIME_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(cache) = cache.lock() {
        if let Some((created_at, value)) = cache.as_ref() {
            if created_at.elapsed() < ADVANCED_RUNTIME_CACHE_TTL {
                return value.clone();
            }
        }
    }

    let value = collect_advanced_runtime_status_uncached();
    if let Ok(mut cache) = cache.lock() {
        *cache = Some((Instant::now(), value.clone()));
    }
    value
}

fn collect_advanced_runtime_status_uncached() -> Value {
    if !cfg!(target_os = "macos") {
        return json!({
            "available": false,
            "source": "none",
            "reason": "当前平台暂不支持高级温度/功耗监控",
        });
    }

    let Some(macmon_path) = find_executable("macmon") else {
        return json!({
            "available": false,
            "source": "macmon",
            "reason": "未检测到 macmon，基础监控仍可使用",
        });
    };

    let output = command_output_with_timeout(
        &macmon_path,
        &["pipe", "-s", "0", "-i", "1000"],
        Duration::from_secs(5),
    )
    .map_err(|error| error.to_string());

    let output = match output {
        Ok(output) => output,
        Err(error) => {
            return json!({
                "available": false,
                "source": "macmon",
                "reason": format!("macmon 启动失败：{error}"),
            });
        }
    };

    if output.timed_out && output.stdout.is_empty() {
        return json!({
            "available": false,
            "source": "macmon",
            "reason": "macmon 采样超时，基础监控仍可使用",
        });
    }

    if !output.success && output.stdout.is_empty() {
        return json!({
            "available": false,
            "source": "macmon",
            "reason": if output.stderr.trim().is_empty() { "macmon 未返回有效数据".to_string() } else { output.stderr },
        });
    }

    let Some(line) = output.stdout.lines().find(|line| !line.trim().is_empty()) else {
        return json!({
            "available": false,
            "source": "macmon",
            "reason": "macmon 输出为空",
        });
    };

    let payload: Value = match serde_json::from_str(line) {
        Ok(payload) => payload,
        Err(error) => {
            return json!({
                "available": false,
                "source": "macmon",
                "reason": format!("macmon 输出解析失败：{error}"),
            });
        }
    };

    json!({
        "available": true,
        "source": "macmon",
        "timestamp": payload.get("timestamp").and_then(Value::as_str),
        "cpu_temperature_c": value_f64(&payload, "/temp/cpu_temp_avg"),
        "gpu_temperature_c": value_f64(&payload, "/temp/gpu_temp_avg"),
        "cpu_power_w": value_f64(&payload, "/cpu_power"),
        "gpu_power_w": value_f64(&payload, "/gpu_power"),
        "system_power_w": value_f64(&payload, "/sys_power"),
        "performance_cpu_usage_percent": usage_percent(payload.get("pcpu_usage")),
        "efficiency_cpu_usage_percent": usage_percent(payload.get("ecpu_usage")),
        "gpu_usage_percent": usage_percent(payload.get("gpu_usage")),
        "memory_used": value_u64(&payload, "/memory/ram_usage"),
        "memory_total": value_u64(&payload, "/memory/ram_total"),
        "swap_used": value_u64(&payload, "/memory/swap_usage"),
        "swap_total": value_u64(&payload, "/memory/swap_total"),
    })
}

struct CommandOutput {
    success: bool,
    timed_out: bool,
    stdout: String,
    stderr: String,
}

fn command_output_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> std::io::Result<CommandOutput> {
    let output = crate::command::output_with_timeout(
        new_command(program)
            .args(args)
            .env("PATH", command_search_path()),
        timeout,
    )?;
    Ok(CommandOutput {
        success: output.status.success() && !output.stdout_truncated,
        timed_out: output.timed_out,
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

fn new_command(program: &str) -> Command {
    let mut command = Command::new(program);
    configure_command_window(&mut command);
    command
}

#[cfg(target_os = "windows")]
fn configure_command_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_command_window(_command: &mut Command) {}

fn usage_percent(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_array)
        .and_then(|items| items.get(1))
        .and_then(Value::as_f64)
        .map(|value| value * 100.0)
}

fn value_f64(value: &Value, pointer: &str) -> Option<f64> {
    value.pointer(pointer).and_then(Value::as_f64)
}

fn value_u64(value: &Value, pointer: &str) -> Option<u64> {
    value.pointer(pointer).and_then(|item| {
        item.as_u64()
            .or_else(|| item.as_f64().map(|number| number as u64))
    })
}

fn find_executable(command: &str) -> Option<String> {
    command_search_path().split(':').find_map(|dir| {
        let path = std::path::Path::new(dir).join(command);
        if path.is_file() {
            Some(path.to_string_lossy().to_string())
        } else {
            None
        }
    })
}

fn command_search_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let fallbacks = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];
    let mut parts = current
        .split(':')
        .filter(|part| !part.trim().is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    for fallback in fallbacks {
        if !parts.iter().any(|part| part == fallback) {
            parts.push(fallback.to_string());
        }
    }
    parts.join(":")
}

fn runtime_disk_usage(disks: &Disks) -> (u64, u64, String) {
    if cfg!(target_os = "macos") {
        for mount in ["/", "/System/Volumes/Data"] {
            if let Some(disk) = disks
                .list()
                .iter()
                .find(|disk| disk.mount_point().to_string_lossy() == mount)
            {
                return (
                    disk.total_space(),
                    disk.available_space(),
                    mount.to_string(),
                );
            }
        }
    }

    let total = disks
        .list()
        .iter()
        .filter(|disk| !disk.mount_point().as_os_str().is_empty())
        .map(|disk| disk.total_space())
        .sum::<u64>();
    let available = disks
        .list()
        .iter()
        .filter(|disk| !disk.mount_point().as_os_str().is_empty())
        .map(|disk| disk.available_space())
        .sum::<u64>();

    (total, available, "all".to_string())
}

/// Server-compatible hardware identity v2 candidates, ordered from strongest
/// to weakest. CPU identifiers are intentionally excluded: the real-device
/// pilot showed identical model machines returning the same ProcessorId.
pub fn hardware_identities_v2(data: &Value) -> Vec<(&'static str, String)> {
    let mut identities = Vec::new();
    let system_uuid = data
        .pointer("/uuid/hardware")
        .and_then(Value::as_str)
        .and_then(normalize_identity_value)
        .or_else(|| {
            data.pointer("/system/uuid")
                .and_then(Value::as_str)
                .and_then(normalize_identity_value)
        });
    if let Some(system_uuid) = system_uuid {
        identities.push((
            "system_uuid_v2",
            identity_digest("system-v2", &format!("system_uuid={system_uuid}")),
        ));
    }

    let manufacturer = data
        .pointer("/baseboard/manufacturer")
        .and_then(Value::as_str)
        .and_then(normalize_identity_value);
    let model = data
        .pointer("/baseboard/product")
        .and_then(Value::as_str)
        .or_else(|| data.pointer("/baseboard/model").and_then(Value::as_str))
        .and_then(normalize_identity_value);
    let serial = data
        .pointer("/baseboard/serial")
        .and_then(Value::as_str)
        .or_else(|| {
            data.pointer("/baseboard/serialNumber")
                .and_then(Value::as_str)
        })
        .and_then(normalize_identity_value);
    if let (Some(manufacturer), Some(model), Some(serial)) =
        (manufacturer.as_ref(), model.as_ref(), serial)
    {
        identities.push((
            "baseboard_serial_v2",
            identity_digest(
                "board-v2",
                &format!(
                    "baseboard_manufacturer={manufacturer}|baseboard_model={model}|baseboard_serial={serial}"
                ),
            ),
        ));
    }

    if let (Some(manufacturer), Some(model)) = (manufacturer, model) {
        if let Some(cpu_model) = processor_model(data) {
            let mut macs = data
                .pointer("/networkHardware")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(permanent_pci_mac)
                .collect::<Vec<_>>();
            macs.sort();
            macs.dedup();
            for mac in macs.into_iter().take(8) {
                identities.push((
                    "pci_permanent_mac_v2",
                    identity_digest(
                        "pci-v2",
                        &format!(
                            "pci_permanent_mac={mac}|baseboard_manufacturer={manufacturer}|baseboard_model={model}|cpu_model={cpu_model}"
                        ),
                    ),
                ));
            }
        }
    }

    identities
}

fn permanent_pci_mac(item: &Value) -> Option<String> {
    let pci = item
        .get("pnpDeviceId")
        .and_then(Value::as_str)
        .is_some_and(|value| value.trim().to_ascii_uppercase().starts_with("PCI\\"));
    if !pci
        || item
            .get("virtual")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return None;
    }
    item.get("permanentAddress")
        .and_then(Value::as_str)
        .and_then(normalize_identity_mac)
}

fn finish_identity_collection(
    mut root: Map<String, Value>,
    enrich: impl FnOnce(&mut Map<String, Value>),
) -> Result<Value> {
    enrich(&mut root);
    let mut data = Value::Object(root);
    data["identityDiagnostics"] = identity_diagnostics(&data);
    Ok(data)
}

/// Status only; raw identifiers stay in hardware feedback, not error text.
pub fn identity_diagnostics(data: &Value) -> Value {
    let status = |paths: &[&str]| {
        let values: Vec<&str> = paths
            .iter()
            .filter_map(|path| data.pointer(path).and_then(Value::as_str))
            .collect();
        if values.iter().any(|v| normalize_identity_value(v).is_some()) {
            "valid"
        } else if values.iter().any(|v| !v.trim().is_empty()) {
            "invalid_placeholder"
        } else {
            "missing"
        }
    };
    let identities = hardware_identities_v2(data);
    let mac_count = data
        .get("networkHardware")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(permanent_pci_mac)
        .collect::<BTreeSet<_>>()
        .len();
    json!({
        "systemUuid": status(&["/uuid/hardware", "/system/uuid"]),
        "baseboardSerial": status(&["/baseboard/serial", "/baseboard/serialNumber"]),
        "baseboardManufacturer": status(&["/baseboard/manufacturer"]),
        "baseboardModel": status(&["/baseboard/product", "/baseboard/model"]),
        "processorModel": if processor_model(data).is_some() { "valid" } else { "missing" },
        "permanentPciMacCount": mac_count,
        "identityTypes": identities.iter().map(|(kind, _)| *kind).collect::<Vec<_>>(),
        "decision": if identities.is_empty() { "needs_review" } else { "ready" },
        "probeAttempts": data.get("identityProbeAttempts").cloned().unwrap_or(json!([])),
    })
}

pub fn hardware_identity_v2(data: &Value) -> Option<(&'static str, String)> {
    hardware_identities_v2(data).into_iter().next()
}

fn identity_digest(prefix: &str, source: &str) -> String {
    let digest = Sha256::digest(source.as_bytes());
    let full = format!("{:x}", digest);
    format!("{prefix}-{}", &full[..29])
}

fn processor_model(data: &Value) -> Option<String> {
    let mut models = data
        .pointer("/processorIdentity")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .filter_map(normalize_identity_value)
        .collect::<Vec<_>>();
    if models.is_empty() {
        if let Some(model) = data
            .pointer("/cpu/brand")
            .and_then(Value::as_str)
            .and_then(normalize_identity_value)
        {
            models.push(model);
        }
    }
    models.sort();
    models.dedup();
    (!models.is_empty()).then(|| models.join("+"))
}

fn normalize_identity_value(value: &str) -> Option<String> {
    let value = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    if value.is_empty() {
        return None;
    }
    let invalid = [
        "0",
        "00000000",
        "00000000-0000-0000-0000-000000000000",
        "03000200-0400-0500-0006-000700080009",
        "ffffffff",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "xxxxxxxx",
        "default string",
        "n/a",
        "na",
        "invalid",
        "undefined",
        "not applicable",
        "none",
        "null",
        "not specified",
        "not available",
        "not present",
        "not provided",
        "not set",
        "unknown",
        "to be filled by o.e.m.",
        "to be filled by oem",
        "not filled by o.e.m.",
        "system serial number",
        "-",
    ];
    let compact = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>();
    if invalid.contains(&value.as_str())
        || compact.is_empty()
        || compact.chars().all(|character| character == '0')
        || compact.chars().all(|character| character == 'x')
        || (compact.len() >= 8 && compact.chars().all(|character| character == 'f'))
    {
        return None;
    }
    Some(value)
}

fn normalize_identity_mac(value: &str) -> Option<String> {
    let compact = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .collect::<String>();
    if compact.len() != 12
        || compact.chars().all(|character| character == '0')
        || compact.chars().all(|character| character == 'f')
    {
        return None;
    }
    Some(
        compact
            .as_bytes()
            .chunks(2)
            .map(|chunk| std::str::from_utf8(chunk).unwrap_or_default())
            .collect::<Vec<_>>()
            .join(":"),
    )
}

fn collect_os() -> Value {
    json!({
        "arch": std::env::consts::ARCH,
        "platform": std::env::consts::OS,
        "hostname": System::host_name().unwrap_or_default(),
        "fqdn": Value::Null,
        "distro": System::long_os_version().or_else(System::name).unwrap_or_default(),
        "kernel": System::kernel_version().unwrap_or_default(),
        "release": System::os_version().unwrap_or_default(),
    })
}

fn collect_cpu(system: &System) -> Value {
    let first = system.cpus().first();
    json!({
        "brand": first.map(|cpu| cpu.brand()).unwrap_or_default(),
        "vendor": first.map(|cpu| cpu.vendor_id()).unwrap_or_default(),
        "currentFrequency": first.map(|cpu| cpu.frequency()).unwrap_or_default(),
        "cores": system.cpus().len(),
        "physicalCores": system.physical_core_count(),
        "processors": Value::Null,
    })
}

fn collect_memory(system: &System) -> Value {
    let used_memory = system
        .total_memory()
        .saturating_sub(system.available_memory());
    let used_swap = system.total_swap().saturating_sub(system.free_swap());
    json!({
        "total": system.total_memory(),
        "free": system.free_memory(),
        "available": system.available_memory(),
        "used": used_memory,
        "swapTotal": system.total_swap(),
        "swapFree": system.free_swap(),
        "swapUsed": used_swap,
    })
}

fn collect_system(hardware_uuid: &str) -> Value {
    json!({
        "manufacturer": "",
        "model": "",
        "version": "",
        "serial": "",
        "uuid": hardware_uuid,
        "sku": "",
    })
}

fn collect_disks(disks: &Disks) -> Value {
    Value::Array(
        disks
            .list()
            .iter()
            .filter(|disk| is_asset_disk_mount(&disk.mount_point().to_string_lossy()))
            .map(|disk| {
                json!({
                    "name": disk.name().to_string_lossy(),
                    "device": disk.name().to_string_lossy(),
                    "type": format!("{:?}", disk.kind()),
                    "fsType": disk.file_system().to_string_lossy(),
                    "mount": disk.mount_point().to_string_lossy(),
                    "size": disk.total_space(),
                })
            })
            .collect(),
    )
}

fn collect_fs_size(disks: &Disks) -> Value {
    Value::Array(
        disks
            .list()
            .iter()
            .map(|disk| {
                json!({
                    "name": disk.name().to_string_lossy(),
                    "fsType": disk.file_system().to_string_lossy(),
                    "type": format!("{:?}", disk.kind()),
                    "size": disk.total_space(),
                    "used": disk.total_space().saturating_sub(disk.available_space()),
                    "available": disk.available_space(),
                    "mount": disk.mount_point().to_string_lossy(),
                })
            })
            .collect(),
    )
}

fn is_asset_disk_mount(mount: &str) -> bool {
    if cfg!(target_os = "macos") {
        return mount == "/";
    }
    !mount.is_empty()
}

fn collect_networks(networks: &Networks, ips: &BTreeMap<String, Vec<IpAddr>>) -> Value {
    let mut rows = Vec::new();

    for (iface, data) in networks.iter() {
        let (ip4, ip6) = iface_ips(iface, ips);
        let internal = is_internal_iface(iface, &ip4, &ip6);
        let virtual_iface = is_virtual_iface(iface);
        let addresses: Vec<String> = ips
            .get(iface)
            .into_iter()
            .flatten()
            .map(ToString::to_string)
            .collect();

        rows.push(json!({
            "iface": iface,
            "ifaceName": iface,
            "ip4": ip4,
            "ip6": ip6,
            "mac": data.mac_address().to_string(),
            "default": null,
            "addresses": addresses,
            "internal": internal,
            "virtual": virtual_iface,
            "operstate": "unknown",
        }));
    }

    Value::Array(rows)
}

fn collect_macs(networks: &Networks, ips: &BTreeMap<String, Vec<IpAddr>>) -> Vec<String> {
    let mut primary = Vec::new();
    let mut secondary = Vec::new();

    for (iface, data) in networks.iter() {
        let mac = data.mac_address().to_string().to_lowercase();
        if mac != "00:00:00:00:00:00" && mac != "ff:ff:ff:ff:ff:ff" {
            let (ip4, ip6) = iface_ips(iface, ips);
            if is_internal_iface(iface, &ip4, &ip6) || is_virtual_iface(iface) {
                continue;
            }
            let active = has_routable_ip(&ip4, &ip6);
            if active {
                primary.push(mac);
            } else {
                secondary.push(mac);
            }
        }
    }

    let mut seen = BTreeSet::new();
    let selected = if primary.is_empty() {
        secondary
    } else {
        primary
    };

    selected
        .into_iter()
        .filter(|mac| seen.insert(mac.clone()))
        .collect()
}

fn iface_ips(iface: &str, ips: &BTreeMap<String, Vec<IpAddr>>) -> (String, String) {
    let iface_ips = ips.get(iface).cloned().unwrap_or_default();
    let ip4 = iface_ips
        .iter()
        .find_map(|ip| match ip {
            IpAddr::V4(value) => Some(value.to_string()),
            IpAddr::V6(_) => None,
        })
        .unwrap_or_default();
    let ip6 = iface_ips
        .iter()
        .find_map(|ip| match ip {
            IpAddr::V4(_) => None,
            IpAddr::V6(value) => Some(value.to_string()),
        })
        .unwrap_or_default();
    (ip4, ip6)
}

fn network_ip_map() -> BTreeMap<String, Vec<IpAddr>> {
    let mut map = BTreeMap::new();
    if let Ok(entries) = list_afinet_netifas() {
        for (iface, ip) in entries {
            map.entry(iface).or_insert_with(Vec::new).push(ip);
        }
    }
    map
}

fn is_internal_iface(iface: &str, ip4: &str, ip6: &str) -> bool {
    let lower = iface.to_ascii_lowercase();
    lower == "lo" || lower == "lo0" || ip4.starts_with("127.") || ip6 == "::1"
}

fn has_routable_ip(ip4: &str, ip6: &str) -> bool {
    (!ip4.is_empty() && !ip4.starts_with("127."))
        || (!ip6.is_empty() && ip6 != "::1" && !ip6.to_ascii_lowercase().starts_with("fe80:"))
}

fn is_virtual_iface(iface: &str) -> bool {
    let lower = iface.to_ascii_lowercase();
    if [
        "anpi", "ap", "awdl", "bridge", "gif", "llw", "p2p", "stf", "utun",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
    {
        return true;
    }

    ["virtual", "vmware", "vbox", "docker"]
        .iter()
        .any(|needle| lower.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::{hardware_identities_v2, hardware_identity_v2};
    use serde_json::{json, Value};

    #[test]
    fn hardware_v2_keeps_independent_strong_signals_and_ignores_replaceable_parts() {
        let first = json!({
            "uuid": {"hardware": "4C4C4544-0059-4710-8030-C8C04F354633"},
            "baseboard": {"manufacturer": "Dell Inc.", "product": "0MJF5P", "serial": "BOARD-103"},
            "processorIdentity": [{"name": "Intel Core i3", "processorId": "SHARED-ID"}],
            "networkHardware": [{"pnpDeviceId": "PCI\\VEN_10EC", "permanentAddress": "B07B25217BA0", "virtual": false}],
            "diskLayout": [{"serialNum": "DISK-ONE"}],
        });
        let mut replaced_parts = first.clone();
        replaced_parts["diskLayout"] = json!([{"serialNum": "DISK-TWO"}]);
        replaced_parts["memLayout"] = json!([{"serialNum": "RAM-TWO"}]);
        replaced_parts["graphics"] = json!({"controllers": [{"model": "GPU-TWO"}]});

        let identities = hardware_identities_v2(&first);
        assert_eq!(identities.len(), 3);
        assert_eq!(identities[0].0, "system_uuid_v2");
        assert_eq!(identities[0].1, "system-v2-4635fbe8792530e34dc720faffa63");
        assert_eq!(identities[1].0, "baseboard_serial_v2");
        assert_eq!(identities[2].0, "pci_permanent_mac_v2");
        assert_eq!(identities, hardware_identities_v2(&replaced_parts));
    }

    #[test]
    fn hardware_v2_uses_permanent_pci_mac_but_never_usb_or_current_mac() {
        let fallback = json!({
            "uuid": {"hardware": "03000200-0400-0500-0006-000700080009"},
            "baseboard": {"manufacturer": "KOLOE", "product": "H610M4-PLUS", "serial": "Default string"},
            "processorIdentity": [{"name": "12th Gen Intel Core i5", "processorId": "SHARED-ID"}],
            "networkHardware": [{"pnpDeviceId": "PCI\\VEN_10EC", "permanentAddress": "00E01E84A499", "macAddress": "00-E0-1E-84-A4-98", "virtual": false}],
        });
        assert_eq!(
            hardware_identity_v2(&fallback).map(|identity| identity.0),
            Some("pci_permanent_mac_v2")
        );

        let mut usb = fallback.clone();
        usb["networkHardware"][0]["pnpDeviceId"] = json!("USB\\VID_1234");
        assert_eq!(hardware_identity_v2(&usb), None);

        let mut current_only = fallback;
        current_only["networkHardware"][0]["permanentAddress"] = Value::Null;
        assert_eq!(hardware_identity_v2(&current_only), None);
    }

    #[test]
    fn processor_id_does_not_merge_identical_model_computers() {
        let first = json!({
            "uuid": {"hardware": "SYSTEM-103"},
            "baseboard": {"manufacturer": "Dell", "product": "Vostro 3690", "serial": "BOARD-103"},
            "processorIdentity": [{"name": "Intel Core i3-10105", "processorId": "BFEBFBFF000A0653"}],
        });
        let second = json!({
            "uuid": {"hardware": "SYSTEM-174"},
            "baseboard": {"manufacturer": "Dell", "product": "Vostro 3690", "serial": "BOARD-174"},
            "processorIdentity": [{"name": "Intel Core i3-10105", "processorId": "BFEBFBFF000A0653"}],
        });
        assert_ne!(hardware_identity_v2(&first), hardware_identity_v2(&second));
    }

    #[test]
    fn hardware_v2_matches_the_php_golden_vectors() {
        let data = json!({
            "uuid": {"hardware": " BOARD-UUID "},
            "baseboard": {"manufacturer": " Example  Inc ", "product": "Board Pro", "serial": "BOARD-001"},
            "processorIdentity": [{"name": " Example CPU ", "processorId": "SHARED-CPU-ID"}],
            "networkHardware": [{"pnpDeviceId": "PCI\\VEN_1234", "permanentAddress": "AA-BB-CC-DD-EE-01", "virtual": false}],
        });
        assert_eq!(
            hardware_identities_v2(&data),
            vec![
                (
                    "system_uuid_v2",
                    "system-v2-fafa4bc231d7a48614a0bfd9e0ac3".to_string()
                ),
                (
                    "baseboard_serial_v2",
                    "board-v2-13d1184332c87ed6ea9c461d7c270".to_string()
                ),
                (
                    "pci_permanent_mac_v2",
                    "pci-v2-9cd7c81afd4a5c0f01e33532ec11a".to_string()
                ),
            ]
        );
    }
}
