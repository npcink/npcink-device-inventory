use anyhow::{bail, Context, Result};
use hmac::{Hmac, Mac};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const OBSERVATION_ROUTE: &str = "/npcink-device-inventory/v1/device-observations";

pub fn submit_v3(site: &str, name: &str, token_value: &str, data: &Value) -> Result<Value> {
    submit_v3_with_progress(site, name, token_value, data, &mut |_| {})
}

pub fn submit_v3_with_progress(
    site: &str,
    name: &str,
    token_value: &str,
    data: &Value,
    progress: &mut dyn FnMut(UploadProgress),
) -> Result<Value> {
    let endpoint = resolved_observation_endpoint(site);
    validate_upload_endpoint(&endpoint)?;
    if let Some(token) = parse_client_token(token_value)? {
        let body = json!({
            "observation": build_observation_v3(name, data)?,
        });
        return submit_json_hmac_with_method(Method::POST, &endpoint, &body, &token, progress);
    }

    bail!("新版上传接口必须使用后台生成的上传授权码");
}

pub fn verify_connection(site: &str, token_value: &str) -> Result<String> {
    verify_connection_with_progress(site, token_value, &mut |_| {})
}

pub fn verify_connection_with_progress(
    site: &str,
    token_value: &str,
    progress: &mut dyn FnMut(UploadProgress),
) -> Result<String> {
    let endpoint = format!(
        "{}/verify",
        resolved_observation_endpoint(site).trim_end_matches('/')
    );
    validate_config_values(&endpoint, token_value)?;
    let token =
        parse_client_token(token_value)?.context("上传授权码格式不正确，请从后台重新复制")?;
    submit_json_hmac_with_method(Method::GET, &endpoint, &json!({}), &token, progress)?;
    Ok("连接正常，站点地址和授权码均可用。".to_string())
}

const MAX_ATTEMPTS: usize = 3;
const TOTAL_TIMEOUT: Duration = Duration::from_secs(45);
const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(15);

/// Contains only locally owned messages and bounded diagnostics; no request secrets or bodies.
#[derive(Clone, Debug, Serialize)]
pub struct UploadProgress {
    pub attempt: usize,
    pub max_attempts: usize,
    pub category: String,
    pub http_status: Option<u16>,
    pub elapsed_ms: u64,
    pub retry_delay_ms: Option<u64>,
    pub message: String,
}

#[derive(Debug)]
struct AttemptFailure {
    category: &'static str,
    status: Option<u16>,
    retryable: bool,
    retry_after: Option<Duration>,
    message: String,
}

impl AttemptFailure {
    fn new(category: &'static str, retryable: bool, message: impl Into<String>) -> Self {
        Self {
            category,
            status: None,
            retryable,
            retry_after: None,
            message: message.into(),
        }
    }
}

fn submit_json_hmac_with_method<T: Serialize>(
    method: Method,
    site: &str,
    body: &T,
    token: &ClientToken,
    progress: &mut dyn FnMut(UploadProgress),
) -> Result<Value> {
    let route = signed_route(&method, site)?;
    validate_payload(body)?;
    let body_json = serde_json::to_string(body)
        .context("采集数据编码失败，尚未上传；请重新采集，不要重复重试。")?;
    if body_json.len() > MAX_BODY_BYTES {
        bail!("采集数据超过 2 MiB 上传限制，请导出硬件反馈核对；尚未上传，不要重复重试。");
    }
    // Build once per operation so changes to system/environment proxies take effect next time.
    let client = http_client_builder().build().map_err(|_| {
        anyhow::anyhow!("无法初始化安全网络连接，请检查系统网络和代理配置，不要重复重试。")
    })?;
    let proxy_selected = site
        .parse()
        .ok()
        .and_then(|uri| hyper_util::client::proxy::matcher::Matcher::from_system().intercept(&uri))
        .is_some();
    run_attempts(
        &method,
        route,
        &body_json,
        token,
        TOTAL_TIMEOUT,
        progress,
        |headers, timeout| {
            send_json(
                &client,
                method.clone(),
                site,
                &body_json,
                headers,
                timeout,
                proxy_selected,
            )
        },
    )
}

