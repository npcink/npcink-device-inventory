use anyhow::{bail, Context, Result};
use hmac::{Hmac, Mac};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::blocking::Client;
use reqwest::header::CONTENT_TYPE;
use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;
static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const OBSERVATION_ROUTE: &str = "/npcink-device-inventory/v1/device-observations";

pub fn submit_v3(site: &str, name: &str, token_value: &str, data: &Value) -> Result<Value> {
    let endpoint = resolved_observation_endpoint(site);
    validate_upload_endpoint(&endpoint)?;
    if let Some(token) = parse_client_token(token_value)? {
        let body = json!({
            "observation": build_observation_v3(name, data)?,
        });
        return submit_json_hmac(&endpoint, &body, &token);
    }

    bail!("新版上传接口必须使用后台生成的上传授权码");
}

pub fn verify_connection(site: &str, token_value: &str) -> Result<String> {
    let endpoint = format!(
        "{}/verify",
        resolved_observation_endpoint(site).trim_end_matches('/')
    );
    validate_config_values(&endpoint, token_value)?;
    let token =
        parse_client_token(token_value)?.context("上传授权码格式不正确，请从后台重新复制")?;
    submit_json_hmac_with_method(Method::GET, &endpoint, &json!({}), &token)?;
    Ok("连接正常，站点地址和授权码均可用。".to_string())
}

fn submit_json_hmac<T: Serialize>(site: &str, body: &T, token: &ClientToken) -> Result<Value> {
    submit_json_hmac_with_method(Method::POST, site, body, token)
}

fn submit_json_hmac_with_method<T: Serialize>(
    method: Method,
    site: &str,
    body: &T,
    token: &ClientToken,
) -> Result<Value> {
    let route = signed_route(&method, site)?;
    validate_payload(body)?;
    let body_json = serde_json::to_string(body).context("failed to encode submit body")?;
    if body_json.len() > MAX_BODY_BYTES {
        bail!("采集数据超过 2 MiB 上传限制，请导出硬件反馈核对；尚未上传。");
    }
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
    let signing_payload =
        signing_payload(&method, route, &token.id, &timestamp, &nonce, &body_hash);

    let mut mac = HmacSha256::new_from_slice(token.secret.as_bytes())
        .context("failed to prepare HMAC key")?;
    mac.update(signing_payload.as_bytes());
    let signature = format!(
        "sha256={}",
        hex_encode(mac.finalize().into_bytes().as_slice())
    );

    send_json(
        method,
        site,
        body_json,
        vec![
            ("x-npcink-device-signature-version", "2".to_string()),
            ("x-npcink-device-token-id", token.id.clone()),
            ("x-npcink-device-timestamp", timestamp),
            ("x-npcink-device-nonce", nonce),
            ("x-npcink-device-signature", signature),
        ],
    )
}

fn signing_payload(
    method: &Method,
    route: &str,
    token_id: &str,
    timestamp: &str,
    nonce: &str,
    body_hash: &str,
) -> String {
    format!(
        "npcink-device-upload-v2\n{method}\n{route}\n{token_id}\n{timestamp}\n{nonce}\n{body_hash}"
    )
}

fn signed_route(method: &Method, endpoint: &str) -> Result<&'static str> {
    let url = url::Url::parse(endpoint).context("上传地址格式无效")?;
    let expected = match *method {
        Method::POST => OBSERVATION_ROUTE,
        Method::GET => "/npcink-device-inventory/v1/device-observations/verify",
        _ => bail!("设备授权只允许上传和连接验证"),
    };
    let query: Vec<_> = url.query_pairs().collect();
    let route_matches = if query.is_empty() {
        url.path().trim_end_matches('/').ends_with(expected)
    } else {
        query.len() == 1
            && query[0].0 == "rest_route"
            && query[0].1.trim_end_matches('/') == expected
    };
    if !route_matches || url.fragment().is_some() {
        bail!("上传地址必须指向设备观测接口，且不能包含额外查询参数或片段");
    }
    Ok(expected)
}

