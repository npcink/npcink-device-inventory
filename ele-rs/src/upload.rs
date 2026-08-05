use anyhow::{bail, Context, Result};
use hmac::{Hmac, Mac};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::blocking::Client;
use reqwest::header::CONTENT_TYPE;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

pub fn submit_v3(site: &str, name: &str, token_value: &str, data: &Value) -> Result<Value> {
    if let Some(token) = parse_client_token(token_value)? {
        let body = json!({
            "observation": build_observation_v3(name, data)?,
        });
        return submit_json_hmac(&resolve_observation_endpoint(site), &body, &token);
    }

    bail!("新版上传接口必须使用后台生成的上传授权码");
}

fn submit_json_hmac<T: Serialize>(site: &str, body: &T, token: &ClientToken) -> Result<Value> {
    let body_json = serde_json::to_string(body).context("failed to encode submit body")?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system time is before unix epoch")?
        .as_secs()
        .to_string();
    let nonce: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let body_digest = Sha256::digest(body_json.as_bytes());
    let body_hash = hex_encode(&body_digest);
    let signing_payload = format!("{timestamp}\n{nonce}\n{body_hash}");

    let mut mac = HmacSha256::new_from_slice(token.secret.as_bytes())
        .context("failed to prepare HMAC key")?;
    mac.update(signing_payload.as_bytes());
    let signature = format!(
        "sha256={}",
        hex_encode(mac.finalize().into_bytes().as_slice())
    );

    send_json(
        site,
        body_json,
        vec![
            ("x-npcink-device-token-id", token.id.clone()),
            ("x-npcink-device-timestamp", timestamp),
            ("x-npcink-device-nonce", nonce),
            ("x-npcink-device-signature", signature),
        ],
    )
}