fn signed_headers(
    method: &Method,
    route: &str,
    body: &str,
    token: &ClientToken,
    previous_timestamp: &mut u64,
) -> Result<Vec<(&'static str, String)>> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("系统时间无效，请校准时间，不要重复重试。")?
        .as_secs();
    // Second resolution is mandated by the server. Ensure even subsecond retries have a
    // fresh timestamp; at most two seconds ahead, within the server's 300-second window.
    *previous_timestamp = now.max(previous_timestamp.saturating_add(1));
    let timestamp = previous_timestamp.to_string();
    let nonce: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let body_hash = hex_encode(&Sha256::digest(body.as_bytes()));
    let payload = signing_payload(method, route, &token.id, &timestamp, &nonce, &body_hash);
    let mut mac = HmacSha256::new_from_slice(token.secret.as_bytes())
        .context("无法生成上传签名，请重新导入授权码。")?;
    mac.update(payload.as_bytes());
    Ok(vec![
        ("x-npcink-device-signature-version", "2".into()),
        ("x-npcink-device-token-id", token.id.clone()),
        ("x-npcink-device-timestamp", timestamp),
        ("x-npcink-device-nonce", nonce),
        (
            "x-npcink-device-signature",
            format!("sha256={}", hex_encode(&mac.finalize().into_bytes())),
        ),
    ])
}

fn run_attempts(
    method: &Method,
    route: &str,
    body: &str,
    token: &ClientToken,
    budget: Duration,
    progress: &mut dyn FnMut(UploadProgress),
    mut send: impl FnMut(
        Vec<(&'static str, String)>,
        Duration,
    ) -> std::result::Result<(Value, u16), AttemptFailure>,
) -> Result<Value> {
    let started = Instant::now();
    let mut previous_timestamp = 0;
    for attempt in 1..=MAX_ATTEMPTS {
        let remaining = budget.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            bail!("上传总等待时间已达上限，请检查网络和代理，或联系管理员确认上传结果。");
        }
        progress(UploadProgress {
            attempt,
            max_attempts: MAX_ATTEMPTS,
            category: "attempt".into(),
            http_status: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
            retry_delay_ms: None,
            message: format!("正在进行第 {attempt}/{MAX_ATTEMPTS} 次尝试…"),
        });
        let headers = signed_headers(method, route, body, token, &mut previous_timestamp)?;
        match send(headers, ATTEMPT_TIMEOUT.min(remaining)) {
            Ok((value, status)) => {
                progress(UploadProgress {
                    attempt,
                    max_attempts: MAX_ATTEMPTS,
                    category: "success".into(),
                    http_status: Some(status),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    retry_delay_ms: None,
                    message: "操作成功。".into(),
                });
                return Ok(value);
            }
            Err(error) => {
                let delay = Duration::from_millis(
                    400 * (1 << (attempt - 1)) + rand::thread_rng().gen_range(0..=150),
                );
                let delay = delay.max(error.retry_after.unwrap_or_default());
                let retry = error.retryable
                    && attempt < MAX_ATTEMPTS
                    && delay < budget.saturating_sub(started.elapsed());
                let message = format!(
                    "第 {attempt}/{MAX_ATTEMPTS} 次尝试失败：{}{}",
                    error.message,
                    if retry {
                        " 正在重试…"
                    } else if error.retryable {
                        " 自动重试已结束，请检查网络、代理或联系管理员确认结果。"
                    } else {
                        " 已停止自动重试，请先处理上述问题，不要重复重试。"
                    }
                );
                progress(UploadProgress {
                    attempt,
                    max_attempts: MAX_ATTEMPTS,
                    category: error.category.into(),
                    http_status: error.status,
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    retry_delay_ms: retry.then_some(delay.as_millis() as u64),
                    message: message.clone(),
                });
                if !retry {
                    bail!("{message}");
                }
                std::thread::sleep(delay);
            }
        }
    }
    unreachable!("attempt loop always returns")
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
    let url = url::Url::parse(endpoint)
        .context("上传地址格式无效，请重新导入正确地址，不要重复重试。")?;
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
    client: &Client,
    method: Method,
    site: &str,
    body_json: &str,
    headers: Vec<(&'static str, String)>,
    timeout: Duration,
    proxy_selected: bool,
) -> std::result::Result<(Value, u16), AttemptFailure> {
    let is_verify = method == Method::GET;
    let mut request = client
        .request(method, site)
        .timeout(timeout)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .body(body_json.to_owned());
    for (name, value) in headers {
        let mut value = reqwest::header::HeaderValue::from_str(&value).map_err(|_| {
            AttemptFailure::new(
                "authorization",
                false,
                "上传授权码不能生成有效请求头，请从后台重新复制。",
            )
        })?;
        value.set_sensitive(true);
        request = request.header(name, value);
    }
    let response = request
        .send()
        .map_err(|error| classify_transport(&error, proxy_selected))?;
    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(retry_after_seconds);
    if status.is_redirection() {
        return Err(AttemptFailure {
            category: "redirect",
            status: Some(status.as_u16()),
            retryable: false,
            retry_after: None,
            message: format!(
                "站点要求跳转（HTTP {status}），已停止发送。请直接配置最终 HTTPS 站点地址。"
            ),
        });
    }
    let text = read_response_body(response).map_err(|error| {
        // A timed out/reset response is also transient. Never expose the source chain.
        let mut failure = if error.downcast_ref::<BodyReadFailure>().is_some() {
            classify_transport(error.as_ref(), proxy_selected)
        } else {
            AttemptFailure::new("response_limit_or_encoding", false, error.to_string())
        };
        failure.message = format!("站点响应读取失败（HTTP {status}）：{}", failure.message);
        failure.status = Some(status.as_u16());
        failure.retryable &= status.is_success() || matches!(status.as_u16(), 502..=504);
        failure
    })?;
    let business_failure = serde_json::from_str::<Value>(&text)
        .ok()
        .is_some_and(|body| {
            non_retryable_code(body.get("code").and_then(Value::as_str).unwrap_or_default())
        });
    let payload = parse_submit_response(status, text).map_err(|error| {
        let mut message = error.to_string();
        if matches!(status.as_u16(), 429 | 503) {
            if let Some(seconds) = retry_after {
                message.push_str(&format!(" 服务器要求至少等待 {seconds} 秒后再试。"));
            }
        }
        AttemptFailure {
            category: if status.is_success() {
                "non_json"
            } else {
                "http"
            },
            status: Some(status.as_u16()),
            retryable: matches!(status.as_u16(), 502..=504) && !business_failure,
            retry_after: retry_after.map(Duration::from_secs),
            message,
        }
    })?;
    validate_success_response(&payload, is_verify).map_err(|error| AttemptFailure {
        category: "response_contract",
        status: Some(status.as_u16()),
        retryable: false,
        retry_after: None,
        message: error.to_string(),
    })?;
    Ok((payload, status.as_u16()))
}

fn retry_after_seconds(value: &str) -> Option<u64> {
    value.parse::<u64>().ok().or_else(|| {
        chrono::DateTime::parse_from_rfc2822(value)
            .ok()
            .map(|date| {
                (date.with_timezone(&chrono::Utc) - chrono::Utc::now())
                    .num_seconds()
                    .max(0) as u64
            })
    })
}

fn http_client_builder() -> reqwest::blocking::ClientBuilder {
    Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        // Hidden protocol retries could reuse a nonce, so all retries belong to our loop.
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(8))
        .timeout(ATTEMPT_TIMEOUT)
        .user_agent(format!("npcink-device-agent/{}", env!("CARGO_PKG_VERSION")))
}

