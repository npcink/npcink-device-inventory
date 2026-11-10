mod config;

use anyhow::{Context, Result};
use chrono::Local;
use npcink_device_agent::{collector, upload};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;
use zip::write::SimpleFileOptions;

use config::{clear_config, read_config, validate_config, write_config, AgentConfig, APP_DIR_NAME};

const APP_NAME: &str = "Npcink Device Agent";
const APP_LOG_FILE: &str = "app.log";
const APP_LOG_MAX_BYTES: u64 = 1024 * 1024;
const SNAPSHOT_CACHE_FILE: &str = "upload-snapshot.json";
const SNAPSHOT_CACHE_TTL: Duration = Duration::from_secs(600);
const DIAGNOSTICS_LOG_TAIL_BYTES: u64 = 256 * 1024;
const DIAGNOSTICS_PROGRESS_EVENT: &str = "diagnostics-progress";
const PROJECT_URL: &str = "https://github.com/npcink/npcink-device-inventory";
const MENU_CHECK_UPDATE: &str = "check_for_updates";
const MENU_CHECK_UPDATE_EVENT: &str = "desktop-check-update";
const MENU_OPEN_PROJECT: &str = "open_project_url";

#[derive(Debug, Serialize, Deserialize)]
struct DeviceSnapshot {
    data: Value,
    device_identity_type: String,
    device_identity: String,
}

#[derive(Debug, Deserialize)]
struct AppLogInput {
    level: Option<String>,
    event: String,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
struct DiagnosticsPackage {
    directory_path: String,
    zip_path: String,
}

#[derive(Debug, Serialize)]
struct HardwareFeedbackExport {
    directory_path: String,
    file_path: String,
}

#[derive(Debug, Clone, Serialize)]
struct DiagnosticsProgress {
    current: usize,
    total: usize,
    stage: String,
    detail: String,
}

struct DiagnosticsProgressEmitter {
    app: tauri::AppHandle,
    current: usize,
    total: usize,
}

#[tauri::command]
fn get_saved_config() -> Result<AgentConfig, String> {
    match read_config() {
        Ok(config) => Ok(config),
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "config.read_failed", &message);
            Err(message)
        }
    }
}

#[tauri::command]
fn save_config(config: AgentConfig) -> Result<(), String> {
    let log_message = format!(
        "has_site={} has_token={} config_label={}",
        !config.site.trim().is_empty(),
        !config.token.trim().is_empty(),
        empty_label(&config.preset_label),
    );
    match write_config(config) {
        Ok(()) => {
            write_app_log("info", "config.saved", &log_message);
            Ok(())
        }
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "config.save_failed", &message);
            Err(message)
        }
    }
}

#[tauri::command]
fn clear_saved_config() -> Result<(), String> {
    clear_config().map_err(|error| error.to_string())
}

#[tauri::command]
async fn verify_upload_config(config: AgentConfig) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_config(&config)?;
        npcink_device_agent::upload::verify_connection(&config.site, &config.token)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn collect_device_snapshot() -> Result<DeviceSnapshot, String> {
    let result = tauri::async_runtime::spawn_blocking(collect_device_snapshot_inner).await;
    match result {
        Ok(snapshot) => snapshot,
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "device.collect_static_task_failed", &message);
            Err(message)
        }
    }
}