fn send_json(
    method: Method,
    site: &str,
    body_json: String,
    headers: Vec<(&'static str, String)>,
) -> Result<Value> {
    let client = HTTP_CLIENT.get_or_init(|| {
        http_client_builder()
            .build()
            .expect("failed to build HTTP client")
    });
    let is_verify = method == Method::GET;

    let mut request = client
        .request(method, site)
        .header(CONTENT_TYPE, "application/json")
        .body(body_json);

    for (name, value) in headers {
        request = request.header(name, value);
    }

    let response = request
        .send()
        .with_context(|| format!("无法连接站点，请检查网络、地址和 HTTPS 证书：{site}"))?;

    let status = response.status();
    if status.is_redirection() {
        bail!("站点要求跳转（HTTP {status}），已停止发送。请直接配置最终 HTTPS 站点地址。");
    }
    let text = read_response_body(response)?;
    let payload = parse_submit_response(status, text)?;
    validate_success_response(&payload, is_verify)?;
    Ok(payload)
}

fn http_client_builder() -> reqwest::blocking::ClientBuilder {
    Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .user_agent(format!("npcink-device-agent/{}", env!("CARGO_PKG_VERSION")))
}

fn read_response_body(response: impl Read) -> Result<String> {
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .context("failed to read submit response")?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        bail!("站点响应超过 64 KiB 限制，请核对接口地址和服务器日志。");
    }
    String::from_utf8(bytes).context("站点响应不是有效 UTF-8")
}

fn validate_success_response(payload: &Value, is_verify: bool) -> Result<()> {
    let valid = if is_verify {
        payload.pointer("/data/connected").and_then(Value::as_bool) == Some(true)
    } else {
        payload
            .pointer("/data/observation/id")
            .and_then(Value::as_u64)
            .is_some_and(|id| id > 0)
            && payload
                .pointer("/data/asset/uuid")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.is_empty())
    };
    if !valid {
        bail!("站点返回的 JSON 不符合设备接口合同，无法确认操作成功。请核对站点地址和插件版本。");
    }
    Ok(())
}

fn validate_payload<T: Serialize>(body: &T) -> Result<()> {
    fn visit(value: &Value, path: &str, depth: usize, nodes: &mut usize) -> Result<()> {
        *nodes += 1;
        if depth > 24 || *nodes > 20_000 {
            bail!("采集结构超过上传限制：{path}（深度或节点数量），尚未上传。");
        }
        match value {
            Value::Array(items) => {
                if items.len() > 512 {
                    bail!("采集数组超过 512 项：{path}，尚未上传。");
                }
                for (index, item) in items.iter().enumerate() {
                    visit(item, &format!("{path}/{index}"), depth + 1, nodes)?;
                }
            }
            Value::Object(items) => {
                if items.len() > 512 {
                    bail!("采集对象超过 512 项：{path}，尚未上传。");
                }
                for (key, item) in items {
                    if key.len() > 128 {
                        bail!("采集字段名超过 128 字节：{path}，尚未上传。");
                    }
                    let escaped = key.replace('~', "~0").replace('/', "~1");
                    visit(item, &format!("{path}/{escaped}"), depth + 1, nodes)?;
                }
            }
            Value::String(text) if text.len() > 10_000 => {
                bail!("采集字符串超过 10000 字节：{path}，尚未上传。");
            }
            _ => {}
        }
        Ok(())
    }
    visit(&serde_json::to_value(body)?, "", 0, &mut 0)
}