fn send_json(site: &str, body_json: String, headers: Vec<(&'static str, String)>) -> Result<Value> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(format!("npcink-device-agent/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .context("failed to build HTTP client")?;

    let mut request = client
        .post(site)
        .header(CONTENT_TYPE, "application/json")
        .body(body_json);

    for (name, value) in headers {
        request = request.header(name, value);
    }

    let response = request
        .send()
        .with_context(|| format!("failed to submit device data to {site}"))?;

    let status = response.status();
    let text = response.text().context("failed to read submit response")?;

    parse_submit_response(status, text)
}

fn parse_submit_response(status: reqwest::StatusCode, text: String) -> Result<Value> {
    if !status.is_success() {
        let detail = serde_json::from_str::<Value>(&text)
            .map(|value| value.to_string())
            .unwrap_or(text);
        bail!("submit failed with status {status}: {detail}");
    }

    serde_json::from_str::<Value>(&text).with_context(|| {
        format!("submit succeeded with status {status}, but response was not JSON")
    })
}

fn build_observation_v3(upload_note: &str, data: &Value) -> Result<Value> {
    crate::collector::hardware_identity_v2(data).context(
        "missing device identity; check system UUID, motherboard serial, or permanent PCI MAC data",
    )?;
    let collector = object_at(data, "/collector");
    let collected_at = string_at(data, "/collector/collected_at");
    let system = value_at(data, "/system");
    let baseboard = value_at(data, "/baseboard");
    let bios = value_at(data, "/bios");
    let networks = array_at(data, "/net");
    let primary_network = pick_primary_network(&networks);

    Ok(json!({
        "_npcink_device": {
            "schema_version": 5,
            "collector": {
                "name": collector_string(&collector, "name", env!("CARGO_PKG_NAME")),
                "version": collector_string(&collector, "version", env!("CARGO_PKG_VERSION")),
                "runtime": collector_string(&collector, "runtime", "rust"),
                "schema": collector_string(&collector, "schema", "systeminformation-staticdata-compatible-v1"),
                "collected_at": if collected_at.is_empty() { chrono::Utc::now().to_rfc3339() } else { collected_at },
            },
        },
        "asset": {
            "upload": {
                "note": upload_note,
                "reported_user": upload_note,
                "uploaded_at": chrono::Utc::now().to_rfc3339(),
            },
            "summary": {
                "device_model": device_model(data),
                "os": os_label(data),
                "platform": string_at(data, "/os/platform"),
                "cpu": cpu_label(data),
                "memory_bytes": number_at(data, "/mem/total"),
                "disk_bytes": sum_disk_bytes(data),
                "graphics": graphics_label(data),
                "primary_ip": primary_ip(&primary_network),
            },
            "hardware": {
                "hardwareUuid": string_at(data, "/uuid/hardware"),
                "cpu": value_at(data, "/cpu"),
                "processors": value_at(data, "/processorIdentity"),
                "memory": {
                    "system": value_at(data, "/mem"),
                    "modules": value_at(data, "/memLayout"),
                },
                "battery": value_at(data, "/battery"),
                "disks": value_at(data, "/diskLayout"),
                "network": {
                    "primary": primary_network,
                    "interfaces": networks,
                    "identityInterfaces": value_at(data, "/networkHardware"),
                },
                "graphics": value_at(data, "/graphics"),
                "baseboard": baseboard,
                "bios": bios,
                "system": system,
            },
        },
        "raw": {
            "source": "npcink-device-agent-v5",
            "static_data": data,
            "filesystems": value_at(data, "/fsSize"),
            "platform": value_at(data, "/platformData"),
        },
    }))
}

fn resolve_observation_endpoint(site: &str) -> String {
    let site = site.trim().trim_end_matches('/');
    if site.ends_with("/device-observations") {
        return site.to_string();
    }
    if site.ends_with("/npcink-device-inventory/v1") {
        return format!("{site}/device-observations");
    }
    if site.ends_with("/wp-json") {
        return format!("{site}/npcink-device-inventory/v1/device-observations");
    }
    format!("{site}/?rest_route=/npcink-device-inventory/v1/device-observations")
}

fn value_at(data: &Value, pointer: &str) -> Value {
    data.pointer(pointer).cloned().unwrap_or(Value::Null)
}

fn object_at(data: &Value, pointer: &str) -> serde_json::Map<String, Value> {
    data.pointer(pointer)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn array_at(data: &Value, pointer: &str) -> Vec<Value> {
    data.pointer(pointer)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn string_at(data: &Value, pointer: &str) -> String {
    data.pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn number_at(data: &Value, pointer: &str) -> u64 {
    data.pointer(pointer)
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

fn collector_string(
    collector: &serde_json::Map<String, Value>,
    key: &str,
    fallback: &str,
) -> String {
    collector
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn pick_primary_network(networks: &[Value]) -> Value {
    let best = networks
        .iter()
        .find(|item| bool_field(item, "default"))
        .or_else(|| {
            networks.iter().find(|item| {
                !string_field(item, "mac").is_empty()
                    && !bool_field(item, "virtual")
                    && !bool_field(item, "internal")
            })
        })
        .or_else(|| networks.first());

    best.cloned().unwrap_or_else(|| json!({}))
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn primary_ip(primary_network: &Value) -> String {
    let ip4 = string_field(primary_network, "ip4");
    if !ip4.is_empty() {
        return ip4;
    }
    let ip6 = string_field(primary_network, "ip6");
    if !ip6.is_empty() {
        return ip6;
    }
    "127.0.0.1".to_string()
}

fn join_non_empty(values: &[String]) -> String {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn device_model(data: &Value) -> String {
    let label = join_non_empty(&[
        string_at(data, "/system/manufacturer"),
        string_at(data, "/system/model"),
    ]);
    if label.is_empty() {
        string_at(data, "/os/hostname")
    } else {
        label
    }
}

fn os_label(data: &Value) -> String {
    join_non_empty(&[
        string_at(data, "/os/distro"),
        string_at(data, "/os/release"),
    ])
}

fn cpu_label(data: &Value) -> String {
    join_non_empty(&[
        string_at(data, "/cpu/manufacturer"),
        string_at(data, "/cpu/brand"),
    ])
}

fn graphics_label(data: &Value) -> String {
    data.pointer("/graphics/controllers")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .map(|item| join_non_empty(&[string_field(item, "vendor"), string_field(item, "model")]))
        .unwrap_or_default()
}

fn sum_disk_bytes(data: &Value) -> u64 {
    data.pointer("/diskLayout")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("size").and_then(Value::as_u64))
                .sum()
        })
        .unwrap_or_default()
}

#[derive(Debug)]
struct ClientToken {
    id: String,
    secret: String,
}

fn parse_client_token(value: &str) -> Result<Option<ClientToken>> {
    let value = value.trim();
    if !value.starts_with("mda_") {
        return Ok(None);
    }

    let parts = value.split('_').collect::<Vec<_>>();
    if parts.len() != 3 || parts[1].is_empty() || parts[2].is_empty() {
        bail!("上传授权码格式不正确，请从后台重新复制");
    }

    Ok(Some(ClientToken {
        id: parts[1].to_string(),
        secret: parts[2].to_string(),
    }))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_common_site_inputs_to_v3_observation_endpoint() {
        assert_eq!(
            resolve_observation_endpoint("https://example.com"),
            "https://example.com/?rest_route=/npcink-device-inventory/v1/device-observations"
        );
        assert_eq!(
            resolve_observation_endpoint("https://example.com/wordpress/"),
            "https://example.com/wordpress/?rest_route=/npcink-device-inventory/v1/device-observations"
        );
        assert_eq!(
            resolve_observation_endpoint("https://example.com/wp-json"),
            "https://example.com/wp-json/npcink-device-inventory/v1/device-observations"
        );
        assert_eq!(
            resolve_observation_endpoint("https://example.com/wp-json/npcink-device-inventory/v1"),
            "https://example.com/wp-json/npcink-device-inventory/v1/device-observations"
        );
        assert_eq!(
            resolve_observation_endpoint(
                "https://example.com/wp-json/npcink-device-inventory/v1/device-observations/"
            ),
            "https://example.com/wp-json/npcink-device-inventory/v1/device-observations"
        );
        assert_eq!(
            resolve_observation_endpoint(
                "https://example.com/index.php?rest_route=/npcink-device-inventory/v1/device-observations"
            ),
            "https://example.com/index.php?rest_route=/npcink-device-inventory/v1/device-observations"
        );
    }

    #[test]
    fn rejects_successful_non_json_response() {
        let result = parse_submit_response(
            reqwest::StatusCode::OK,
            "<!doctype html><title>WordPress</title>".to_string(),
        );

        let error = result.expect_err("HTML must not be accepted as a successful upload response");
        assert!(error
            .to_string()
            .contains("submit succeeded with status 200 OK, but response was not JSON"));
    }

    #[test]
    fn builds_v3_observation_contract() {
        let data = json!({
            "collector": {"name": "agent", "version": "1.0", "runtime": "rust", "collected_at": "2026-06-24T08:00:00Z"},
            "uuid": {"hardware": "HW-1", "macs": ["aa:bb:cc:dd:ee:ff"]},
            "system": {"manufacturer": "Npcink", "model": "Test", "uuid": "HW-1", "serial": "SER-1"},
            "baseboard": {"manufacturer": "Npcink", "product": "Board", "serial": "BOARD-1"},
            "bios": {"serial": "BIOS-1"},
            "os": {"platform": "macos", "distro": "macOS", "release": "15"},
            "cpu": {"brand": "CPU"},
            "processorIdentity": [{"name": "CPU", "processorId": "SHARED-FAMILY-ID"}],
            "mem": {"total": 8},
            "battery": [{"name": "Internal Battery", "healthPercent": 91}],
            "diskLayout": [{"size": 10}],
            "net": [{"default": true, "mac": "aa:bb:cc:dd:ee:ff", "ip4": "192.168.1.2"}],
            "networkHardware": [{"pnpDeviceId": "PCI\\VEN_1234", "permanentAddress": "AABBCCDDEEFF", "virtual": false}],
            "graphics": {"controllers": [{"vendor": "GPU", "model": "Model"}]}
        });

        let observation = build_observation_v3("Alice", &data).unwrap();
        assert_eq!(
            observation.pointer("/_npcink_device/schema_version"),
            Some(&json!(5))
        );
        assert!(observation.pointer("/asset/identity").is_none());
        assert_eq!(
            observation.pointer("/asset/hardware/hardwareUuid"),
            Some(&json!("HW-1"))
        );
        assert_eq!(
            observation.pointer("/asset/upload/reported_user"),
            Some(&json!("Alice"))
        );
        assert_eq!(
            observation.pointer("/asset/summary/primary_ip"),
            Some(&json!("192.168.1.2"))
        );
        assert_eq!(
            observation.pointer("/asset/hardware/system/serial"),
            Some(&json!("SER-1"))
        );
        assert_eq!(
            observation.pointer("/asset/hardware/network/identityInterfaces/0/permanentAddress"),
            Some(&json!("AABBCCDDEEFF"))
        );
        assert_eq!(
            observation.pointer("/asset/hardware/battery/0/healthPercent"),
            Some(&json!(91))
        );
    }
}