#[tauri::command]
fn get_cached_device_snapshot() -> Result<Option<DeviceSnapshot>, String> {
    let path = app_data_dir()
        .map_err(|error| error.to_string())?
        .join(SNAPSHOT_CACHE_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let snapshot: DeviceSnapshot =
        serde_json::from_str(&raw).map_err(|error| format!("缓存快照格式无效：{error}"))?;
    let ttl = snapshot_cache_ttl(&snapshot);
    let age = fs::metadata(&path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.elapsed().ok());
    if age.is_none_or(|age| age >= ttl) || !snapshot_cache_is_current(&snapshot) {
        return Ok(None);
    }
    Ok(Some(snapshot))
}

fn snapshot_cache_ttl(snapshot: &DeviceSnapshot) -> Duration {
    let partial = ["hardwareProbeAttempts", "identityProbeAttempts"]
        .iter()
        .any(|key| {
            snapshot
                .data
                .get(key)
                .and_then(Value::as_array)
                .is_some_and(|probes| {
                    probes
                        .iter()
                        .any(|probe| !matches!(probe["status"].as_str(), Some("ok" | "empty")))
                })
        });
    if partial {
        Duration::from_secs(60)
    } else {
        SNAPSHOT_CACHE_TTL
    }
}

fn snapshot_cache_is_current(snapshot: &DeviceSnapshot) -> bool {
    snapshot
        .data
        .pointer("/collector/schema")
        .and_then(Value::as_str)
        == Some(collector::INVENTORY_SCHEMA)
        && snapshot
            .data
            .pointer("/collector/version")
            .and_then(Value::as_str)
            == Some(env!("CARGO_PKG_VERSION"))
        && snapshot
            .data
            .pointer("/collector/observation_id")
            .and_then(Value::as_str)
            .is_some_and(collector::valid_observation_id)
        && collector::hardware_identity_v2(&snapshot.data).is_some()
        && (snapshot
            .data
            .pointer("/os/platform")
            .and_then(Value::as_str)
            != Some("windows")
            || snapshot
                .data
                .get("hardwareProbeAttempts")
                .and_then(Value::as_array)
                .is_some_and(|probes| {
                    probes
                        .iter()
                        .any(|probe| probe["source"] == "graphics_memory")
                }))
}

fn collect_device_snapshot_inner() -> Result<DeviceSnapshot, String> {
    let started_at = Instant::now();
    match collector::collect_upload_data() {
        Ok(data) => {
            let (device_identity_type, device_identity) =
                collector::hardware_identity_v2(&data).unwrap_or(("", String::new()));
            write_app_log(
                if device_identity.is_empty() {
                    "warn"
                } else {
                    "info"
                },
                "device.identity_evaluated",
                &collector::identity_diagnostics(&data).to_string(),
            );
            write_app_log(
                "info",
                "device.collect_upload_succeeded",
                &format!("elapsed_ms={}", started_at.elapsed().as_millis()),
            );
            if let Err(error) = write_cached_device_snapshot(&DeviceSnapshot {
                data: data.clone(),
                device_identity_type: device_identity_type.to_string(),
                device_identity: device_identity.clone(),
            }) {
                write_app_log(
                    "warn",
                    "device.snapshot_cache_write_failed",
                    &error.to_string(),
                );
            }
            Ok(DeviceSnapshot {
                data,
                device_identity_type: device_identity_type.to_string(),
                device_identity,
            })
        }
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "device.collect_static_failed", &message);
            Err(message)
        }
    }
}

fn write_cached_device_snapshot(snapshot: &DeviceSnapshot) -> Result<()> {
    let directory = app_data_dir()?;
    fs::create_dir_all(&directory)?;
    let path = directory.join(SNAPSHOT_CACHE_FILE);
    let raw = serde_json::to_string(snapshot)?;
    fs::write(path, raw)?;
    Ok(())
}

#[tauri::command]
async fn submit_device_data(config: AgentConfig, data: Value) -> Result<Value, String> {
    let result =
        tauri::async_runtime::spawn_blocking(move || submit_device_data_inner(config, data)).await;
    match result {
        Ok(response) => response,
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "upload.task_failed", &message);
            Err(message)
        }
    }
}

fn submit_device_data_inner(config: AgentConfig, data: Value) -> Result<Value, String> {
    if let Err(error) = validate_config(&config) {
        write_app_log("warn", "upload.validation_failed", &error);
        return Err(error);
    }
    let started_at = Instant::now();
    match upload::submit_v3(&config.site, &config.name, &config.token, &data) {
        Ok(response) => {
            write_app_log(
                "info",
                "upload.succeeded",
                &format!(
                    "name_present={} site={} elapsed_ms={} payload_bytes={}",
                    !config.name.trim().is_empty(),
                    redact_url_for_log(&config.site),
                    started_at.elapsed().as_millis(),
                    serde_json::to_vec(&data)
                        .map(|body| body.len())
                        .unwrap_or_default(),
                ),
            );
            Ok(response)
        }
        Err(error) => {
            let message = error.to_string();
            write_app_log(
                "error",
                "upload.failed",
                &format!("site={} error={message}", redact_url_for_log(&config.site)),
            );
            Err(message)
        }
    }
}

#[tauri::command]
async fn generate_diagnostics_package(app: tauri::AppHandle) -> Result<DiagnosticsPackage, String> {
    write_app_log("info", "diagnostics.generate_started", "");
    let result =
        tauri::async_runtime::spawn_blocking(move || create_diagnostics_package(app)).await;
    match result {
        Ok(Ok(package)) => {
            write_app_log("info", "diagnostics.generated", &package.zip_path);
            Ok(package)
        }
        Ok(Err(error)) => {
            let message = error.to_string();
            write_app_log("error", "diagnostics.generate_failed", &message);
            Err(message)
        }
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "diagnostics.generate_failed", &message);
            Err(message)
        }
    }
}

#[tauri::command]
async fn export_hardware_feedback() -> Result<HardwareFeedbackExport, String> {
    write_app_log("info", "hardware_feedback.export_started", "");
    let result = tauri::async_runtime::spawn_blocking(create_hardware_feedback_export).await;
    match result {
        Ok(Ok(export)) => {
            write_app_log(
                "info",
                "hardware_feedback.exported",
                "file=device-hardware-feedback.json",
            );
            Ok(export)
        }
        Ok(Err(error)) => {
            let message = error.to_string();
            write_app_log("error", "hardware_feedback.export_failed", &message);
            Err(message)
        }
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "hardware_feedback.export_failed", &message);
            Err(message)
        }
    }
}