fn parse_submit_response(status: reqwest::StatusCode, text: String) -> Result<Value> {
    if !status.is_success() {
        let payload = serde_json::from_str::<Value>(&text).unwrap_or(Value::Null);
        let code = payload
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let server_message = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let guidance = match (status.as_u16(), code) {
            (401, "unsupported_signature_version") => {
                "客户端签名版本已过期，请更新客户端后重试；现有授权码仍可使用。"
            }
            (401, "expired_signature") => "电脑时间与服务器偏差过大，请校准系统时间后重试。",
            (401, _) => "授权码无效、已禁用或签名校验失败，请让管理员重新生成配置。",
            (403, _) => "当前账号或客户端没有上传权限，请联系站点管理员。",
            (404, _) => "站点未找到设备上传接口，请确认插件已启用且地址指向正确站点。",
            (409, "observation_id_conflict") => "同一采集编号已对应其他内容，请重新采集后上传。",
            (409, "asset_archived") => "对应资产已归档，请先在后台恢复资产后再上传。",
            (409, _) => "设备身份与后台现有资产冲突，请联系管理员核对资产身份。",
            (413, _) => "采集数据超过服务器限制，请导出排障包并联系管理员。",
            (429, _) => "上传过于频繁，请稍后再试。",
            (500..=599, _) => "服务器暂时无法处理上传，请稍后重试并查看 WordPress 日志。",
            _ => "请检查站点地址和插件状态；如仍失败，请复制技术详情给管理员。",
        };
        let technical = if server_message.is_empty() {
            code
        } else {
            server_message
        };
        if technical.is_empty() {
            bail!("上传失败（HTTP {status}）。{guidance}");
        }
        bail!("上传失败（HTTP {status}）。{guidance}\n技术详情：{technical}");
    }

    serde_json::from_str::<Value>(&text)
        .with_context(|| format!("服务器返回成功状态 {status}，但响应格式不是有效 JSON"))
}

pub(crate) fn build_observation_v3(upload_note: &str, data: &Value) -> Result<Value> {
    if crate::collector::hardware_identity_v2(data).is_none() {
        let diagnostics = crate::collector::identity_diagnostics(data);
        let label = |key: &str| match diagnostics[key].as_str() {
            Some("valid") => "有效",
            Some("invalid_placeholder") => "厂家默认值或无效值",
            _ => "未采集到",
        };
        let failed_queries = diagnostics["probeAttempts"]
            .as_array()
            .map_or(0, |attempts| {
                attempts
                    .iter()
                    .filter(|attempt| attempt["status"] == "failed")
                    .count()
            });
        bail!(
            "无法生成设备身份，尚未上传。系统 UUID：{}；主板序列号：{}；主板厂商：{}；主板型号：{}；CPU 型号：{}；有效永久 PCI MAC：{} 个；查询失败：{} 项。请重新采集；若仍失败，请导出硬件反馈供管理员核对。",
            label("systemUuid"), label("baseboardSerial"), label("baseboardManufacturer"),
            label("baseboardModel"), label("processorModel"), diagnostics["permanentPciMacCount"], failed_queries
        );
    }
    let collector = object_at(data, "/collector");
    let observation_id = string_at(data, "/collector/observation_id");
    if !crate::collector::valid_observation_id(&observation_id) {
        bail!("采集快照缺少观测编号，请重新采集后上传。");
    }
    let collected_at = string_at(data, "/collector/collected_at");
    let networks = array_at(data, "/net");
    let primary_network = pick_primary_network(&networks);
    // Preserve additional collected categories; only move fields that have a
    // defined normalized destination. New hardware facts must not disappear here.
    let mut hardware = object_at(data, "");
    for key in [
        "collector",
        "cpu",
        "processorIdentity",
        "mem",
        "memLayout",
        "memoryArrays",
        "memoryKind",
        "diskLayout",
        "fsSize",
        "net",
        "networkHardware",
        "identityDiagnostics",
        "identityProbeAttempts",
        "hardwareProbeAttempts",
    ] {
        hardware.remove(key);
    }
    let disk_rows = array_at(data, "/diskLayout");
    let is_volume = |item: &Value| {
        (item.get("mount").is_some() || item.get("fsType").is_some())
            && [
                "model",
                "serialNum",
                "serial",
                "interfaceType",
                "pnpDeviceId",
            ]
            .iter()
            .all(|key| string_field(item, key).is_empty())
    };
    let disks: Vec<_> = disk_rows
        .iter()
        .filter(|item| !is_volume(item))
        .cloned()
        .collect();
    let mut volumes = array_at(data, "/fsSize");
    if volumes.is_empty() {
        volumes = disk_rows
            .iter()
            .filter(|item| is_volume(item))
            .cloned()
            .collect();
    }
    hardware.extend(object_at(&json!({
        "hardwareUuid": string_at(data, "/uuid/hardware"),
        "cpu": value_at(data, "/cpu"),
        "processors": value_at(data, "/processorIdentity"),
        "memory": {"system": value_at(data, "/mem"), "modules": value_at(data, "/memLayout"), "arrays": value_at(data, "/memoryArrays"), "kind": value_at(data, "/memoryKind")},
        "disks": disks,
        "volumes": volumes,
        "network": {"primary": primary_network, "interfaces": networks, "identityInterfaces": value_at(data, "/networkHardware")},
        "collection": {"collector": collector, "hardwareProbes": value_at(data, "/hardwareProbeAttempts"), "identityProbes": value_at(data, "/identityProbeAttempts"), "identityDiagnostics": value_at(data, "/identityDiagnostics")},
    }), ""));

    Ok(json!({
        "_npcink_device": {
            "schema_version": 5,
            "observation_id": observation_id,
            "collector": {
                "name": collector_string(&collector, "name", env!("CARGO_PKG_NAME")),
                "version": collector_string(&collector, "version", env!("CARGO_PKG_VERSION")),
                "runtime": collector_string(&collector, "runtime", "rust"),
                "schema": collector_string(&collector, "schema", crate::collector::INVENTORY_SCHEMA),
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
                "hostname": string_at(data, "/os/hostname"),
                "os": os_label(data),
                "platform": string_at(data, "/os/platform"),
                "cpu": cpu_label(data),
                "memory_bytes": number_at(data, "/mem/total"),
                "disk_bytes": sum_physical_disk_bytes(&disks),
                "graphics": graphics_label(data),
                "primary_ip": primary_ip(&primary_network),
            },
            "hardware": hardware,
        },
        "raw": {
            "source": "npcink-device-agent-v5"
        },
    }))
}