#[derive(Debug)]
struct BodyReadFailure(std::io::Error);
impl std::fmt::Display for BodyReadFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("读取站点响应失败，请检查网络或代理。")
    }
}
impl std::error::Error for BodyReadFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.0)
    }
}

fn classify_transport(
    error: &(dyn std::error::Error + 'static),
    proxy_selected: bool,
) -> AttemptFailure {
    let mut current = Some(error);
    let mut details = String::new();
    let mut tls = false;
    let mut timeout = false;
    let mut temporary_io = false;
    let mut refused = false;
    while let Some(cause) = current {
        // These details are inspected only in memory, never returned or logged.
        if !cause.is::<reqwest::Error>() {
            details.push_str(&cause.to_string().to_ascii_lowercase());
        }
        details.push(' ');
        tls |= cause.downcast_ref::<rustls::Error>().is_some();
        if let Some(request) = cause.downcast_ref::<reqwest::Error>() {
            timeout |= request.is_timeout();
        }
        if let Some(io) = cause.downcast_ref::<std::io::Error>() {
            timeout |= io.kind() == std::io::ErrorKind::TimedOut;
            refused |= io.kind() == std::io::ErrorKind::ConnectionRefused;
            temporary_io |= matches!(
                io.kind(),
                std::io::ErrorKind::ConnectionReset
                    | std::io::ErrorKind::ConnectionAborted
                    | std::io::ErrorKind::BrokenPipe
                    | std::io::ErrorKind::UnexpectedEof
            );
        }
        current = if let Some(io) = cause.downcast_ref::<std::io::Error>() {
            io.get_ref()
                .map(|inner| inner as &(dyn std::error::Error + 'static))
                .or_else(|| cause.source())
        } else {
            cause.source()
        };
    }
    if tls
        || [
            "invalid peer certificate",
            "invalid certificate",
            "tls handshake",
            "handshake failure",
        ]
        .iter()
        .any(|word| details.contains(word))
    {
        return AttemptFailure::new("tls", false, "TLS/HTTPS 证书或握手失败，请核对系统时间、站点证书链和 HTTPS 代理；联系管理员修复证书。");
    }
    let proxy_error = ["proxy", "tunnel"]
        .iter()
        .any(|word| details.contains(word));
    if proxy_error || (proxy_selected && (refused || timeout)) {
        return AttemptFailure::new("proxy", timeout || temporary_io, "代理连接失败，请检查系统或环境代理是否运行、端口和认证是否正确；也请核对代理到站点的连通性。");
    }
    if timeout {
        return AttemptFailure::new(
            "timeout",
            true,
            "连接或响应超时，请检查网络、代理和站点可用性。",
        );
    }
    // getaddrinfo errors have no portable typed DNS error. Match known resolver labels,
    // and retry only explicit temporary resolution failures (never NXDOMAIN by default).
    if [
        "dns error",
        "failed to lookup address",
        "name or service not known",
        "nodename nor servname",
        "no such host",
        "temporary failure in name resolution",
    ]
    .iter()
    .any(|word| details.contains(word))
    {
        return AttemptFailure::new(
            "dns",
            details.contains("temporary failure") || details.contains("try again"),
            "DNS 解析失败，请核对站点域名、DNS 设置、网络和代理；域名不存在时请联系管理员。",
        );
    }
    if temporary_io {
        return AttemptFailure::new(
            "connection_reset",
            true,
            "连接被重置或中断，请检查网络稳定性及代理。使用同一采集编号重试不会重复建档。",
        );
    }
    if refused {
        return AttemptFailure::new(
            "connection_refused",
            false,
            "连接被拒绝，请检查站点端口、服务是否运行、防火墙或代理设置。",
        );
    }
    AttemptFailure::new(
        "connection",
        false,
        "无法建立或完成站点连接，请检查网络、站点地址、防火墙和代理，或联系管理员。",
    )
}

fn read_response_body(response: impl Read) -> Result<String> {
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(BodyReadFailure)?;
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
    fn visit(value: &Value, depth: usize, nodes: &mut usize) -> Result<()> {
        *nodes += 1;
        if depth > 24 || *nodes > 20_000 {
            bail!("采集结构超过上传限制（深度或节点数量），尚未上传，请处理后再试，不要重复重试。");
        }
        match value {
            Value::Array(items) => {
                if items.len() > 512 {
                    bail!("采集数组超过 512 项，尚未上传，请处理后再试，不要重复重试。");
                }
                for item in items {
                    visit(item, depth + 1, nodes)?;
                }
            }
            Value::Object(items) => {
                if items.len() > 512 {
                    bail!("采集对象超过 512 项，尚未上传，请处理后再试，不要重复重试。");
                }
                for (key, item) in items {
                    if key.len() > 128 {
                        bail!("采集字段名超过 128 字节，尚未上传，请处理后再试，不要重复重试。");
                    }
                    visit(item, depth + 1, nodes)?;
                }
            }
            Value::String(text) if text.len() > 10_000 => {
                bail!("采集字符串超过 10000 字节，尚未上传，请处理后再试，不要重复重试。");
            }
            _ => {}
        }
        Ok(())
    }
    visit(&serde_json::to_value(body)?, 0, &mut 0)
}

fn non_retryable_code(code: &str) -> bool {
    matches!(
        code,
        "unsupported_signature_version"
            | "expired_signature"
            | "invalid_signature"
            | "invalid_signature_headers"
            | "missing_signature"
            | "replayed_nonce"
            | "invalid_token"
            | "token_scope_denied"
            | "unsigned_query_parameters"
            | "invalid_payload"
            | "invalid_identity"
            | "missing_identity"
            | "invalid_observation_field"
            | "invalid_observation_time"
            | "unsupported_observation_schema"
            | "observation_id_conflict"
            | "asset_archived"
            | "identity_evidence_conflict"
            | "identity_claim_conflict"
            | "identity_owner_unavailable"
            | "invalid_json"
            | "observation_key_too_large"
            | "observation_string_too_large"
            | "observation_too_complex"
            | "observation_too_large"
            | "rest_forbidden"
            | "duplicate_number"
    )
}

fn known_server_code(code: &str) -> bool {
    non_retryable_code(code)
        || matches!(
            code,
            "asset_create_failed"
                | "asset_update_failed"
                | "event_create_failed"
                | "identity_claim_failed"
                | "observation_create_failed"
                | "transaction_commit_failed"
                | "transaction_start_failed"
                | "observation_lookup_failed"
        )
}

fn parse_submit_response(status: reqwest::StatusCode, text: String) -> Result<Value> {
    let payload = serde_json::from_str::<Value>(&text).map_err(|_| {
        anyhow::anyhow!(
            "站点返回了网页或其他非 JSON 内容（HTTP {status}），无法确认操作结果。请核对站点地址及设备接口，检查登录限制、防火墙或代理设置；若仍失败，请联系站点管理员核对服务器日志。"
        )
    })?;
    if !status.is_success() {
        let code = payload
            .get("code")
            .and_then(Value::as_str)
            .filter(|code| known_server_code(code))
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
            (429, _) => "上传过于频繁，本次不自动重试，请按服务器等待要求稍后再试。",
            (422, _) => "上传数据或设备身份校验失败，请重新采集并联系管理员核对，不要重复重试。",
            (500..=599, _) => "服务器暂时无法处理上传，请稍后重试并查看 WordPress 日志。",
            _ => "请检查站点地址和插件状态；如仍失败，请将 HTTP 状态和错误码提供给管理员。",
        };
        // Server messages can contain WordPress HTML, stack traces, or reflected input.
        // Only expose allowlisted machine codes alongside locally owned guidance.
        if code.is_empty() {
            bail!("上传失败（HTTP {status}）。{guidance}");
        }
        bail!("上传失败（HTTP {status}）。{guidance}\n错误码：{code}");
    }

    Ok(payload)
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
            "无法生成设备身份，尚未上传，请处理后再试，不要重复重试。系统 UUID：{}；主板序列号：{}；主板厂商：{}；主板型号：{}；CPU 型号：{}；有效永久 PCI MAC：{} 个；查询失败：{} 项。请重新采集；若仍失败，请导出硬件反馈供管理员核对。",
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
    let parsed = url::Url::parse(endpoint.trim())
        .context("上传地址格式无效，请重新导入正确地址，不要重复重试。")?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        bail!("设备上传必须使用 HTTPS 地址，且不能包含账号密码；请修正地址，不要重复重试。");
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

    fn fixture_token() -> ClientToken {
        ClientToken {
            id: "fixture".into(),
            secret: "private-secret".into(),
        }
    }

    // Only fixtures permit local HTTP and disable proxies. Production retains HTTPS,
    // system/environment proxy selection and the same no-redirect/no-hidden-retry policy.
    fn fixture_client() -> Client {
        http_client_builder()
            .https_only(false)
            .no_proxy()
            .build()
            .unwrap()
    }

    fn fixture_server(
        replies: Vec<(u16, String, String)>,
    ) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let site = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            use std::io::Write;
            let mut requests = Vec::new();
            for (status, body, extra_headers) in replies {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            std::thread::sleep(Duration::from_millis(5))
                        }
                        Err(e) => panic!("fixture accept: {e}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buf = [0; 4096];
                loop {
                    let count = stream.read(&mut buf).unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&buf[..count]);
                    let raw = String::from_utf8_lossy(&bytes);
                    if let Some((head, body)) = raw.split_once("\r\n\r\n") {
                        let length: usize = head
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length: ")
                                    .and_then(|s| s.parse().ok())
                            })
                            .unwrap_or(0);
                        if body.len() >= length {
                            break;
                        }
                    }
                }
                requests.push(String::from_utf8(bytes).unwrap());
                write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n{body}", body.len()).unwrap();
            }
            // Catch an unintended retry or followed redirect, instead of silently allowing it.
            let deadline = Instant::now() + Duration::from_millis(200);
            while Instant::now() < deadline {
                assert!(listener.accept().is_err(), "unexpected extra request");
                std::thread::sleep(Duration::from_millis(5));
            }
            requests
        });
        (site, worker)
    }

    fn fixture_run(
        client: &Client,
        method: Method,
        site: &str,
        timeout: Duration,
        events: &mut Vec<UploadProgress>,
    ) -> Result<Value> {
        run_attempts(
            &method,
            OBSERVATION_ROUTE,
            "{}",
            &fixture_token(),
            TOTAL_TIMEOUT,
            &mut |event| events.push(event),
            |headers, remaining| {
                send_json(
                    client,
                    method.clone(),
                    site,
                    "{}",
                    headers,
                    timeout.min(remaining),
                    false,
                )
            },
        )
    }

    #[test]
    fn transient_http_retry_keeps_body_but_renews_all_signature_fields() {
        let success = json!({"data":{"observation":{"id":1},"asset":{"uuid":"asset"}}});
        let (site, server) = fixture_server(vec![
            (
                503,
                "<html>private-html mda_private_token</html>".into(),
                "".into(),
            ),
            (200, success.to_string(), "".into()),
        ]);
        let mut events = Vec::new();
        assert_eq!(
            fixture_run(
                &fixture_client(),
                Method::POST,
                &site,
                ATTEMPT_TIMEOUT,
                &mut events
            )
            .unwrap(),
            success
        );
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        let header = |index: usize, name: &str| {
            requests[index]
                .lines()
                .find_map(|line| line.strip_prefix(&format!("{name}: ")))
                .unwrap()
                .to_string()
        };
        for name in [
            "x-npcink-device-timestamp",
            "x-npcink-device-nonce",
            "x-npcink-device-signature",
        ] {
            assert_ne!(header(0, name), header(1, name));
        }
        for (index, request) in requests.iter().enumerate() {
            let body = request.split_once("\r\n\r\n").unwrap().1;
            assert_eq!(body, "{}");
            let payload = signing_payload(
                &Method::POST,
                OBSERVATION_ROUTE,
                "fixture",
                &header(index, "x-npcink-device-timestamp"),
                &header(index, "x-npcink-device-nonce"),
                &hex_encode(&Sha256::digest(body.as_bytes())),
            );
            let mut mac = HmacSha256::new_from_slice(b"private-secret").unwrap();
            mac.update(payload.as_bytes());
            assert_eq!(
                header(index, "x-npcink-device-signature"),
                format!("sha256={}", hex_encode(&mac.finalize().into_bytes()))
            );
        }
        assert_eq!(events.last().unwrap().category, "success");
        assert_eq!(events.last().unwrap().attempt, 2);
        let text = serde_json::to_string(&events).unwrap();
        assert!(!text.contains("private-html"));
        assert!(!text.contains("mda_private"));
    }

    #[test]
    fn http_retries_are_bounded_and_final_error_is_actionable() {
        for status in [502, 503, 504] {
            let (site, server) =
                fixture_server(vec![(status, "private-server-stack".into(), "".into()); 3]);
            let mut events = Vec::new();
            let error = fixture_run(
                &fixture_client(),
                Method::POST,
                &site,
                ATTEMPT_TIMEOUT,
                &mut events,
            )
            .unwrap_err()
            .to_string();
            assert!(error.contains("第 3/3 次尝试失败"));
            assert!(error.contains(&format!("HTTP {status}")));
            assert!(error.contains("管理员"));
            assert!(!error.contains("private-server-stack"));
            assert_eq!(server.join().unwrap().len(), 3);
            assert_eq!(
                events
                    .iter()
                    .filter(|event| event.retry_delay_ms.is_some())
                    .count(),
                2
            );
        }
    }

    #[test]
    fn permanent_http_errors_and_redirects_never_retry_or_leak() {
        for status in [
            301, 302, 307, 308, 401, 403, 404, 409, 413, 422, 429, 500, 501,
        ] {
            let body = json!({"code":"mda_reflected_secret", "message":"<html>sha256=private-signature</html>"}).to_string();
            let (site, server) = fixture_server(vec![(
                status,
                body,
                "Location: /leak\r\nRetry-After: 120\r\n".into(),
            )]);
            let mut events = Vec::new();
            let error = fixture_run(
                &fixture_client(),
                Method::POST,
                &site,
                ATTEMPT_TIMEOUT,
                &mut events,
            )
            .unwrap_err()
            .to_string();
            assert!(error.contains(&format!("HTTP {status}")));
            assert!(error.contains("不要重复重试"));
            if status == 429 {
                assert!(error.contains("120 秒"));
            }
            assert!(!error.contains("mda_reflected"));
            assert!(!error.contains("sha256="));
            assert!(!error.contains("<html>"));
            assert_eq!(server.join().unwrap().len(), 1);
            assert!(events.iter().all(|event| event.retry_delay_ms.is_none()));
        }
        for code in ["invalid_signature", "missing_identity", "invalid_payload"] {
            let (site, server) =
                fixture_server(vec![(503, json!({"code":code}).to_string(), "".into())]);
            assert!(fixture_run(
                &fixture_client(),
                Method::POST,
                &site,
                ATTEMPT_TIMEOUT,
                &mut Vec::new()
            )
            .is_err());
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }

    #[test]
    fn real_timeout_is_retried_only_twice_with_a_total_budget() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let site = format!("http://{}", listener.local_addr().unwrap());
        // Keeping the listener open without accepting forces each request to time out.
        let mut events = Vec::new();
        let start = Instant::now();
        let error = fixture_run(
            &fixture_client(),
            Method::POST,
            &site,
            Duration::from_millis(40),
            &mut events,
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("超时"));
        assert!(error.contains("第 3/3"));
        assert_eq!(
            events
                .iter()
                .filter(|event| event.category == "timeout")
                .count(),
            3
        );
        assert!(start.elapsed() < Duration::from_secs(4));
        let mut calls = 0;
        let error = run_attempts(
            &Method::POST,
            OBSERVATION_ROUTE,
            "{}",
            &fixture_token(),
            Duration::from_millis(100),
            &mut |_| {},
            |_, timeout| {
                calls += 1;
                assert!(timeout <= Duration::from_millis(100));
                std::thread::sleep(timeout);
                Err(AttemptFailure::new("timeout", true, "连接超时"))
            },
        )
        .unwrap_err()
        .to_string();
        assert_eq!(calls, 1);
        assert!(error.contains("超时"));
        drop(listener);
    }

    #[test]
    fn transport_categories_preserve_tls_and_do_not_expose_sources() {
        for (error, proxy, category, retry) in [
            (
                std::io::Error::other(
                    "dns error: temporary failure in name resolution mda_private_token",
                ),
                false,
                "dns",
                true,
            ),
            (
                std::io::Error::other("dns error: no such host"),
                false,
                "dns",
                false,
            ),
            (
                std::io::Error::from(std::io::ErrorKind::ConnectionRefused),
                false,
                "connection_refused",
                false,
            ),
            (
                std::io::Error::from(std::io::ErrorKind::ConnectionRefused),
                true,
                "proxy",
                false,
            ),
            (
                std::io::Error::from(std::io::ErrorKind::ConnectionReset),
                false,
                "connection_reset",
                true,
            ),
            (
                std::io::Error::from(std::io::ErrorKind::TimedOut),
                false,
                "timeout",
                true,
            ),
            (
                std::io::Error::from(std::io::ErrorKind::TimedOut),
                true,
                "proxy",
                true,
            ),
            (
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    rustls::Error::InvalidCertificate(rustls::CertificateError::UnknownIssuer),
                ),
                false,
                "tls",
                false,
            ),
            (
                std::io::Error::other("proxy authentication required sha256=private"),
                true,
                "proxy",
                false,
            ),
        ] {
            let failure = classify_transport(&error, proxy);
            assert_eq!((failure.category, failure.retryable), (category, retry));
            assert!(!failure.message.contains("mda_"));
            assert!(!failure.message.contains("sha256="));
        }
    }

    #[test]
    fn unreachable_proxy_and_real_dns_failure_have_safe_categories() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let client = http_client_builder()
            .no_proxy()
            .proxy(reqwest::Proxy::https(format!("http://{address}")).unwrap())
            .build()
            .unwrap();
        let failure = send_json(
            &client,
            Method::POST,
            "https://example.invalid",
            "{}",
            vec![],
            // Windows may take over one second to report a closed loopback port.
            // Allow the refusal to arrive instead of testing a request timeout.
            Duration::from_secs(5),
            true,
        )
        .unwrap_err();
        assert_eq!(failure.category, "proxy");
        assert!(!failure.retryable);
        let error = fixture_client()
            .get("https://npcink-upload-fixture.invalid")
            .send()
            .unwrap_err();
        let failure = classify_transport(&error, false);
        assert_eq!(failure.category, "dns");
        assert!(!failure.message.contains("npcink-upload-fixture"));
    }

    #[test]
    fn response_body_timeout_is_transient_only_after_a_retryable_status() {
        for status in [200, 401, 403, 404, 409, 413, 429, 503] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let site = format!("http://{}", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                use std::io::Write;
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                assert!(stream.read(&mut request).unwrap() > 0);
                write!(
                    stream,
                    "HTTP/1.1 {status} Fixture\r\nContent-Length: 100\r\n\r\n"
                )
                .unwrap();
                std::thread::sleep(Duration::from_millis(150));
            });
            let failure = send_json(
                &fixture_client(),
                Method::POST,
                &site,
                "{}",
                vec![],
                Duration::from_millis(75),
                false,
            )
            .unwrap_err();
            assert_eq!(failure.category, "timeout");
            assert_eq!(failure.status, Some(status));
            assert_eq!(failure.retryable, matches!(status, 200 | 503));
            server.join().unwrap();
        }
    }

    #[test]
    fn retry_after_beyond_budget_stops_without_waiting_or_overflowing() {
        let (site, server) = fixture_server(vec![(
            503,
            "{}".into(),
            format!("Retry-After: {}\r\n", u64::MAX),
        )]);
        let started = Instant::now();
        let error = fixture_run(
            &fixture_client(),
            Method::POST,
            &site,
            ATTEMPT_TIMEOUT,
            &mut Vec::new(),
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("服务器要求至少等待"));
        assert_eq!(server.join().unwrap().len(), 1);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn response_limits_and_verify_contract_remain_in_the_real_send_path() {
        for body in [
            "x".repeat(MAX_RESPONSE_BYTES + 1),
            "<html>private</html>".into(),
            "{}".into(),
        ] {
            let (site, server) = fixture_server(vec![(200, body, "".into())]);
            let error = fixture_run(
                &fixture_client(),
                Method::GET,
                &site,
                ATTEMPT_TIMEOUT,
                &mut Vec::new(),
            )
            .unwrap_err()
            .to_string();
            assert!(!error.contains("private"));
            assert_eq!(server.join().unwrap().len(), 1);
        }
        let (site, server) = fixture_server(vec![(
            200,
            json!({"data":{"connected":true}}).to_string(),
            "".into(),
        )]);
        assert!(fixture_run(
            &fixture_client(),
            Method::GET,
            &site,
            ATTEMPT_TIMEOUT,
            &mut Vec::new()
        )
        .is_ok());
        assert!(server.join().unwrap()[0].starts_with("GET "));
        assert_eq!(retry_after_seconds("120"), Some(120));
        assert_eq!(
            retry_after_seconds("Wed, 21 Oct 2015 07:28:00 GMT"),
            Some(0)
        );
        assert_eq!(retry_after_seconds("<html>"), None);
    }

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
        assert!(error.to_string().contains("HTTP 200 OK"));
        assert!(error.to_string().contains("非 JSON"));
        assert!(!error.to_string().contains("<!doctype"));
    }

    #[test]
    fn server_markup_and_unbounded_messages_never_reach_upload_errors() {
        for message in [
            "<p>发生错误</p><script>private-server-detail</script>".to_string(),
            "<!DOCTYPE html><html><body>private-server-detail</body></html>".to_string(),
            "private-server-detail".repeat(2000),
        ] {
            let error = parse_submit_response(
                reqwest::StatusCode::FORBIDDEN,
                json!({"code": "rest_forbidden", "message": message}).to_string(),
            )
            .unwrap_err()
            .to_string();
            assert!(error.contains("HTTP 403 Forbidden"));
            assert!(error.contains("错误码：rest_forbidden"));
            assert!(error.contains("没有上传权限"));
            assert!(!error.contains("<"));
            assert!(!error.contains("private-server-detail"));
            assert!(error.chars().count() < 300);
        }
        for code in ["<html>private</html>", "forged\nmessage", &"x".repeat(1000)] {
            let error = parse_submit_response(
                reqwest::StatusCode::BAD_REQUEST,
                json!({"code": code, "message": "private-server-detail"}).to_string(),
            )
            .unwrap_err()
            .to_string();
            assert!(!error.contains("错误码："));
            assert!(!error.contains("private"));
        }
    }

    #[test]
    fn non_json_errors_report_the_http_boundary_without_guessing_token_failure() {
        for status in [
            reqwest::StatusCode::UNAUTHORIZED,
            reqwest::StatusCode::FORBIDDEN,
            reqwest::StatusCode::BAD_GATEWAY,
        ] {
            for body in [
                "<!doctype html><title>private-html-body</title>",
                "upstream unavailable",
                "",
            ] {
                let error = parse_submit_response(status, body.to_string())
                    .unwrap_err()
                    .to_string();
                assert!(error.contains(&format!("HTTP {status}")));
                assert!(error.contains("非 JSON"));
                assert!(error.contains("防火墙"));
                assert!(!error.contains("授权码无效"));
                assert!(!error.contains("private-html-body"));
                assert!(!error.contains("upstream unavailable"));
            }
        }
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
        assert!(error.contains("错误码：invalid_token"));
        assert!(!error.contains("Device token is invalid."));
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