#[tauri::command]
fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = validate_diagnostics_directory(&path)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    validate_external_url(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn append_app_log(input: AppLogInput) {
    let level = input.level.as_deref().unwrap_or("info");
    write_app_log(level, &input.event, input.message.as_deref().unwrap_or(""));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            setup_app_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_saved_config,
            save_config,
            clear_saved_config,
            verify_upload_config,
            collect_device_snapshot,
            get_cached_device_snapshot,
            submit_device_data,
            export_hardware_feedback,
            generate_diagnostics_package,
            open_path,
            open_url,
            append_app_log
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Npcink Device Agent");
}

fn setup_app_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let file_menu = SubmenuBuilder::new(app, "文件").close_window().build()?;
    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "查看").fullscreen().build()?;
    let window_menu = SubmenuBuilder::new(app, "窗口")
        .minimize()
        .close_window()
        .build()?;

    #[cfg(target_os = "macos")]
    let help_menu = SubmenuBuilder::new(app, "帮助")
        .text(MENU_OPEN_PROJECT, "项目主页")
        .build()?;

    #[cfg(not(target_os = "macos"))]
    let help_menu = SubmenuBuilder::new(app, "帮助")
        .text(MENU_CHECK_UPDATE, "检查更新...")
        .separator()
        .about_with_text(format!("关于 {APP_NAME}"), Some(about_metadata()))
        .separator()
        .text(MENU_OPEN_PROJECT, "项目主页")
        .build()?;

    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, APP_NAME)
        .about_with_text(format!("关于 {APP_NAME}"), Some(about_metadata()))
        .separator()
        .text(MENU_CHECK_UPDATE, "检查更新...")
        .separator()
        .text(MENU_OPEN_PROJECT, "项目主页")
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    #[cfg(target_os = "macos")]
    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;

    #[cfg(not(target_os = "macos"))]
    let menu = MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
        .build()?;

    app.set_menu(menu)?;
    app.on_menu_event(|app_handle, event| match event.id().0.as_str() {
        MENU_CHECK_UPDATE => {
            if let Err(error) = app_handle.emit(MENU_CHECK_UPDATE_EVENT, ()) {
                eprintln!("failed to emit update check event: {error}");
            }
        }
        MENU_OPEN_PROJECT => {
            if let Err(error) = app_handle.opener().open_url(PROJECT_URL, None::<&str>) {
                eprintln!("failed to open project url: {error}");
            }
        }
        _ => {}
    });
    Ok(())
}

fn about_metadata() -> AboutMetadata<'static> {
    AboutMetadata {
        name: Some(APP_NAME.to_string()),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        short_version: None,
        authors: Some(vec!["Npcink".to_string()]),
        comments: Some("Device collection and upload tool".to_string()),
        copyright: None,
        license: None,
        website: Some(PROJECT_URL.to_string()),
        website_label: Some("GitHub".to_string()),
        credits: None,
        icon: None,
    }
}

fn validate_external_url(input: &str) -> Result<(), String> {
    let url = url::Url::parse(input.trim()).map_err(|_| "更新地址格式无效".to_string())?;
    let project_path = "/npcink/npcink-device-inventory";
    let allowed = url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && (url.path() == project_path || url.path().starts_with(&format!("{project_path}/")))
        && url.username().is_empty()
        && url.password().is_none();
    if !allowed {
        return Err("只允许打开本项目的 GitHub HTTPS 地址".to_string());
    }
    Ok(())
}

fn validate_diagnostics_directory(input: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(input);
    let name = candidate
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if !name.starts_with("NpcinkDiagnostics-") || !candidate.is_dir() {
        return Err("只允许打开本应用生成的排障目录".to_string());
    }
    let candidate = candidate
        .canonicalize()
        .map_err(|_| "排障目录不存在".to_string())?;
    let base = diagnostics_base_dir()
        .and_then(|path| {
            path.canonicalize()
                .context("failed to resolve diagnostics base dir")
        })
        .map_err(|error| error.to_string())?;
    if candidate.parent() != Some(base.as_path()) {
        return Err("排障目录不在允许的位置".to_string());
    }
    Ok(candidate)
}

fn app_data_dir() -> Result<PathBuf> {
    let base = dirs::data_local_dir()
        .or_else(dirs::config_dir)
        .or_else(dirs::home_dir)
        .context("failed to resolve app data dir")?;
    Ok(base.join(APP_DIR_NAME))
}

fn app_log_path() -> Result<PathBuf> {
    Ok(app_data_dir()?.join(APP_LOG_FILE))
}

fn diagnostics_base_dir() -> Result<PathBuf> {
    dirs::desktop_dir()
        .or_else(dirs::document_dir)
        .or_else(dirs::home_dir)
        .context("failed to resolve diagnostics output dir")
}