pub fn resolved_observation_endpoint(site: &str) -> String {
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

pub fn validate_config_values(endpoint: &str, token_value: &str) -> Result<()> {
    validate_upload_endpoint(endpoint)?;
    if parse_client_token(token_value)?.is_none() {
        bail!("上传授权码格式不正确，请从后台重新复制");
    }
    Ok(())
}

fn validate_upload_endpoint(endpoint: &str) -> Result<()> {
    let parsed = url::Url::parse(endpoint.trim()).context("上传地址格式无效")?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        bail!("设备上传必须使用 HTTPS 地址");
    }
    Ok(())
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
    String::new()
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
    join_non_empty(&[
        string_at(data, "/system/manufacturer"),
        string_at(data, "/system/model"),
    ])
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
        .map(|item| {
            let vendor = string_field(item, "vendor");
            let model = string_field(item, "model");
            let vendor = vendor.trim();
            let model = model.trim();
            if vendor.is_empty() || model.to_lowercase().starts_with(&vendor.to_lowercase()) {
                model.to_string()
            } else {
                join_non_empty(&[vendor.to_string(), model.to_string()])
            }
        })
        .unwrap_or_default()
}

fn sum_physical_disk_bytes(disks: &[Value]) -> Option<u64> {
    if disks.is_empty() {
        return None;
    }
    disks.iter().try_fold(0_u64, |total, disk| {
        let size = disk
            .get("size")
            .and_then(Value::as_u64)
            .filter(|size| *size > 0)?;
        total.checked_add(size)
    })
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
    fn request_signature_v2_matches_shared_golden_vectors() {
        let vectors: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/device-signature-v2.json"
        ))
        .unwrap();
        for row in vectors.as_array().unwrap() {
            let method = Method::from_bytes(row["method"].as_str().unwrap().as_bytes()).unwrap();
            let hash = hex_encode(&Sha256::digest(row["body"].as_str().unwrap().as_bytes()));
            assert_eq!(hash, row["body_hash"]);
            let payload = signing_payload(
                &method,
                row["route"].as_str().unwrap(),
                row["token_id"].as_str().unwrap(),
                row["timestamp"].as_str().unwrap(),
                row["nonce"].as_str().unwrap(),
                &hash,
            );
            assert_eq!(payload, row["payload"]);
            let mut mac =
                HmacSha256::new_from_slice(row["secret"].as_str().unwrap().as_bytes()).unwrap();
            mac.update(payload.as_bytes());
            assert_eq!(
                format!("sha256={}", hex_encode(&mac.finalize().into_bytes())),
                row["signature"]
            );
        }
    }

    #[test]
    fn signed_route_normalizes_wordpress_transport_but_rejects_unsigned_inputs() {
        for endpoint in [
            "https://example.com/wp-json/npcink-device-inventory/v1/device-observations",
            "https://example.com/subdir/wp-json/npcink-device-inventory/v1/device-observations/",
            "https://example.com/subdir/?rest_route=%2Fnpcink-device-inventory%2Fv1%2Fdevice-observations",
        ] {
            assert_eq!(signed_route(&Method::POST, endpoint).unwrap(), OBSERVATION_ROUTE);
        }
        assert_eq!(signed_route(&Method::GET, "https://example.com/?rest_route=/npcink-device-inventory/v1/device-observations/verify").unwrap(), format!("{OBSERVATION_ROUTE}/verify"));
        for endpoint in [
            "https://example.com/?rest_route=/npcink-device-inventory/v1/assets",
            "https://example.com/?rest_route=/npcink-device-inventory/v1/device-observations&rest_route=/npcink-device-inventory/v1/assets",
            "https://example.com/?rest_route=/npcink-device-inventory/v1/device-observations&_method=GET",
            "https://example.com/wp-json/npcink-device-inventory/v1/device-observations?extra=1",
            "https://example.com/wp-json/npcink-device-inventory/v1/device-observations#private",
        ] {
            assert!(signed_route(&Method::POST, endpoint).is_err(), "{endpoint}");
        }
        assert!(signed_route(&Method::DELETE, "https://example.com/").is_err());
    }

    fn build_test_observation(note: &str, data: &Value) -> Result<Value> {
        let mut data = data.clone();
        if !data["collector"].is_object() {
            data["collector"] = json!({});
        }
        data["collector"]["observation_id"] = json!("cdb0d10b-858d-49aa-a8d4-bcb29f0cdd0e");
        build_observation_v3(note, &data)
    }

    #[test]
    fn upload_client_rejects_http_and_does_not_follow_redirects() {
        assert!(http_client_builder()
            .build()
            .unwrap()
            .get("http://127.0.0.1:1")
            .send()
            .is_err());
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            use std::io::Write;
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = [0; 4096];
            let received = stream.read(&mut request).unwrap();
            assert!(received > 0, "fixture received no request");
            stream.write_all(b"HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:1/leak\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        // Local HTTP is enabled only in this fixture; the production redirect policy is retained.
        let response = http_client_builder()
            .https_only(false)
            .build()
            .unwrap()
            .post(format!("http://{address}/upload"))
            .header("x-npcink-device-signature", "synthetic")
            .body("synthetic inventory")
            .send()
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
        worker.join().unwrap();
    }

    #[test]
    fn rejects_large_or_unrelated_responses_and_preflights_inventory() {
        assert!(
            read_response_body(std::io::Cursor::new(vec![b'x'; MAX_RESPONSE_BYTES + 1])).is_err()
        );
        assert!(validate_success_response(&json!({"unrelated": true}), false).is_err());
        assert!(validate_success_response(&json!({"data": {"connected": false}}), true).is_err());
        assert!(validate_success_response(&json!({"data": {"connected": true}}), true).is_ok());
        assert!(validate_success_response(
            &json!({"data": {"asset": {"uuid": "test"}, "observation": {"id": 1}}}),
            false
        )
        .is_ok());
        let mut keys = serde_json::Map::new();
        keys.insert("a".repeat(129), json!("first"));
        assert!(validate_payload(&keys).is_err());
        assert!(validate_payload(&json!({"modules": vec![0; 513]})).is_err());
        assert!(validate_payload(
            &json!({"model": "GPU <Engineering>", "serial": "SN%20A", "zero": 0, "flag": false})
        )
        .is_ok());
    }

    #[test]
    fn unknown_network_and_volume_only_inventory_do_not_invent_summary_facts() {
        let data = json!({"uuid": {"hardware": "HW-volume-only"}, "net": [],
            "diskLayout": [{"mount": "C:\\", "fsType": "NTFS", "size": 500}, {"mount": "D:\\", "fsType": "NTFS", "size": 500}]});
        let observation = build_test_observation("", &data).unwrap();
        assert_eq!(observation["asset"]["summary"]["primary_ip"], "");
        assert!(observation["asset"]["summary"]["disk_bytes"].is_null());
        assert_eq!(observation["asset"]["hardware"]["disks"], json!([]));
        assert_eq!(
            observation["asset"]["hardware"]["volumes"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn resolves_common_site_inputs_to_v3_observation_endpoint() {
        assert_eq!(
            resolved_observation_endpoint("https://example.com"),
            "https://example.com/?rest_route=/npcink-device-inventory/v1/device-observations"
        );
        assert_eq!(
            resolved_observation_endpoint("https://example.com/wordpress/"),
            "https://example.com/wordpress/?rest_route=/npcink-device-inventory/v1/device-observations"
        );
        assert_eq!(
            resolved_observation_endpoint("https://example.com/wp-json"),
            "https://example.com/wp-json/npcink-device-inventory/v1/device-observations"
        );
        assert_eq!(
            resolved_observation_endpoint("https://example.com/wp-json/npcink-device-inventory/v1"),
            "https://example.com/wp-json/npcink-device-inventory/v1/device-observations"
        );
        assert_eq!(
            resolved_observation_endpoint(
                "https://example.com/wp-json/npcink-device-inventory/v1/device-observations/"
            ),
            "https://example.com/wp-json/npcink-device-inventory/v1/device-observations"
        );
        assert_eq!(
            resolved_observation_endpoint(
                "https://example.com/index.php?rest_route=/npcink-device-inventory/v1/device-observations"
            ),
            "https://example.com/index.php?rest_route=/npcink-device-inventory/v1/device-observations"
        );
    }

    #[test]
    fn rejects_non_https_upload_endpoints() {
        assert!(validate_upload_endpoint(
            "http://example.com/?rest_route=/npcink-device-inventory/v1/device-observations"
        )
        .is_err());
        assert!(
            validate_upload_endpoint("https://user:secret@example.com/device-observations")
                .is_err()
        );
        assert!(validate_upload_endpoint(
            "https://example.com/wp-json/npcink-device-inventory/v1/device-observations"
        )
        .is_ok());
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
            .contains("服务器返回成功状态 200 OK，但响应格式不是有效 JSON"));
    }

    #[test]
    fn maps_unauthorized_uploads_to_actionable_guidance() {
        let result = parse_submit_response(
            reqwest::StatusCode::UNAUTHORIZED,
            json!({"code": "invalid_token", "message": "Device token is invalid."}).to_string(),
        );
        let error = result
            .expect_err("unauthorized upload must fail")
            .to_string();
        assert!(error.contains("授权码无效、已禁用或签名校验失败"));
        assert!(error.contains("技术详情：Device token is invalid."));
    }

    #[test]
    fn graphics_summary_does_not_repeat_vendor_or_change_raw_hardware() {
        for (vendor, model, expected) in [
            (
                "NVIDIA",
                "NVIDIA GeForce GTX 1650",
                "NVIDIA GeForce GTX 1650",
            ),
            (
                "Intel(R)",
                "Intel(R) Iris(R) Xe Graphics",
                "Intel(R) Iris(R) Xe Graphics",
            ),
            (
                " nvidia ",
                " NVIDIA GeForce GTX 1650 ",
                "NVIDIA GeForce GTX 1650",
            ),
            ("AMD", "Radeon RX 6600", "AMD Radeon RX 6600"),
            ("", "Test GPU", "Test GPU"),
            ("NVIDIA", "", "NVIDIA"),
        ] {
            let data = json!({
                "uuid": {"hardware": "9e9738c7-0418-fb17-af0e-345a601d798b"},
                "graphics": {"controllers": [{"vendor": vendor, "model": model}]}
            });
            let observation = build_test_observation("", &data).unwrap();
            assert_eq!(observation["asset"]["summary"]["graphics"], expected);
            assert_eq!(
                observation["asset"]["hardware"]["graphics"],
                data["graphics"]
            );
        }
    }

    #[test]
    fn complete_inventory_preserves_collected_fields_and_separates_volumes() {
        let data = json!({
            "uuid": {"hardware": "HW-COMPLETE", "macs": ["aa:bb:cc:dd:ee:ff"]},
            "os": {"platform": "windows", "hostname": "WORKSTATION", "arch": "x86_64", "kernel": "10.0"},
            "system": {"model": "Workstation 500"},
            "chassis": {"type": "Desktop", "serial": "CASE-1"},
            "mem": {"total": 17179869184_u64},
            "memLayout": [{"size": 17179869184_u64, "bank": "DIMM_A1", "clockSpeed": 3200, "ratedSpeed": 3600}],
            "memoryArrays": [{"slots": 4, "maxCapacityBytes": 137438953472_u64}],
            "diskLayout": [{"model": "SSD-500", "size": 500000000000_u64, "firmwareRevision": "2A"}],
            "fsSize": [{"mount": "C:\\", "size": 300000000000_u64, "used": 100000000000_u64, "fsType": "NTFS"}, {"mount": "D:\\", "size": 200000000000_u64, "fsType": "NTFS"}],
            "hardwareProbeAttempts": [{"source": "cameras", "status": "empty"}],
            "platformData": {"memory_modules": [{"Manufacturer": "Test", "DataWidth": 64}]},
            "peripherals": {"audio": [{"name": "Audio", "status": "OK"}]},
            "storage": {"topology":{"status":"partial", "volumeMappings":[{"mount":"C:\\\\", "diskDevices":["disk-a","disk-b"], "matchStatus":"matched"}, {"mount":"D:\\\\", "diskDevices":[], "matchStatus":"ambiguous"}]}, "healthMappings":[{"healthRecordIndex":0,"storageUniqueId":"uid-a","matchStatus":"matched"}]},
            "futureHardware": {"reportedFact": false}
        });
        let before = data.clone();
        let payload = build_test_observation("test", &data).unwrap();
        let h = &payload["asset"]["hardware"];
        for key in [
            "os",
            "chassis",
            "uuid",
            "platformData",
            "peripherals",
            "futureHardware",
            "storage",
        ] {
            assert_eq!(h[key], data[key], "collected {key} must survive upload");
        }
        assert_eq!(h["volumes"], data["fsSize"]);
        assert_eq!(h["memory"]["arrays"], data["memoryArrays"]);
        assert_eq!(
            h["collection"]["hardwareProbes"],
            data["hardwareProbeAttempts"]
        );
        assert_eq!(h["disks"].as_array().unwrap().len(), 1);
        assert_eq!(payload["asset"]["summary"]["disk_bytes"], 500000000000_u64);
        assert_eq!(payload["asset"]["summary"]["hostname"], "WORKSTATION");
        assert_eq!(data, before);
        let hostname_only = json!({"uuid": {"hardware": "HW-2"}, "os": {"hostname": "PC-NAME"}});
        assert_eq!(
            build_test_observation("test", &hostname_only).unwrap()["asset"]["summary"]
                ["device_model"],
            ""
        );
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

        let observation = build_test_observation("Alice", &data).unwrap();
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
