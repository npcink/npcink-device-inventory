//! Fixed probe registry and bounded streaming PowerShell scheduler.
use super::*;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

pub(super) struct Probe {
    pub source: &'static str,
    pub command: &'static str,
    lane: &'static str,
}

const PROBES: &[Probe] = &[
    Probe { source: "system_product", command: "Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "core_a" },
    Probe { source: "memory_modules", command: "Get-CimInstance Win32_PhysicalMemory -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "core_a" },
    Probe { source: "physical_disks", command: "Get-CimInstance Win32_DiskDrive -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "core_a" },
    Probe { source: "baseboard", command: "Get-CimInstance Win32_BaseBoard -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "core_a" },
    Probe { source: "memory_arrays", command: "Get-CimInstance Win32_PhysicalMemoryArray -ErrorAction Stop | Where-Object { $_.Use -eq 3 } | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "core_a" },
    Probe { source: "storage_devices", command: "Get-PhysicalDisk -ErrorAction Stop | Select-Object FriendlyName,SerialNumber,UniqueId,DeviceId,MediaType,BusType,Size,HealthStatus,OperationalStatus,FirmwareVersion,PhysicalLocation", lane: "core_a" },
    Probe { source: "network_configuration", command: r#"$interfaces = @(Get-NetIPInterface -ErrorAction Stop); $routes = @(Get-NetRoute -ErrorAction Stop | Where-Object { $_.DestinationPrefix -in @('0.0.0.0/0','::/0') -and $_.State -eq 'Alive' } | Select-Object InterfaceIndex,NextHop,DestinationPrefix,RouteMetric,@{Name='InterfaceMetric';Expression={ $idx=$_.InterfaceIndex; $family=$_.AddressFamily; ($interfaces | Where-Object { $_.InterfaceIndex -eq $idx -and $_.AddressFamily -eq $family } | Select-Object -First 1).InterfaceMetric }}); Get-NetIPConfiguration -All -ErrorAction Stop | Select-Object InterfaceAlias,InterfaceIndex,@{Name='InterfaceGuid';Expression={$_.NetAdapter.InterfaceGuid}},@{Name='Status';Expression={$_.NetAdapter.Status}},@{Name='LinkSpeed';Expression={$_.NetAdapter.LinkSpeed}},@{Name='IPv4DefaultGateway';Expression={$_.IPv4DefaultGateway.NextHop}},@{Name='IPv6DefaultGateway';Expression={$_.IPv6DefaultGateway.NextHop}},@{Name='DnsServers';Expression={$_.DNSServer.ServerAddresses}},@{Name='Dhcp';Expression={$_.NetIPv4Interface.Dhcp}},@{Name='DefaultRoutes';Expression={ $idx=$_.InterfaceIndex; @($routes | Where-Object { $_.InterfaceIndex -eq $idx }) }}"#, lane: "core_a" },
    Probe { source: "physical_hidden", command: WINDOWS_NETWORK_HARDWARE_COMMANDS[0], lane: "core_b" },
    Probe { source: "processors", command: "Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "core_b" },
    Probe { source: "system", command: "Get-CimInstance Win32_ComputerSystem -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "core_b" },
    Probe { source: "bios", command: "Get-CimInstance Win32_BIOS -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "core_b" },
    Probe { source: "video_controllers", command: "Get-CimInstance Win32_VideoController -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "core_b" },
    Probe { source: "graphics_memory", command: WINDOWS_DXGI_QUERY, lane: "core_b" },
    Probe { source: "operating_system", command: "Get-CimInstance Win32_OperatingSystem -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "core_b" },
    Probe { source: "monitor_edid", command: "Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID -ErrorAction Stop | Select-Object InstanceName,Active,ManufacturerName,UserFriendlyName,SerialNumberID,YearOfManufacture,WeekOfManufacture", lane: "optional_a" },
    Probe { source: "desktop_monitors", command: "Get-CimInstance Win32_DesktopMonitor -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "optional_a" },
    Probe { source: "batteries", command: "Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "optional_a" },
    Probe { source: "chassis", command: "Get-CimInstance Win32_SystemEnclosure -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "optional_a" },
    Probe { source: "audio", command: "Get-CimInstance Win32_SoundDevice -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "optional_a" },
    Probe { source: "cameras", command: "Get-CimInstance Win32_PnPEntity -Filter \"PNPClass='Camera' OR PNPClass='Image'\" -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "optional_a" },
    Probe { source: "disk_partitions", command: "Get-CimInstance Win32_DiskPartition -ErrorAction Stop | Select-Object DeviceID,DiskIndex,Index,Size,StartingOffset,Type,BootPartition,PrimaryPartition", lane: "optional_storage" },
    Probe { source: "disk_partition_links", command: "Get-CimInstance Win32_DiskDriveToDiskPartition -ErrorAction Stop | Select-Object @{Name='diskDevice';Expression={$_.Antecedent.DeviceID}},@{Name='partitionDevice';Expression={$_.Dependent.DeviceID}}", lane: "optional_storage" },
    Probe { source: "partition_volume_links", command: "Get-CimInstance Win32_LogicalDiskToPartition -ErrorAction Stop | Select-Object @{Name='partitionDevice';Expression={$_.Antecedent.DeviceID}},@{Name='volumeDevice';Expression={$_.Dependent.DeviceID}},StartingAddress,EndingAddress", lane: "optional_storage" },
    Probe { source: "secure_boot", command: r"Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' -Name UEFISecureBootEnabled -ErrorAction Stop | Select-Object UEFISecureBootEnabled", lane: "optional_b" },
    Probe { source: "tpm", command: "Get-Tpm -ErrorAction Stop | Select-Object TpmPresent,TpmReady,TpmEnabled,TpmActivated,TpmOwned,RestartPending,ManufacturerIdTxt,ManufacturerVersion,ManufacturerVersionFull20,ManagedAuthLevel,AutoProvisioning,LockedOut,LockoutHealTime,LockoutCount,LockoutMax", lane: "optional_b" },
    Probe { source: "usb", command: "Get-CimInstance Win32_PnPEntity -Filter \"PNPClass='USB'\" -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "optional_b" },
    Probe { source: "printers", command: "Get-CimInstance Win32_Printer -ErrorAction Stop | Select-Object * -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName", lane: "optional_b" },
    Probe { source: "storage_health", command: "Get-PhysicalDisk -ErrorAction Stop | ForEach-Object { $disk = $_; try { $disk | Get-StorageReliabilityCounter -ErrorAction Stop | Select-Object -Property *,@{Name='StorageUniqueId';Expression={$disk.UniqueId}} -ExcludeProperty CimClass,CimInstanceProperties,CimSystemProperties,PSComputerName } catch { Write-NpcinkItemFailure $_ @{StorageUniqueId=$disk.UniqueId} } }", lane: "optional_storage" },
];

pub(super) fn probe(source: &str) -> &'static Probe {
    PROBES
        .iter()
        .find(|probe| probe.source == source)
        .expect("fixed probe registry")
}

#[derive(Debug)]
struct ProbeResult {
    value: Result<Value, String>,
    diagnostic: Value,
}

fn batch_script(probes: &[&Probe]) -> String {
    let mut script = powershell_utf8_command(
        r#"
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
function Get-NpcinkFailureReason($failure) {
    if ($failure.Exception -is [System.UnauthorizedAccessException] -or $failure.Exception.HResult -eq -2147024891) { return 'permission_denied' }
    if ($failure.Exception -is [System.Management.Automation.CommandNotFoundException] -or $failure.FullyQualifiedErrorId -match 'InvalidClass|InvalidNamespace|NotSupported') { return 'unsupported' }
    return 'query_failed'
}
function Write-NpcinkItemFailure($failure, $reference) {
    $entry = @{source=$probeSource;status='item_failed';error=(Get-NpcinkFailureReason $failure);reference=$reference};
    [Console]::WriteLine(($entry | ConvertTo-Json -Compress -Depth 18)); [Console]::Out.Flush();
}
"#,
    );
    for probe in probes {
        // Both source and command are compile-time constants, never device input.
        script.push_str(&format!(r#"
$probeSource = '{}';
[Console]::WriteLine('{{"source":"{}","status":"started"}}'); [Console]::Out.Flush();
$watch = [Diagnostics.Stopwatch]::StartNew();
try {{
    & {{
{}
    }} | ForEach-Object {{
        $entry = @{{source=$probeSource;status='item';record=$_}};
        [Console]::WriteLine(($entry | ConvertTo-Json -Compress -Depth 18)); [Console]::Out.Flush();
    }};
    $record = @{{source=$probeSource;status='ok';elapsedMs=$watch.ElapsedMilliseconds}};
}} catch {{
    $record = @{{source=$probeSource;status='failed';elapsedMs=$watch.ElapsedMilliseconds;error=(Get-NpcinkFailureReason $_)}};
}}
[Console]::WriteLine(($record | ConvertTo-Json -Compress -Depth 18)); [Console]::Out.Flush();
"#, probe.source, probe.source, probe.command.replace("Get-CimInstance ", "Get-CimInstance -OperationTimeoutSec 4 ")));
    }
    script
}

fn decode_batch(
    probes: &[&Probe],
    stdout: &[u8],
    timed_out: bool,
    truncated: bool,
    success: bool,
) -> BTreeMap<&'static str, ProbeResult> {
    let mut records = BTreeMap::new();
    let mut items: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    let mut item_errors: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    // A terminated or truncated line never establishes a usable hardware fact.
    for line in stdout.split_inclusive(|byte| *byte == b'\n') {
        if (timed_out || truncated) && !line.ends_with(b"\n") {
            continue;
        }
        let Ok(record) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        let Some(source) = record["source"].as_str() else {
            continue;
        };
        if !probes.iter().any(|probe| probe.source == source) {
            continue;
        }
        match record["status"].as_str() {
            Some("item") if record["record"].is_object() => {
                items
                    .entry(source.to_string())
                    .or_default()
                    .push(record["record"].clone());
            }
            Some("item_failed") => {
                item_errors
                    .entry(source.to_string())
                    .or_default()
                    .push(json!({"reference":record["reference"], "error":record["error"]}));
            }
            Some("started" | "ok" | "failed") => {
                records.insert(source.to_string(), record);
            }
            _ => {}
        }
    }
    probes.iter().map(|probe| {
        let record = records.get(probe.source);
        let status = record.and_then(|r| r["status"].as_str());
        let rows = items.remove(probe.source).unwrap_or_default();
        let errors = item_errors.remove(probe.source).unwrap_or_default();
        let error = if status == Some("failed") {
            Some(record.and_then(|r| r["error"].as_str()).unwrap_or("query_failed"))
        } else if status == Some("ok") && errors.is_empty() { None }
        else if status == Some("ok") { Some("item_query_failed") }
        else if truncated { Some("output_too_large") }
        else if timed_out && status == Some("started") { Some("query_timeout") }
        else if timed_out { Some("budget_exhausted") }
        else if !success { Some("command_failed") }
        else { Some("invalid_json") };
        let count = rows.len();
        let mut diagnostic = json!({"source": probe.source, "lane": probe.lane, "elapsedMs": record.and_then(|r| r["elapsedMs"].as_u64()), "recordCount": count});
        diagnostic["status"] = json!(match (error, count) { (Some(_), 0) => "failed", (Some(_), _) => "partial", (None, 0) => "empty", _ => "ok" });
        if let Some(error) = error { diagnostic["error"] = json!(error); }
        else if count == 0 { diagnostic["reason"] = json!("no_records"); }
        if !errors.is_empty() { diagnostic["itemErrors"] = json!(errors); }
        let value = match error {
            Some(error) if count == 0 => Err(error.to_string()),
            _ => Ok(json!(rows)),
        };
        (probe.command, ProbeResult {value, diagnostic})
    }).collect()
}

fn run_lane(lane: &str, timeout: Duration) -> BTreeMap<&'static str, ProbeResult> {
    let probes: Vec<_> = PROBES.iter().filter(|probe| probe.lane == lane).collect();
    if timeout.is_zero() {
        return decode_batch(&probes, b"", true, false, false);
    }
    let script = batch_script(&probes);
    // Process timeout is the wall-clock bound, independent of CIM's provider timeout.
    match crate::command::output_with_timeout(
        new_command("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &script]),
        timeout,
    ) {
        Ok(output) => decode_batch(
            &probes,
            &output.stdout,
            output.timed_out,
            output.stdout_truncated,
            output.status.success(),
        ),
        Err(_) => decode_batch(&probes, b"", false, false, false),
    }
}

fn run_phase(lanes: [&str; 2], timeout: Duration) -> BTreeMap<&'static str, ProbeResult> {
    std::thread::scope(|scope| {
        let first = scope.spawn(|| run_lane(lanes[0], timeout));
        let second = run_lane(lanes[1], timeout);
        let mut results = first.join().expect("probe worker panicked");
        results.extend(second);
        results
    })
}

// Reserve one third of the optional wall-clock budget for slow storage queries.
// Quick completion lends its unused time to storage; a hung storage provider cannot
// prevent the preceding security and peripheral lanes from running.
fn run_optional_with(
    timeout: Duration,
    devices: impl FnOnce(Duration) -> BTreeMap<&'static str, ProbeResult>,
    storage: impl FnOnce(Duration) -> BTreeMap<&'static str, ProbeResult>,
) -> BTreeMap<&'static str, ProbeResult> {
    let deadline = Instant::now() + timeout;
    let mut results = devices(timeout.mul_f64(2.0 / 3.0));
    results.extend(storage(deadline.saturating_duration_since(Instant::now())));
    results
}

pub(super) fn enrich(root: &mut Map<String, Value>) {
    let remaining = || {
        COLLECTION_DEADLINE
            .get()
            .map(|end| end.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_secs(60))
    };
    let mut results = run_phase(
        ["core_a", "core_b"],
        remaining().min(Duration::from_secs(22)),
    );
    // Fallbacks share eight seconds; failures cannot consume the optional phase's entire budget.
    let fallback_deadline = Instant::now() + remaining().min(Duration::from_secs(8));
    enrich_windows_identity_with(root, |command| {
        if let Some(result) = results.get(command) {
            return result.value.clone();
        }
        let timeout = fallback_deadline.saturating_duration_since(Instant::now());
        powershell_identity_json_with_timeout(command, timeout)
    });
    results.extend(run_optional_with(
        remaining().min(Duration::from_secs(12)),
        |timeout| run_phase(["optional_a", "optional_b"], timeout),
        |timeout| run_lane("optional_storage", timeout),
    ));
    enrich_windows_summary_with(root, |command| {
        results
            .get(command)
            .expect("registered summary probe")
            .value
            .clone()
    });
    let mut diagnostics: Vec<_> = PROBES
        .iter()
        .filter_map(|probe| {
            results
                .get(probe.command)
                .map(|result| result.diagnostic.clone())
        })
        .collect();
    if let Some(fallbacks) = root.get("identityProbeAttempts").and_then(Value::as_array) {
        diagnostics.extend(
            fallbacks
                .iter()
                .filter(|attempt| {
                    !["baseboard", "processors", "physical_hidden"]
                        .contains(&attempt["source"].as_str().unwrap_or_default())
                })
                .cloned(),
        );
    }
    root.insert("hardwareProbeAttempts".into(), json!(diagnostics));
    super::storage_topology::enrich(root);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streamed_items_survive_provider_failure_timeout_and_truncated_tail() {
        let probes = vec![probe("physical_disks")];
        let prefix = concat!(
            "{\"source\":\"physical_disks\",\"status\":\"started\"}\n",
            "{\"source\":\"physical_disks\",\"status\":\"item\",\"record\":{\"DeviceID\":\"disk-a\",\"Size\":8000000000000}}\n"
        );
        for (tail, timeout, truncated, reason) in [
            ("{\"source\":\"physical_disks\",\"status\":\"failed\",\"error\":\"permission_denied\"}\n", false, false, "permission_denied"),
            ("", true, false, "query_timeout"),
            ("{\"source\":\"physical_disks\",\"status\":\"item\",\"record\":{", false, true, "output_too_large"),
        ] {
            let output = format!("{prefix}{tail}");
            let decoded = decode_batch(&probes, output.as_bytes(), timeout, truncated, false);
            let result = &decoded[probes[0].command];
            assert_eq!(result.value.as_ref().unwrap(), &json!([{"DeviceID":"disk-a", "Size":8000000000000_u64}]));
            assert_eq!(result.diagnostic["status"], "partial");
            assert_eq!(result.diagnostic["error"], reason);
            assert_eq!(result.diagnostic["recordCount"], 1);
        }
    }

    #[test]
    fn per_disk_health_failure_keeps_successes_before_and_after_it() {
        let probes = vec![probe("storage_health")];
        let output = concat!(
            "{\"source\":\"storage_health\",\"status\":\"started\"}\n",
            "{\"source\":\"storage_health\",\"status\":\"item\",\"record\":{\"StorageUniqueId\":\"a\",\"Temperature\":30}}\n",
            "{\"source\":\"storage_health\",\"status\":\"item_failed\",\"reference\":{\"StorageUniqueId\":\"b\"},\"error\":\"unsupported\"}\n",
            "{\"source\":\"storage_health\",\"status\":\"item\",\"record\":{\"StorageUniqueId\":\"c\",\"Temperature\":0}}\n",
            "{\"source\":\"storage_health\",\"status\":\"ok\"}\n"
        );
        let decoded = decode_batch(&probes, output.as_bytes(), false, false, true);
        let result = &decoded[probes[0].command];
        assert_eq!(
            result.value.as_ref().unwrap(),
            &json!([{"StorageUniqueId":"a","Temperature":30}, {"StorageUniqueId":"c","Temperature":0}])
        );
        assert_eq!(result.diagnostic["status"], "partial");
        assert_eq!(
            result.diagnostic["itemErrors"][0]["reference"]["StorageUniqueId"],
            "b"
        );
        assert_eq!(result.diagnostic["itemErrors"][0]["error"], "unsupported");
    }

    #[test]
    fn large_stream_retains_every_completed_record_without_final_envelope() {
        let probes = vec![probe("usb")];
        let mut output = String::from("{\"source\":\"usb\",\"status\":\"started\"}\n");
        for index in 0..512 {
            output.push_str(&format!("{}\n", json!({"source":"usb","status":"item","record":{"DeviceID":format!("USB-{index}"),"enabled":false}})));
        }
        output.push_str("{\"source\":\"usb\",\"status\":\"item\",\"record\":{");
        let decoded = decode_batch(&probes, output.as_bytes(), true, true, false);
        let result = &decoded[probes[0].command];
        let rows = result.value.as_ref().unwrap().as_array().unwrap();
        assert_eq!(rows.len(), 512);
        assert_eq!(rows[511]["DeviceID"], "USB-511");
        assert_eq!(rows[0]["enabled"], false);
        assert_eq!(result.diagnostic["status"], "partial");
    }

    #[test]
    fn optional_storage_reserves_time_and_does_not_precede_security_or_peripherals() {
        let total = Duration::from_secs(12);
        let results = run_optional_with(
            total,
            |budget| {
                assert_eq!(budget, Duration::from_secs(8));
                for source in ["usb", "printers", "tpm", "secure_boot"] {
                    assert_eq!(probe(source).lane, "optional_b");
                }
                BTreeMap::new()
            },
            |budget| {
                assert!(budget > Duration::from_secs(4) && budget <= total);
                for source in [
                    "disk_partitions",
                    "disk_partition_links",
                    "partition_volume_links",
                    "storage_health",
                ] {
                    assert_eq!(probe(source).lane, "optional_storage");
                }
                BTreeMap::new()
            },
        );
        assert!(results.is_empty());
        run_optional_with(
            Duration::ZERO,
            |budget| {
                assert!(budget.is_zero());
                BTreeMap::new()
            },
            |budget| {
                assert!(budget.is_zero());
                BTreeMap::new()
            },
        );
    }

    #[test]
    fn exhausted_collection_budget_starts_no_process_and_preserves_diagnostics() {
        let previous = COLLECTION_DEADLINE.replace(Some(Instant::now()));
        let mut root = Map::new();
        enrich(&mut root);
        COLLECTION_DEADLINE.set(previous);
        let attempts = root["hardwareProbeAttempts"].as_array().unwrap();
        assert_eq!(attempts.len(), PROBES.len() + 3);
        assert!(attempts
            .iter()
            .all(|probe| probe["error"] == "budget_exhausted"));
        assert!(!root.contains_key("memLayout"));
    }

    #[test]
    fn batch_keeps_completed_queries_and_distinguishes_hung_from_unstarted() {
        let probes: Vec<_> = PROBES.iter().filter(|p| p.lane == "core_a").collect();
        let output = b"{\"source\":\"system_product\",\"status\":\"item\",\"record\":{\"UUID\":\"abc\"}}\n{\"source\":\"system_product\",\"status\":\"ok\",\"elapsedMs\":4}\n{\"source\":\"memory_modules\",\"status\":\"started\"}\n{\"source\":\"physical_disks\"";
        let decoded = decode_batch(&probes, output, true, false, false);
        assert_eq!(
            decoded[probe("system_product").command]
                .value
                .as_ref()
                .unwrap()[0]["UUID"],
            "abc"
        );
        assert_eq!(
            decoded[probe("memory_modules").command]
                .value
                .as_ref()
                .unwrap_err(),
            "query_timeout"
        );
        assert_eq!(
            decoded[probe("physical_disks").command]
                .value
                .as_ref()
                .unwrap_err(),
            "budget_exhausted"
        );
        let decoded = decode_batch(&probes, output, false, true, false);
        assert_eq!(
            decoded[probe("memory_modules").command]
                .value
                .as_ref()
                .unwrap_err(),
            "output_too_large"
        );
    }

    #[test]
    fn batch_reports_absence_permissions_and_malformed_output() {
        let probes = vec![probe("memory_modules"), probe("bios"), probe("tpm")];
        let output = b"{\"source\":\"memory_modules\",\"status\":\"ok\"}\n{\"source\":\"bios\",\"status\":\"failed\",\"error\":\"permission_denied\"}\nnoise\n";
        let decoded = decode_batch(&probes, output, false, false, true);
        assert_eq!(
            decoded[probe("memory_modules").command].diagnostic["reason"],
            "no_records"
        );
        assert_eq!(
            decoded[probe("bios").command].value.as_ref().unwrap_err(),
            "permission_denied"
        );
        assert_eq!(
            decoded[probe("tpm").command].value.as_ref().unwrap_err(),
            "invalid_json"
        );
        let script = batch_script(&probes);
        assert!(script.contains("OperationTimeoutSec 4"));
        assert!(script.contains("[Console]::Out.Flush()"));
    }
}