fn create_hardware_feedback_export() -> Result<HardwareFeedbackExport> {
    let data = collector::collect_static_data()?;
    let (kind, identity) = collector::hardware_identity_v2(&data).unwrap_or(("", String::new()));
    let snapshot = DeviceSnapshot {
        data,
        device_identity_type: kind.into(),
        device_identity: identity,
    };
    let now = Local::now();
    let stamp = now.format("%Y%m%d-%H%M%S-%3f").to_string();
    write_hardware_feedback_export(
        &diagnostics_base_dir()?,
        &snapshot,
        &now.to_rfc3339(),
        &stamp,
    )
}

fn write_hardware_feedback_export(
    base_dir: &Path,
    snapshot: &DeviceSnapshot,
    exported_at: &str,
    stamp: &str,
) -> Result<HardwareFeedbackExport> {
    let directory_path = base_dir.join(format!("NpcinkDiagnostics-{stamp}-Hardware"));
    #[cfg(unix)]
    let directory = {
        let mut directory = fs::DirBuilder::new();
        directory.mode(0o700);
        directory
    };
    #[cfg(not(unix))]
    let directory = fs::DirBuilder::new();
    directory.create(&directory_path).with_context(|| {
        format!(
            "failed to create hardware feedback dir {}",
            directory_path.display()
        )
    })?;

    let file_path = directory_path.join("device-hardware-feedback.json");
    let payload = hardware_feedback_payload(snapshot, exported_at);
    write_private_json(&file_path, &payload)?;

    Ok(HardwareFeedbackExport {
        directory_path: directory_path.to_string_lossy().to_string(),
        file_path: file_path.to_string_lossy().to_string(),
    })
}

fn hardware_feedback_payload(snapshot: &DeviceSnapshot, exported_at: &str) -> Value {
    json!({
        "schema": "npcink-device-hardware-feedback-v1",
        "exported_at": exported_at,
        "agent": {
            "name": APP_NAME,
            "version": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
            "architecture": std::env::consts::ARCH,
        },
        "device_identity": {
            "type": snapshot.device_identity_type,
            "value": snapshot.device_identity,
        },
        "hardware": snapshot.data,
        "privacy": {
            "contains_upload_configuration": false,
            "contains_upload_token": false,
            "contains_device_identifiers": true,
            "notice": "文件包含主机名、硬件序列号、UUID、IP 和 MAC 等设备标识，仅保存在本机；发送前请确认接收方。",
        },
    })
}

fn create_diagnostics_package(app: tauri::AppHandle) -> Result<DiagnosticsPackage> {
    let mut progress = DiagnosticsProgressEmitter::new(app, 5);
    progress.step("准备上传排障包", "创建本地排障目录");
    let stamp = Local::now().format("%Y%m%d-%H%M%S-%3f").to_string();
    let directory_path = diagnostics_base_dir()?.join(format!("NpcinkDiagnostics-{stamp}"));
    let mut directory = fs::DirBuilder::new();
    #[cfg(unix)]
    directory.mode(0o700);
    directory
        .create(&directory_path)
        .context("failed to create diagnostics directory")?;
    progress.step("采集硬件信息", "读取硬件事实、身份检查和采集状态");
    let data = collector::collect_static_data()
        .unwrap_or_else(|error| json!({"error": error.to_string()}));
    progress.step("保存采集结果", "写入脱敏硬件、身份检查和配置摘要");
    write_support_snapshots(&directory_path, data)?;
    write_config_snapshot(&directory_path)?;
    progress.step("收集客户端日志", "保存本地应用日志尾部");
    write_app_log_snapshot(&directory_path)?;
    write_text(
        &directory_path.join("README.txt"),
        "Npcink Device Agent 上传排障包\n包含脱敏硬件、身份检查、采集状态、配置摘要和客户端日志。\n仅保存在本机；发送前请检查内容。完整身份核对请另行导出硬件信息。\n",
    )?;
    let mut files = package_file_list(&directory_path)?;
    files.push("diagnostics-summary.json".into());
    write_json(
        &directory_path.join("diagnostics-summary.json"),
        &json!({
            "schema": "npcink-agent-support-v1",
            "version": env!("CARGO_PKG_VERSION"),
            "generated_at": Local::now().to_rfc3339(),
            "platform": std::env::consts::OS,
            "package_files": files,
        }),
    )?;
    progress.step("压缩上传排障包", "生成可发送的 zip 文件");
    let zip_path = directory_path.with_extension("zip");
    zip_directory(&directory_path, &zip_path)?;
    Ok(DiagnosticsPackage {
        directory_path: directory_path.to_string_lossy().to_string(),
        zip_path: zip_path.to_string_lossy().to_string(),
    })
}

fn write_support_snapshots(out: &Path, data: Value) -> Result<()> {
    // Identity diagnostics were calculated before identifiers are redacted.
    let data = redact_sensitive_json(data);
    write_json(
        &out.join("identity-check.json"),
        &data
            .get("identityDiagnostics")
            .cloned()
            .unwrap_or(json!({"decision": "unavailable"})),
    )?;
    write_json(
        &out.join("hardware-probes.json"),
        &data
            .get("hardwareProbeAttempts")
            .cloned()
            .unwrap_or(json!([])),
    )?;
    write_json(&out.join("device-static-data.json"), &data)
}

impl DiagnosticsProgressEmitter {
    fn new(app: tauri::AppHandle, total: usize) -> Self {
        Self {
            app,
            current: 0,
            total,
        }
    }

    fn step(&mut self, stage: &str, detail: &str) {
        self.current = (self.current + 1).min(self.total);
        let _ = self.app.emit(
            DIAGNOSTICS_PROGRESS_EVENT,
            DiagnosticsProgress {
                current: self.current,
                total: self.total,
                stage: stage.to_string(),
                detail: detail.to_string(),
            },
        );
    }
}

fn write_config_snapshot(out: &Path) -> Result<()> {
    let config = read_config().unwrap_or_default();
    write_json(
        &out.join("agent-config-redacted.json"),
        &json!({
            "site": redact_url_for_log(&config.site),
            "name": config.name,
            "preset_label": config.preset_label,
            "token": if config.token.is_empty() { "missing" } else { "redacted" },
        }),
    )
}

fn write_app_log_snapshot(out: &Path) -> Result<()> {
    let content = match app_log_path() {
        Ok(path) if path.exists() => read_tail_text(&path, DIAGNOSTICS_LOG_TAIL_BYTES)
            .unwrap_or_else(|error| format!("failed to read app log: {error}\n")),
        Ok(path) => format!("app log not found: {}\n", path.display()),
        Err(error) => format!("app log path unavailable: {error}\n"),
    };
    write_text(&out.join(APP_LOG_FILE), &redact_diagnostics_text(&content))
}

fn write_text(path: &Path, content: &str) -> Result<()> {
    fs::write(path, content).with_context(|| format!("failed to write {}", path.display()))
}

fn write_json(path: &Path, value: &Value) -> Result<()> {
    let raw = serde_json::to_string_pretty(value).context("failed to encode json")?;
    write_text(path, &raw)
}

fn write_private_json(path: &Path, value: &Value) -> Result<()> {
    let raw = serde_json::to_string_pretty(value).context("failed to encode json")?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .with_context(|| format!("failed to create {}", path.display()))?;
    file.write_all(raw.as_bytes())
        .with_context(|| format!("failed to write {}", path.display()))
}

fn write_app_log(level: &str, event: &str, message: &str) {
    let path = match app_log_path() {
        Ok(path) => path,
        Err(_) => return,
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    rotate_app_log_if_needed(&path);

    let level = match level {
        "debug" | "info" | "warn" | "error" => level,
        _ => "info",
    };
    let line = json!({
        "timestamp": Local::now().to_rfc3339(),
        "level": level,
        "event": sanitize_log_field(event),
        "message": sanitize_log_message(message),
    });
    let Ok(raw) = serde_json::to_string(&line) else {
        return;
    };
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{raw}");
    }
}

fn rotate_app_log_if_needed(path: &Path) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.len() <= APP_LOG_MAX_BYTES {
        return;
    }
    let rotated = path.with_extension("log.1");
    let _ = fs::rename(path, rotated);
}

fn read_tail_text(path: &Path, max_bytes: u64) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))?;
    let mut content = String::new();
    file.read_to_string(&mut content)?;
    if start > 0 {
        if let Some((_, rest)) = content.split_once('\n') {
            return Ok(rest.to_string());
        }
    }
    Ok(content)
}

fn sanitize_log_field(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        .take(80)
        .collect::<String>()
}

fn sanitize_log_message(message: &str) -> String {
    let normalized = redact_token_like(&redact_home_path(message))
        .replace(['\r', '\n', '\t'], " ")
        .trim()
        .to_string();
    normalized.chars().take(1200).collect()
}

fn redact_token_like(text: &str) -> String {
    let mut output = String::new();
    let mut index = 0;

    while index < text.len() {
        if text[index..].starts_with("mda_") {
            let mut end = index;
            for (offset, ch) in text[index..].char_indices() {
                if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-') {
                    end = index + offset + ch.len_utf8();
                } else {
                    break;
                }
            }
            output.push_str("[upload-token-redacted]");
            index = end;
            continue;
        }

        let ch = text[index..].chars().next().unwrap();
        output.push(ch);
        index += ch.len_utf8();
    }

    output
}

fn empty_label(value: &str) -> String {
    if value.trim().is_empty() {
        "none".to_string()
    } else {
        value.trim().to_string()
    }
}

fn redact_url_for_log(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return "missing".to_string();
    }
    trimmed
        .split_once('?')
        .map(|(base, _)| format!("{base}?[redacted]"))
        .unwrap_or_else(|| trimmed.to_string())
}

fn package_file_list(out: &Path) -> Result<Vec<String>> {
    let mut files = Vec::new();
    collect_package_files(out, out, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_package_files(base: &Path, current: &Path, files: &mut Vec<String>) -> Result<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_package_files(base, &path, files)?;
        } else {
            files.push(
                path.strip_prefix(base)?
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    Ok(())
}

fn redact_sensitive_json(mut value: Value) -> Value {
    redact_sensitive_json_in_place(&mut value, None);
    value
}

fn redact_sensitive_json_in_place(value: &mut Value, current_key: Option<&str>) {
    if current_key.is_some_and(is_sensitive_json_key) {
        *value = Value::String("[redacted]".to_string());
        return;
    }

    match value {
        Value::Object(map) => {
            for (key, child) in map {
                redact_sensitive_json_in_place(child, Some(key));
            }
        }
        Value::Array(items) => {
            for item in items {
                redact_sensitive_json_in_place(item, None);
            }
        }
        Value::String(text) => {
            *text = redact_home_path(text);
        }
        _ => {}
    }
}

fn is_sensitive_json_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect::<String>();

    matches!(
        normalized.as_str(),
        "serial"
            | "serialnumber"
            | "serialnum"
            | "uuid"
            | "platformuuid"
            | "hardwareuuid"
            | "provisioningudid"
            | "udid"
            | "mac"
            | "macs"
            | "macaddress"
            | "hostname"
            | "fqdn"
            | "computername"
            | "username"
            | "user"
            | "token"
            | "secret"
            | "password"
    )
}

fn redact_diagnostics_text(content: &str) -> String {
    content
        .lines()
        .map(redact_diagnostics_line)
        .collect::<Vec<_>>()
        .join("\n")
}

fn redact_diagnostics_line(line: &str) -> String {
    let line = redact_home_path(line);
    let line = redact_windows_machine_tokens(&line);
    let line = redact_mac_addresses(&line);
    let lower = line.to_lowercase();
    if lower.contains("com.apple.os.update-") {
        if let Some((label, _)) = line.split_once(':') {
            return format!("{label}: [redacted]");
        }
    }
    let sensitive_labels = [
        "serial number",
        "hardware uuid",
        "provisioning udid",
        "user name",
        "computer name",
        "mac address",
        "hardware address",
        "host name",
        "hostname",
        "machine name",
        "machinename",
        "owner",
        "volume uuid",
        "disk / partition uuid",
        "apfs snapshot uuid",
        "snapshot uuid",
        "apfs volume group",
        "apfs snapshot name",
    ];

    if sensitive_labels.iter().any(|label| lower.contains(label)) {
        if let Some((label, _)) = line.split_once(':') {
            return format!("{label}: [redacted]");
        }
    }

    line
}

fn redact_mac_addresses(line: &str) -> String {
    let chars = line.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(line.len());
    let mut index = 0;
    while index < chars.len() {
        if looks_like_mac_at(&chars, index) {
            output.push_str("[mac-redacted]");
            index += 17;
        } else {
            output.push(chars[index]);
            index += 1;
        }
    }
    output
}

fn looks_like_mac_at(chars: &[char], index: usize) -> bool {
    if index + 17 > chars.len() {
        return false;
    }
    let separator = chars[index + 2];
    if separator != ':' && separator != '-' {
        return false;
    }
    for pair in 0..6 {
        let start = index + pair * 3;
        if !chars[start].is_ascii_hexdigit() || !chars[start + 1].is_ascii_hexdigit() {
            return false;
        }
        if pair < 5 && chars[start + 2] != separator {
            return false;
        }
    }
    let before_is_hex = index
        .checked_sub(1)
        .and_then(|previous| chars.get(previous))
        .is_some_and(|ch| ch.is_ascii_hexdigit());
    let after_is_hex = chars
        .get(index + 17)
        .is_some_and(|ch| ch.is_ascii_hexdigit());
    !before_is_hex && !after_is_hex
}

fn redact_windows_machine_tokens(line: &str) -> String {
    let mut output = String::with_capacity(line.len());
    let mut token = String::new();

    for ch in line.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' {
            token.push(ch);
            continue;
        }
        push_redacted_windows_token(&mut output, &token);
        token.clear();
        output.push(ch);
    }
    push_redacted_windows_token(&mut output, &token);
    output
}

fn push_redacted_windows_token(output: &mut String, token: &str) {
    let upper = token.to_ascii_uppercase();
    if upper.starts_with("DESKTOP-") || upper.starts_with("WIN-") {
        output.push_str("[windows-host-redacted]");
    } else {
        output.push_str(token);
    }
}

fn redact_home_path(text: &str) -> String {
    if let Some(home_dir) = dirs::home_dir() {
        let home = home_dir.to_string_lossy();
        if !home.is_empty() {
            return text.replace(home.as_ref(), "~");
        }
    }
    text.to_string()
}

fn zip_directory(source_dir: &Path, zip_path: &Path) -> Result<()> {
    let file = fs::File::create(zip_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut buffer = Vec::new();
    add_dir_to_zip(source_dir, source_dir, &mut zip, options, &mut buffer)?;
    zip.finish()?;
    Ok(())
}

fn add_dir_to_zip(
    base_dir: &Path,
    current_dir: &Path,
    zip: &mut zip::ZipWriter<fs::File>,
    options: SimpleFileOptions,
    buffer: &mut Vec<u8>,
) -> Result<()> {
    for entry in fs::read_dir(current_dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = path
            .strip_prefix(base_dir)?
            .to_string_lossy()
            .replace('\\', "/");
        if path.is_dir() {
            if !name.is_empty() {
                zip.add_directory(format!("{name}/"), options)?;
            }
            add_dir_to_zip(base_dir, &path, zip, options, buffer)?;
        } else {
            zip.start_file(name, options)?;
            let mut file = fs::File::open(&path)?;
            buffer.clear();
            file.read_to_end(buffer)?;
            zip.write_all(buffer)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn snapshot_cache_requires_new_identity_collection_and_current_version() {
        let mut snapshot = DeviceSnapshot {
            data: json!({"collector": {"schema": "npcink-hardware-inventory-v3", "version": env!("CARGO_PKG_VERSION"), "observation_id": "cdb0d10b-858d-49aa-a8d4-bcb29f0cdd0e"}, "uuid": {"hardware": "valid-test-hardware"}}),
            device_identity_type: "system_uuid_v2".into(),
            device_identity: "unused".into(),
        };
        assert!(snapshot_cache_is_current(&snapshot));
        snapshot.data["os"] = json!({"platform": "windows"});
        assert!(!snapshot_cache_is_current(&snapshot));
        snapshot.data["hardwareProbeAttempts"] =
            json!([{"source": "graphics_memory", "status": "failed"}]);
        assert!(snapshot_cache_is_current(&snapshot));
        assert_eq!(snapshot_cache_ttl(&snapshot), Duration::from_secs(60));
        snapshot.data["hardwareProbeAttempts"][0]["status"] = json!("partial");
        assert_eq!(snapshot_cache_ttl(&snapshot), Duration::from_secs(60));
        snapshot.data["hardwareProbeAttempts"][0]["status"] = json!("ok");
        assert_eq!(snapshot_cache_ttl(&snapshot), SNAPSHOT_CACHE_TTL);
        snapshot.data["collector"]["schema"] = json!("npcink-upload-light-v4");
        assert!(!snapshot_cache_is_current(&snapshot));
        snapshot.data["collector"]["schema"] = json!("npcink-hardware-inventory-v3");
        snapshot.data["collector"]["version"] = json!("older-build");
        assert!(!snapshot_cache_is_current(&snapshot));
        snapshot.data["collector"]["version"] = json!(env!("CARGO_PKG_VERSION"));
        snapshot.data["uuid"]["hardware"] = json!("03000200-0400-0500-0006-000700080009");
        assert!(!snapshot_cache_is_current(&snapshot));
    }

    #[test]
    fn external_url_is_limited_to_project_github_pages() {
        assert!(validate_external_url(PROJECT_URL).is_ok());
        assert!(validate_external_url(
            "https://github.com/npcink/npcink-device-inventory/releases/download/v1/app.zip"
        )
        .is_ok());
        assert!(validate_external_url("http://github.com/npcink/npcink-device-inventory").is_err());
        assert!(validate_external_url("https://example.com/update.exe").is_err());
        assert!(validate_external_url("file:///tmp/update.exe").is_err());
    }

    #[test]
    fn diagnostics_text_redacts_sensitive_lines() {
        let text = "Serial Number (system): ABC123\nHardware UUID: 0000-1111\nModel Name: MacBook Air\nName: com.apple.os.update-E665088689556947ADF621B0053B4CA1662AEB6729590B5A5D43C3166FC1CE8F";
        let redacted = redact_diagnostics_text(text);

        assert!(redacted.contains("Serial Number (system): [redacted]"));
        assert!(redacted.contains("Hardware UUID: [redacted]"));
        assert!(redacted.contains("Model Name: MacBook Air"));
        assert!(redacted.contains("Name: [redacted]"));
        assert!(!redacted.contains("ABC123"));
        assert!(!redacted.contains("com.apple.os.update-"));
    }

    #[test]
    fn diagnostics_text_redacts_inline_mac_addresses() {
        let text = "MacAddress Status\nB0-7B-25-2D-75-AD Up\nremote aa:bb:cc:dd:ee:ff connected";
        let redacted = redact_diagnostics_text(text);

        assert!(redacted.contains("[mac-redacted] Up"));
        assert!(redacted.contains("remote [mac-redacted] connected"));
        assert!(!redacted.contains("B0-7B-25-2D-75-AD"));
        assert!(!redacted.contains("aa:bb:cc:dd:ee:ff"));
    }

    #[test]
    fn diagnostics_json_redacts_sensitive_values() {
        let redacted = redact_sensitive_json(json!({
            "system": {
                "serial": "ABC123",
                "uuid": {
                    "hardware": "0000-1111"
                },
                "model": "MacBook Air"
            },
            "net": [
                {
                    "ifaceName": "en0",
                    "mac": "aa:bb:cc:dd:ee:ff"
                }
            ]
        }));

        assert_eq!(redacted["system"]["serial"], "[redacted]");
        assert_eq!(redacted["system"]["uuid"], "[redacted]");
        assert_eq!(redacted["system"]["model"], "MacBook Air");
        assert_eq!(redacted["net"][0]["mac"], "[redacted]");
    }

    #[test]
    fn diagnostics_json_redacts_network_identity() {
        let redacted = redact_sensitive_json(json!({
            "network": {
                "iface": "以太网",
                "ip4": "192.168.10.221",
                "mac": "b0:7b:25:2d:75:ad"
            }
        }));

        assert_eq!(redacted["network"]["mac"], "[redacted]");
        assert_eq!(redacted["network"]["iface"], "以太网");
    }

    #[test]
    fn hardware_feedback_export_writes_private_parseable_json_without_upload_credentials() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "npcink-hardware-feedback-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&base).unwrap();
        let snapshot = DeviceSnapshot {
            data: json!({
                "baseboard": {
                    "manufacturer": "Example",
                    "product": "Board-1",
                    "serial": "BOARD-SERIAL-1"
                },
                "uuid": {
                    "hardware": "HARDWARE-UUID-1",
                    "macs": ["aa:bb:cc:dd:ee:ff"]
                }
            }),
            device_identity_type: "system_uuid_v2".to_string(),
            device_identity: "system-v2-example".to_string(),
        };

        let export = write_hardware_feedback_export(
            &base,
            &snapshot,
            "2026-07-15T12:00:00+08:00",
            "20260715-120000-000",
        )
        .unwrap();
        let directory_path = PathBuf::from(export.directory_path);
        let file_path = PathBuf::from(export.file_path);
        let payload: Value =
            serde_json::from_str(&fs::read_to_string(&file_path).unwrap()).unwrap();

        assert_eq!(directory_path.parent(), Some(base.as_path()));
        assert_eq!(file_path.parent(), Some(directory_path.as_path()));
        assert_eq!(
            file_path.file_name().unwrap(),
            "device-hardware-feedback.json"
        );
        assert_eq!(payload["schema"], "npcink-device-hardware-feedback-v1");
        assert_eq!(payload["device_identity"]["type"], "system_uuid_v2");
        assert_eq!(payload["hardware"]["baseboard"]["serial"], "BOARD-SERIAL-1");
        assert_eq!(payload["hardware"]["uuid"]["hardware"], "HARDWARE-UUID-1");
        assert_eq!(payload["privacy"]["contains_upload_configuration"], false);
        assert_eq!(payload["privacy"]["contains_upload_token"], false);
        assert!(payload.get("upload_configuration").is_none());
        assert!(payload.get("upload_token").is_none());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(
                fs::metadata(&directory_path).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&file_path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn upload_support_snapshots_preserve_identity_status_and_redact_identifiers() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let out =
            std::env::temp_dir().join(format!("npcink-support-{}-{unique}", std::process::id()));
        fs::create_dir_all(&out).unwrap();
        let identity =
            json!({"decision": "ready", "systemUuid": "valid", "permanentPciMacCount": 0});
        let probes = json!([{"source": "graphics_memory", "status": "partial"}]);
        write_support_snapshots(
            &out,
            json!({
                "uuid": {"hardware": "private-uuid"}, "baseboard": {"serial": "private-serial"},
                "identityDiagnostics": identity, "hardwareProbeAttempts": probes,
            }),
        )
        .unwrap();
        let hardware = fs::read_to_string(out.join("device-static-data.json")).unwrap();
        assert!(!hardware.contains("private-uuid"));
        assert!(!hardware.contains("private-serial"));
        let saved_identity: Value =
            serde_json::from_str(&fs::read_to_string(out.join("identity-check.json")).unwrap())
                .unwrap();
        assert_eq!(saved_identity, identity);
        let saved_probes: Value =
            serde_json::from_str(&fs::read_to_string(out.join("hardware-probes.json")).unwrap())
                .unwrap();
        assert_eq!(saved_probes, probes);
        assert_eq!(
            package_file_list(&out).unwrap(),
            vec![
                "device-static-data.json",
                "hardware-probes.json",
                "identity-check.json"
            ]
        );
        fs::remove_dir_all(out).unwrap();
    }

    #[test]
    fn zip_directory_creates_archive() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "npcink-diagnostics-zip-test-{}-{unique}",
            std::process::id()
        ));
        let source = base.join("source");
        let nested = source.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(source.join("README.txt"), "hello").unwrap();
        fs::write(nested.join("detail.txt"), "world").unwrap();

        let zip_path = base.join("package.zip");
        zip_directory(&source, &zip_path).unwrap();

        assert!(zip_path.exists());
        assert!(fs::metadata(&zip_path).unwrap().len() > 0);

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn log_message_redacts_upload_token() {
        let message =
            sanitize_log_message("upload failed token=mda_abc123_secret\npath=/tmp/example");

        assert!(message.contains("[upload-token-redacted]"));
        assert!(!message.contains("mda_abc123_secret"));
        assert!(!message.contains('\n'));
    }
}
