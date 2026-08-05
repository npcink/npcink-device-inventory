mod config;

use anyhow::{Context, Result};
use chrono::{DateTime, Local, Utc};
use npcink_device_agent::{collector, upload};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;
use zip::write::SimpleFileOptions;

use config::{read_config, validate_config, write_config, AgentConfig, APP_DIR_NAME};

const APP_NAME: &str = "Npcink Device Agent";
const APP_LOG_FILE: &str = "app.log";
const APP_LOG_MAX_BYTES: u64 = 1024 * 1024;
const DIAGNOSTICS_LOG_TAIL_BYTES: u64 = 256 * 1024;
const DIAGNOSTICS_COMMAND_TIMEOUT: Duration = Duration::from_secs(12);
const DIAGNOSTICS_PROGRESS_EVENT: &str = "diagnostics-progress";
const PROJECT_URL: &str = "https://github.com/muze-page/npcink-device-inventory";
const MENU_CHECK_UPDATE: &str = "check_for_updates";
const MENU_CHECK_UPDATE_EVENT: &str = "desktop-check-update";
const MENU_OPEN_PROJECT: &str = "open_project_url";

#[derive(Debug, Serialize)]
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

fn collect_device_snapshot_inner() -> Result<DeviceSnapshot, String> {
    match collector::collect_static_data() {
        Ok(data) => {
            let (device_identity_type, device_identity) =
                collector::hardware_identity_v2(&data).unwrap_or(("", String::new()));
            write_app_log("info", "device.collect_static_succeeded", "");
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

#[tauri::command]
async fn collect_runtime_status() -> Result<Value, String> {
    let result = tauri::async_runtime::spawn_blocking(collect_runtime_status_inner).await;
    match result {
        Ok(status) => status,
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "runtime.collect_task_failed", &message);
            Err(message)
        }
    }
}

fn collect_runtime_status_inner() -> Result<Value, String> {
    match collector::collect_runtime_status() {
        Ok(status) => Ok(status),
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "runtime.collect_failed", &message);
            Err(message)
        }
    }
}

#[tauri::command]
fn get_runtime_history(range_minutes: Option<u64>) -> Value {
    json!({
        "summary": collector::runtime_history_summary(range_minutes),
        "chart": collector::runtime_chart(range_minutes, 60),
    })
}

#[tauri::command]
async fn submit_device_data(config: AgentConfig) -> Result<Value, String> {
    let result =
        tauri::async_runtime::spawn_blocking(move || submit_device_data_inner(config)).await;
    match result {
        Ok(response) => response,
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "upload.task_failed", &message);
            Err(message)
        }
    }
}

fn submit_device_data_inner(config: AgentConfig) -> Result<Value, String> {
    if let Err(error) = validate_config(&config) {
        write_app_log("warn", "upload.validation_failed", &error);
        return Err(error);
    }
    let data = match collector::collect_static_data() {
        Ok(data) => data,
        Err(error) => {
            let message = error.to_string();
            write_app_log("error", "upload.collect_failed", &message);
            return Err(message);
        }
    };

    match upload::submit_v3(&config.site, &config.name, &config.token, &data) {
        Ok(response) => {
            write_app_log(
                "info",
                "upload.succeeded",
                &format!(
                    "name_present={} site={}",
                    !config.name.trim().is_empty(),
                    redact_url_for_log(&config.site),
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
            collect_device_snapshot,
            collect_runtime_status,
            get_runtime_history,
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
    let project_path = "/muze-page/npcink-device-inventory";
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
    let snapshot = collect_device_snapshot_inner().map_err(anyhow::Error::msg)?;
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
    let mut directory = fs::DirBuilder::new();
    #[cfg(unix)]
    directory.mode(0o700);
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
    let mut progress = DiagnosticsProgressEmitter::new(app, diagnostics_progress_total());
    progress.step("准备排障包", "创建本地排障目录");
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let directory_path = diagnostics_base_dir()?.join(format!("NpcinkDiagnostics-{stamp}"));
    fs::create_dir_all(&directory_path).with_context(|| {
        format!(
            "failed to create diagnostics dir {}",
            directory_path.display()
        )
    })?;

    let privilege_info = diagnostics_privilege_info();
    write_text(
        &directory_path.join("README.txt"),
        &format!(
            "Npcink Device Agent diagnostics package\n生成时间: {}\n平台: {}\n运行身份: {}\n\n此排障包由本机生成，用于管理员排查问题。分享前请先确认文件内容。\n",
            Local::now().to_rfc3339(),
            std::env::consts::OS,
            privilege_label(&privilege_info),
        ),
    )?;
    write_json(&directory_path.join("privilege-info.json"), &privilege_info)?;
    progress.step("采集硬件信息", "读取本机静态硬件、系统和设备标识");
    let static_data =
        redact_sensitive_json(collector::collect_static_data().unwrap_or_else(|error| {
            json!({
                "error": error.to_string(),
            })
        }));
    progress.step("采集运行状态", "记录 CPU、内存、磁盘和本次会话监控");
    let runtime_status =
        redact_sensitive_json(collector::collect_runtime_status().unwrap_or_else(|error| {
            json!({
                "error": error.to_string(),
            })
        }));
    let runtime_history = redact_sensitive_json(collector::runtime_history(None));
    let runtime_history_summary = collector::runtime_history_summary(None);
    let runtime_history_coverage = runtime_history_coverage(&runtime_history_summary);
    progress.step("写入基础快照", "保存配置、硬件、运行状态和监控历史");
    write_json(
        &directory_path.join("device-static-data.json"),
        &static_data,
    )?;
    write_json(&directory_path.join("runtime-status.json"), &runtime_status)?;
    write_json(
        &directory_path.join("runtime-history.json"),
        &runtime_history,
    )?;
    write_json(
        &directory_path.join("runtime-history-summary.json"),
        &runtime_history_summary,
    )?;
    write_json(
        &directory_path.join("runtime-history-coverage.json"),
        &runtime_history_coverage,
    )?;
    write_config_snapshot(&directory_path)?;
    collect_platform_diagnostics(&directory_path, &mut progress)?;
    progress.step("收集应用日志", "保存软件本地日志尾部");
    write_app_log_snapshot(&directory_path)?;
    progress.step("生成摘要", "汇总排障包内容和关键状态");
    write_diagnostics_summary(
        &directory_path,
        &static_data,
        &runtime_status,
        &runtime_history_summary,
        &runtime_history_coverage,
        &privilege_info,
    )?;

    progress.step("压缩排障包", "生成可发送的 zip 文件");
    let zip_path = directory_path.with_extension("zip");
    zip_directory(&directory_path, &zip_path)
        .with_context(|| format!("failed to create zip {}", zip_path.display()))?;

    Ok(DiagnosticsPackage {
        directory_path: directory_path.to_string_lossy().to_string(),
        zip_path: zip_path.to_string_lossy().to_string(),
    })
}

fn runtime_history_coverage(runtime_history_summary: &Value) -> Value {
    let sample_count = value_u64(runtime_history_summary, "/sample_count").unwrap_or(0);
    let started_at = value_text(runtime_history_summary, "/started_at");
    let ended_at = value_text(runtime_history_summary, "/ended_at");
    let duration_seconds = match (
        DateTime::parse_from_rfc3339(&started_at),
        DateTime::parse_from_rfc3339(&ended_at),
    ) {
        (Ok(start), Ok(end)) => Some(
            end.with_timezone(&Utc)
                .signed_duration_since(start.with_timezone(&Utc))
                .num_seconds()
                .max(0),
        ),
        _ => None,
    };
    let recommended_seconds = 300;
    let quality = if sample_count == 0 {
        "missing"
    } else if duration_seconds.unwrap_or(0) < recommended_seconds {
        "short"
    } else {
        "usable"
    };

    json!({
        "quality": quality,
        "sample_count": sample_count,
        "started_at": empty_label(&started_at),
        "ended_at": empty_label(&ended_at),
        "duration_seconds": duration_seconds,
        "recommended_minimum_seconds": recommended_seconds,
        "note": match quality {
            "missing" => "未记录到运行历史；只能分析生成排障包时的单次快照。",
            "short" => "运行历史覆盖时间偏短，适合初筛当前负载；偶发卡顿建议让软件运行 5-15 分钟后重新生成排障包。",
            _ => "运行历史覆盖时间可用于初步分析性能波动。",
        },
    })
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

fn diagnostics_progress_total() -> usize {
    7 + platform_diagnostics_step_count()
}

fn privilege_label(info: &Value) -> &'static str {
    match info.get("is_admin").and_then(Value::as_bool) {
        Some(true) => "管理员权限",
        Some(false) => "普通权限",
        None => "未知",
    }
}

#[cfg(target_os = "windows")]
fn diagnostics_privilege_info() -> Value {
    let command = "$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'true' } else { 'false' }";
    let output = powershell_stdout(command, Duration::from_secs(5));
    let is_admin = output
        .as_deref()
        .map(str::trim)
        .map(|text| text.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    json!({
        "is_admin": is_admin,
        "label": if is_admin { "管理员权限" } else { "普通权限" },
        "source": "windows-principal",
        "note": if is_admin {
            "已使用管理员权限运行，磁盘可靠性、电源唤醒和 dump 相关信息更完整。"
        } else {
            "当前为普通权限运行，部分磁盘可靠性、电源唤醒和 dump 相关信息可能不完整。"
        },
        "detection_error": output.is_none(),
    })
}

#[cfg(not(target_os = "windows"))]
fn diagnostics_privilege_info() -> Value {
    let is_admin = command_stdout("id", &["-u"], Duration::from_secs(5))
        .as_deref()
        .map(str::trim)
        .map(|text| text == "0")
        .unwrap_or(false);
    json!({
        "is_admin": is_admin,
        "label": if is_admin { "管理员权限" } else { "普通权限" },
        "source": "posix-euid",
        "note": if is_admin {
            "已使用管理员权限运行。"
        } else {
            "当前为普通权限运行。"
        },
    })
}

#[cfg(target_os = "windows")]
fn powershell_stdout(command: &str, timeout: Duration) -> Option<String> {
    let args = powershell_utf8_args(command);
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    command_stdout("powershell", &arg_refs, timeout)
}

fn command_stdout(program: &str, args: &[&str], timeout: Duration) -> Option<String> {
    let output = command_output_with_timeout(program, args, timeout).ok()?;
    if !output.status.success() || output.timed_out {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "windows")]
fn platform_diagnostics_step_count() -> usize {
    9
}

#[cfg(target_os = "macos")]
fn platform_diagnostics_step_count() -> usize {
    3
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn platform_diagnostics_step_count() -> usize {
    3
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

fn write_diagnostics_summary(
    out: &Path,
    static_data: &Value,
    runtime_status: &Value,
    runtime_history_summary: &Value,
    runtime_history_coverage: &Value,
    privilege_info: &Value,
) -> Result<()> {
    let config = read_config().unwrap_or_default();
    let recent_error_lines = count_log_payload_lines(&out.join("recent-errors.log"));
    let diagnostic_report_count = count_matching_lines(
        &out.join("recent-diagnostic-reports.txt"),
        &[".crash", ".panic", ".ips"],
    );
    let cbs_repair_line_count = count_log_payload_lines(&out.join("cbs-recent-errors.txt"));
    let minidump_count = count_payload_matching_lines(&out.join("minidump-copy.txt"), &[".dmp"]);
    let wer_report_count =
        count_payload_matching_lines(&out.join("wer-report-summary.txt"), &["name "]);
    let app_log_included = out.join(APP_LOG_FILE).exists();
    let mut package_files = package_file_list(out)?;
    package_files.push("diagnostics-summary.json".to_string());
    package_files.sort();

    write_json(
        &out.join("diagnostics-summary.json"),
        &json!({
            "schema": "npcink-diagnostics-summary-v1",
            "generated_at": Local::now().to_rfc3339(),
            "app": {
                "name": APP_NAME,
                "version": env!("CARGO_PKG_VERSION"),
                "project_url": PROJECT_URL,
            },
            "platform": std::env::consts::OS,
            "privilege": privilege_info,
            "config": {
                "configured": !config.site.trim().is_empty() && !config.token.trim().is_empty(),
                "preset_label": empty_label(&config.preset_label),
                "site": redact_url_for_log(&config.site),
                "token": if config.token.trim().is_empty() { "missing" } else { "redacted" },
            },
            "device": {
                "computer_name": value_text(static_data, "/os/hostname"),
                "system": join_non_empty(&[
                    value_text(static_data, "/os/distro"),
                    value_text(static_data, "/os/release"),
                ]),
                "model": join_non_empty(&[
                    value_text(static_data, "/system/manufacturer"),
                    value_text(static_data, "/system/model"),
                ]),
                "cpu": join_non_empty(&[
                    value_text(static_data, "/cpu/manufacturer"),
                    value_text(static_data, "/cpu/brand"),
                ]),
                "memory_total_bytes": value_u64(static_data, "/mem/total"),
                "disk_total_bytes": value_u64(runtime_status, "/disk/total"),
                "disk_available_bytes": value_u64(runtime_status, "/disk/available"),
                "disk_mount": value_text(runtime_status, "/disk/mount"),
            },
            "runtime": {
                "collected_at": value_text(runtime_status, "/collected_at"),
                "cpu_usage_percent": value_f64(runtime_status, "/cpu/usage_percent"),
                "memory_used_bytes": value_u64(runtime_status, "/memory/used"),
                "memory_total_bytes": value_u64(runtime_status, "/memory/total"),
                "disk_used_bytes": value_u64(runtime_status, "/disk/used"),
                "disk_total_bytes": value_u64(runtime_status, "/disk/total"),
                "primary_temperature": primary_temperature_summary(runtime_status),
                "advanced": runtime_status.get("advanced").cloned().unwrap_or(Value::Null),
                "history_summary": runtime_history_summary,
                "history_coverage": runtime_history_coverage,
            },
            "signals": {
                "recent_error_lines": recent_error_lines,
                "diagnostic_report_count": diagnostic_report_count,
                "cbs_repair_line_count": cbs_repair_line_count,
                "minidump_count": minidump_count,
                "wer_report_count": wer_report_count,
                "app_log_included": app_log_included,
            },
            "package_files": package_files,
            "privacy": {
                "token_redacted": true,
                "identity_fields_redacted": true,
                "home_path_redacted": true,
            },
        }),
    )
}

#[cfg(target_os = "windows")]
fn collect_platform_diagnostics(
    out: &Path,
    progress: &mut DiagnosticsProgressEmitter,
) -> Result<()> {
    progress.step(
        "收集 Windows 事件",
        "读取系统、应用、安装、更新和可靠性记录",
    );
    let event_commands = [
        (
            "system-relevant-events.txt",
            "Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=(Get-Date).AddDays(-14); Id=41,1001,6008,6005,6006,1074,7,11,15,51,55,57,129,153,157,161,17,18,19,219,7000,7001,7009,7011,7022,7023,7024,7031,7034} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,MachineName,Message | Format-List",
        ),
        (
            "system-relevant-events.csv",
            "Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=(Get-Date).AddDays(-14); Id=41,1001,6008,6005,6006,1074,7,11,15,51,55,57,129,153,157,161,17,18,19,46,47,219,7000,7001,7009,7011,7022,7023,7024,7031,7034} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,MachineName,Message | ConvertTo-Csv -NoTypeInformation",
        ),
        (
            "application-crash-events.txt",
            "Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddDays(-14); Id=1000,1001,1002,1005,1026} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,MachineName,Message | Format-List",
        ),
        (
            "application-crash-events.csv",
            "Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddDays(-14); Id=1000,1001,1002,1005,1026} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,MachineName,Message | ConvertTo-Csv -NoTypeInformation",
        ),
        (
            "setup-events.csv",
            "Get-WinEvent -FilterHashtable @{LogName='Setup'; StartTime=(Get-Date).AddDays(-14)} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,Message | ConvertTo-Csv -NoTypeInformation",
        ),
        (
            "windows-update-events.csv",
            "Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-WindowsUpdateClient/Operational'; StartTime=(Get-Date).AddDays(-14)} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,Message | ConvertTo-Csv -NoTypeInformation",
        ),
        (
            "reliability-records.txt",
            "Get-CimInstance -ClassName Win32_ReliabilityRecords -ErrorAction SilentlyContinue | Where-Object { $_.TimeGenerated -ge (Get-Date).AddDays(-14) } | Select-Object TimeGenerated,SourceName,EventIdentifier,ProductName,Message | Format-List",
        ),
        (
            "reliability-records.csv",
            "Get-CimInstance -ClassName Win32_ReliabilityRecords -ErrorAction SilentlyContinue | Where-Object { $_.TimeGenerated -ge (Get-Date).AddDays(-14) } | Select-Object TimeGenerated,SourceName,EventIdentifier,ProductName,Message | ConvertTo-Csv -NoTypeInformation",
        ),
    ];
    run_command_group(out, &event_commands)?;
    diagnostics_group_pause();

    progress.step("收集硬件明细", "读取 BIOS、主板、内存、显卡和整机信息");
    let hardware_commands = [
        ("computer-info.txt", "Get-ComputerInfo | Format-List"),
        (
            "hardware-info.txt",
            "$classes='Win32_BIOS','Win32_BaseBoard','Win32_SystemEnclosure','Win32_Processor','Win32_PhysicalMemory','Win32_VideoController','Win32_DesktopMonitor','Win32_DiskDrive','Win32_Battery'; foreach ($class in $classes) { \"===== $class =====\"; Get-CimInstance -ClassName $class -ErrorAction SilentlyContinue | Format-List * }; \"===== root\\wmi:WmiMonitorID =====\"; Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue | Select-Object InstanceName,Active,ManufacturerName,UserFriendlyName,SerialNumberID,YearOfManufacture,WeekOfManufacture | Format-List *",
        ),
    ];
    run_command_group(out, &hardware_commands)?;
    diagnostics_group_pause();

    progress.step("收集驱动信息", "读取已签名驱动、PnP 驱动和异常设备");
    let driver_commands = [
        (
            "signed-drivers.txt",
            "Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | Select-Object DeviceName,Manufacturer,DriverVersion,DriverDate,InfName,IsSigned | Sort-Object DeviceName | Format-Table -AutoSize",
        ),
        (
            "signed-drivers.csv",
            "Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | Select-Object DeviceName,Manufacturer,DriverVersion,DriverDate,InfName,IsSigned | Sort-Object DeviceName | ConvertTo-Csv -NoTypeInformation",
        ),
        (
            "pnputil-enum-drivers.txt",
            "pnputil /enum-drivers",
        ),
        (
            "problem-devices.txt",
            "Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'OK' -or $_.ConfigManagerErrorCode -ne 0 } | Format-List *",
        ),
    ];
    run_command_group(out, &driver_commands)?;
    diagnostics_group_pause();

    progress.step("收集磁盘与电源", "读取磁盘、分区、SMART、卷和电源状态");
    let storage_commands = [
        (
            "physical-disk.txt",
            "Get-PhysicalDisk -ErrorAction SilentlyContinue | Format-List *",
        ),
        (
            "storage-reliability-counter.txt",
            "Get-PhysicalDisk -ErrorAction SilentlyContinue | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue | Format-List *",
        ),
        (
            "smart-failure-predict-status.txt",
            "Get-CimInstance -Namespace root\\wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue | Format-List *",
        ),
        (
            "wmic-diskdrive-status.txt",
            "$wmic=Get-Command wmic.exe -ErrorAction SilentlyContinue; if ($wmic) { & $wmic.Source diskdrive get model,serialnumber,status,size,interfacetype /format:list } else { 'wmic.exe is not available on this Windows installation. Disk data was collected via Get-PhysicalDisk and Win32_DiskDrive instead.' }",
        ),
        ("volumes.txt", "Get-Volume -ErrorAction SilentlyContinue | Format-Table -AutoSize"),
        ("partitions.txt", "Get-Partition -ErrorAction SilentlyContinue | Format-Table -AutoSize"),
        (
            "powercfg.txt",
            "powercfg /a; powercfg /lastwake; powercfg /waketimers",
        ),
    ];
    run_command_group(out, &storage_commands)?;
    diagnostics_group_pause();

    progress.step("收集网络信息", "读取网卡、IP、DNS、路由、代理和连接状态");
    let network_commands = [
        ("ipconfig-all.txt", "ipconfig /all"),
        ("network-routes.txt", "route print"),
        (
            "network-configuration.txt",
            "Get-NetIPConfiguration -ErrorAction SilentlyContinue | Format-List *; Get-DnsClientServerAddress -ErrorAction SilentlyContinue | Format-Table -AutoSize; Get-NetAdapter -ErrorAction SilentlyContinue | Select-Object Name,InterfaceDescription,Status,LinkSpeed,MacAddress | Format-Table -AutoSize; netsh winhttp show proxy",
        ),
        (
            "network-connections.txt",
            "Get-NetTCPConnection -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess | Sort-Object State,LocalPort | Format-Table -AutoSize",
        ),
    ];
    run_command_group(out, &network_commands)?;
    diagnostics_group_pause();

    progress.step("收集进程快照", "读取 CPU 和内存占用最高的进程");
    let process_commands = [
        (
            "process-top-cpu.txt",
            "Get-Process -ErrorAction SilentlyContinue | Sort-Object CPU -Descending | Select-Object -First 40 Name,Id,CPU,WorkingSet64,StartTime,Path | Format-Table -AutoSize",
        ),
        (
            "process-top-memory.txt",
            "Get-Process -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 40 Name,Id,CPU,WorkingSet64,StartTime,Path | Format-Table -AutoSize",
        ),
    ];
    run_command_group(out, &process_commands)?;
    diagnostics_group_pause();

    progress.step("收集更新与启动项", "读取补丁、启动项和服务状态");
    let system_commands = [
        ("hotfixes.txt", "Get-HotFix -ErrorAction SilentlyContinue | Sort-Object InstalledOn -Descending | Format-Table -AutoSize"),
        (
            "startup-commands.csv",
            "Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | Select-Object Name,Command,Location,User | ConvertTo-Csv -NoTypeInformation",
        ),
        ("services.txt", "Get-Service | Sort-Object Status,Name | Format-Table -AutoSize"),
        (
            "memory-dump-info.txt",
            "Get-Item C:\\Windows\\MEMORY.DMP -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime | Format-List",
        ),
    ];
    run_command_group(out, &system_commands)?;
    diagnostics_group_pause();

    progress.step("收集系统修复线索", "读取 CBS、DISM 和 WER 报告摘要");
    let repair_commands = [
        (
            "cbs-log-tail.txt",
            "$path='C:\\Windows\\Logs\\CBS\\CBS.log'; if (Test-Path $path) { Get-Content -LiteralPath $path -Tail 400 -ErrorAction SilentlyContinue } else { 'CBS.log not found.' }",
        ),
        (
            "cbs-recent-errors.txt",
            "$path='C:\\Windows\\Logs\\CBS\\CBS.log'; if (Test-Path $path) { Get-Content -LiteralPath $path -Tail 5000 -ErrorAction SilentlyContinue | Select-String -Pattern '\\[SR\\]','error','failed','corrupt','repair' -CaseSensitive:$false | Select-Object -Last 200 } else { 'CBS.log not found.' }",
        ),
        (
            "dism-log-tail.txt",
            "$path='C:\\Windows\\Logs\\DISM\\dism.log'; if (Test-Path $path) { Get-Content -LiteralPath $path -Tail 400 -ErrorAction SilentlyContinue } else { 'DISM log not found.' }",
        ),
        (
            "wer-report-summary.txt",
            "$roots=@('C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive','C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue'); foreach ($root in $roots) { \"===== $root =====\"; if (Test-Path $root) { Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 40 Name,FullName,CreationTime,LastWriteTime | Format-List } else { 'not found' } }",
        ),
    ];
    run_command_group(out, &repair_commands)?;
    diagnostics_group_pause();

    progress.step("收集 dump 信息", "复制 Minidump 并尝试自动分析");
    let minidump_dir = out.join("Minidump");
    fs::create_dir_all(&minidump_dir)?;
    write_powershell_output(
        &out.join("minidump-copy.txt"),
        &format!(
            "Copy-Item 'C:\\Windows\\Minidump\\*.dmp' '{}' -ErrorAction SilentlyContinue; Get-ChildItem '{}' -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime | Format-Table -AutoSize",
            minidump_dir.to_string_lossy(),
            minidump_dir.to_string_lossy(),
        ),
    )?;
    diagnostics_group_pause();

    let dump_analysis_dir = out.join("DumpAnalysis");
    fs::create_dir_all(&dump_analysis_dir)?;
    write_powershell_output(
        &out.join("dump-analysis.txt"),
        &windows_dump_analysis_command(&minidump_dir, &dump_analysis_dir),
    )?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn diagnostics_group_pause() {
    thread::sleep(Duration::from_millis(80));
}

#[cfg(target_os = "windows")]
fn run_command_group(out: &Path, commands: &[(&str, &str)]) -> Result<()> {
    for (file_name, command) in commands {
        write_powershell_output(&out.join(file_name), command)?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn write_powershell_output(path: &Path, command: &str) -> Result<()> {
    let args = powershell_utf8_args(command);
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    write_command_output(path, "powershell", &arg_refs)
}

#[cfg(target_os = "windows")]
fn powershell_utf8_args(command: &str) -> Vec<String> {
    let wrapped = format!(
        "$utf8 = New-Object System.Text.UTF8Encoding $false; try {{ [Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8 }} catch {{ }} $OutputEncoding = $utf8; chcp.com 65001 > $null; & {{ {command} }}"
    );
    vec![
        "-NoProfile".to_string(),
        "-NonInteractive".to_string(),
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-Command".to_string(),
        wrapped,
    ]
}

#[cfg(target_os = "windows")]
fn windows_dump_analysis_command(dump_dir: &Path, analysis_dir: &Path) -> String {
    let dump_dir = powershell_single_quoted_path(dump_dir);
    let analysis_dir = powershell_single_quoted_path(analysis_dir);
    format!(
        r#"
$DumpDir = {dump_dir}
$AnalysisDir = {analysis_dir}
$SymbolPath = 'srv*C:\Symbols*https://msdl.microsoft.com/download/symbols'
New-Item -ItemType Directory -Force -Path $AnalysisDir | Out-Null

function Find-Exe {{
  param([string]$ExeName, [string[]]$CandidatePaths)
  $cmd = Get-Command $ExeName -ErrorAction SilentlyContinue
  if ($cmd) {{ return $cmd.Source }}
  foreach ($path in $CandidatePaths) {{
    $resolvedPaths = Resolve-Path -Path $path -ErrorAction SilentlyContinue
    foreach ($resolved in $resolvedPaths) {{
      if (Test-Path -LiteralPath $resolved.ProviderPath) {{ return $resolved.ProviderPath }}
    }}
    if (Test-Path -LiteralPath $path) {{ return $path }}
  }}
  return $null
}}

if (!(Test-Path $DumpDir)) {{
  'No dump directory found.' | Out-File (Join-Path $AnalysisDir 'no-dump.txt') -Encoding utf8
  exit 0
}}

$dumps = Get-ChildItem $DumpDir -Filter '*.dmp' -ErrorAction SilentlyContinue
if (!$dumps -or $dumps.Count -eq 0) {{
  'No .dmp files found.' | Out-File (Join-Path $AnalysisDir 'no-dump.txt') -Encoding utf8
  exit 0
}}

$cdb = Find-Exe 'cdb.exe' @(
  'C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe',
  'C:\Program Files\Windows Kits\10\Debuggers\x64\cdb.exe',
  'C:\Program Files (x86)\Windows Kits\11\Debuggers\x64\cdb.exe',
  'C:\Program Files\Windows Kits\11\Debuggers\x64\cdb.exe'
)

if ($cdb) {{
  "Using cdb.exe: $cdb" | Out-File (Join-Path $AnalysisDir 'debugger-used.txt') -Encoding utf8
  foreach ($dump in $dumps) {{
    $log = Join-Path $AnalysisDir ($dump.BaseName + '-analyze.txt')
    & $cdb -z $dump.FullName -y $SymbolPath -c '.reload; !analyze -v; lm; q' | Out-File $log -Encoding utf8
  }}
  exit 0
}}

$windbgx = Find-Exe 'windbgx.exe' @(
  "$env:LOCALAPPDATA\Microsoft\WindowsApps\windbgx.exe",
  "$env:ProgramFiles\WindowsApps\Microsoft.WinDbg_*\windbgx.exe"
)

if ($windbgx) {{
  "Using windbgx.exe: $windbgx" | Out-File (Join-Path $AnalysisDir 'debugger-used.txt') -Encoding utf8
  foreach ($dump in $dumps) {{
    $log = Join-Path $AnalysisDir ($dump.BaseName + '-analyze.txt')
    & $windbgx -z $dump.FullName -logo $log -c '.symfix; .reload; !analyze -v; lm; q'
  }}
  exit 0
}}

@'
No debugger found.

Minidump files were collected, but automatic dump analysis was not run.

Recommended install:
  winget install --id Microsoft.WinDbg -e

Alternative install:
  Install Windows SDK Debugging Tools, then ensure cdb.exe is available.

After installing, generate this diagnostics package again. The agent will detect
cdb.exe or windbgx.exe and run:
  !analyze -v
  lm

Manual WinDbg flow:
  windbgx.exe -z C:\Path\To\Minidump\file.dmp
  .symfix
  .reload
  !analyze -v
  lm
'@ | Out-File (Join-Path $AnalysisDir 'debugger-not-found.txt') -Encoding utf8
"Debugger not found. Install Microsoft.WinDbg with winget, then rerun diagnostics." | Out-File (Join-Path $AnalysisDir 'windbg-install-hint.txt') -Encoding utf8
"winget install --id Microsoft.WinDbg -e" | Out-File (Join-Path $AnalysisDir 'windbg-install-command.txt') -Encoding utf8
"#,
    )
}

#[cfg(target_os = "windows")]
fn powershell_single_quoted_path(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

#[cfg(target_os = "macos")]
fn collect_platform_diagnostics(
    out: &Path,
    progress: &mut DiagnosticsProgressEmitter,
) -> Result<()> {
    progress.step(
        "收集系统概况",
        "读取 macOS 硬件、软件、电源、存储和显示信息",
    );
    let commands = [(
        "system-profiler.txt",
        "system_profiler",
        vec![
            "SPHardwareDataType",
            "SPSoftwareDataType",
            "SPPowerDataType",
            "SPStorageDataType",
            "SPNVMeDataType",
            "SPSerialATADataType",
            "SPDisplaysDataType",
        ],
    )];
    for (file_name, program, args) in commands {
        write_command_output(&out.join(file_name), program, &args)?;
    }

    progress.step("收集磁盘与电源", "读取磁盘和电源状态");
    let commands = [
        ("diskutil-list.txt", "diskutil", vec!["list"]),
        ("diskutil-info-root.txt", "diskutil", vec!["info", "/"]),
        (
            "pmset.txt",
            "sh",
            vec!["-c", "pmset -g; pmset -g batt; pmset -g assertions"],
        ),
    ];
    for (file_name, program, args) in commands {
        write_command_output(&out.join(file_name), program, &args)?;
    }

    progress.step("收集系统日志", "读取最近错误和诊断报告列表");
    let commands = [
        (
            "recent-errors.log",
            "sh",
            vec![
                "-c",
                "log show --last 2h --style compact --predicate 'messageType == \"Error\" OR messageType == \"Fault\"' 2>/dev/null | tail -400",
            ],
        ),
        (
            "recent-diagnostic-reports.txt",
            "sh",
            vec![
                "-c",
                "find \"$HOME/Library/Logs/DiagnosticReports\" /Library/Logs/DiagnosticReports -type f \\( -name '*.crash' -o -name '*.panic' -o -name '*.ips' \\) -mtime -14 2>/dev/null | sort | tail -80",
            ],
        ),
    ];

    for (file_name, program, args) in commands {
        write_command_output(&out.join(file_name), program, &args)?;
    }

    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn collect_platform_diagnostics(
    out: &Path,
    progress: &mut DiagnosticsProgressEmitter,
) -> Result<()> {
    progress.step("收集系统信息", "读取系统版本");
    let commands = [("uname.txt", "uname", vec!["-a"])];
    for (file_name, program, args) in commands {
        write_command_output(&out.join(file_name), program, &args)?;
    }

    progress.step("收集磁盘信息", "读取文件系统空间");
    let commands = [("df.txt", "df", vec!["-h"])];
    for (file_name, program, args) in commands {
        write_command_output(&out.join(file_name), program, &args)?;
    }

    progress.step("收集系统日志", "读取内核和 journal 警告");
    let commands = [
        ("dmesg-tail.txt", "sh", vec!["-c", "dmesg 2>/dev/null | tail -300"]),
        (
            "journal-errors.txt",
            "sh",
            vec!["-c", "journalctl -p warning..alert --since '24 hours ago' --no-pager 2>/dev/null | tail -500"],
        ),
    ];
    for (file_name, program, args) in commands {
        write_command_output(&out.join(file_name), program, &args)?;
    }
    Ok(())
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

fn count_log_payload_lines(path: &Path) -> usize {
    let Ok(content) = fs::read_to_string(path) else {
        return 0;
    };
    content
        .lines()
        .filter(|line| is_command_payload_line(line))
        .count()
}

fn count_payload_matching_lines(path: &Path, patterns: &[&str]) -> usize {
    let Ok(content) = fs::read_to_string(path) else {
        return 0;
    };
    content
        .lines()
        .filter(|line| is_command_payload_line(line))
        .filter(|line| {
            let lower = line.to_lowercase();
            patterns.iter().any(|pattern| lower.contains(pattern))
        })
        .count()
}

fn count_matching_lines(path: &Path, patterns: &[&str]) -> usize {
    let Ok(content) = fs::read_to_string(path) else {
        return 0;
    };
    content
        .lines()
        .filter(|line| {
            let lower = line.to_lowercase();
            patterns.iter().any(|pattern| lower.contains(pattern))
        })
        .count()
}

fn is_command_payload_line(line: &str) -> bool {
    let line = line.trim();
    !line.is_empty()
        && !line.starts_with("command:")
        && !line.starts_with("status:")
        && !line.starts_with("---")
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

fn value_text(value: &Value, pointer: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or("unknown")
        .to_string()
}

fn value_u64(value: &Value, pointer: &str) -> Option<u64> {
    value.pointer(pointer).and_then(Value::as_u64)
}

fn value_f64(value: &Value, pointer: &str) -> Option<f64> {
    value.pointer(pointer).and_then(Value::as_f64)
}

fn join_non_empty(items: &[String]) -> String {
    let joined = items
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty() && *item != "unknown")
        .collect::<Vec<_>>()
        .join(" ");
    if joined.is_empty() {
        "unknown".to_string()
    } else {
        joined
    }
}

fn primary_temperature_summary(runtime_status: &Value) -> Value {
    runtime_status
        .get("temperatures")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                let temperature = item.get("temperature_c")?.as_f64()?;
                Some(json!({
                    "label": item.get("label").and_then(Value::as_str).unwrap_or("sensor"),
                    "temperature_c": temperature,
                }))
            })
        })
        .unwrap_or(Value::Null)
}

fn write_command_output(path: &Path, program: &str, args: &[&str]) -> Result<()> {
    let output = command_output_with_timeout(program, args, DIAGNOSTICS_COMMAND_TIMEOUT);
    let content = match output {
        Ok(output) => {
            let mut text = String::new();
            text.push_str(&format!("command: {} {}\n", program, args.join(" ")));
            text.push_str(&format!("status: {}\n", output.status));
            if output.timed_out {
                text.push_str(&format!(
                    "timed_out: true after {} seconds\n",
                    DIAGNOSTICS_COMMAND_TIMEOUT.as_secs()
                ));
            }
            text.push('\n');
            text.push_str("--- stdout ---\n");
            text.push_str(&String::from_utf8_lossy(&output.stdout));
            text.push_str("\n--- stderr ---\n");
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            text
        }
        Err(error) => format!("command: {} {}\nfailed: {error}\n", program, args.join(" ")),
    };
    write_text(path, &redact_diagnostics_text(&content.replace('\0', "")))
}

struct TimedCommandOutput {
    status: std::process::ExitStatus,
    timed_out: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn command_output_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> std::io::Result<TimedCommandOutput> {
    let mut child = new_command(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let start = Instant::now();
    let mut timed_out = false;
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if start.elapsed() >= timeout {
            timed_out = true;
            let _ = child.kill();
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }

    let output = child.wait_with_output()?;
    Ok(TimedCommandOutput {
        status: output.status,
        timed_out,
        stdout: output.stdout,
        stderr: output.stderr,
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
    const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x00004000;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
}

#[cfg(not(target_os = "windows"))]
fn configure_command_window(_command: &mut Command) {}

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
    fn external_url_is_limited_to_project_github_pages() {
        assert!(validate_external_url(PROJECT_URL).is_ok());
        assert!(validate_external_url(
            "https://github.com/muze-page/npcink-device-inventory/releases/download/v1/app.zip"
        )
        .is_ok());
        assert!(
            validate_external_url("http://github.com/muze-page/npcink-device-inventory").is_err()
        );
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
    fn runtime_history_coverage_marks_short_sessions() {
        let coverage = runtime_history_coverage(&json!({
            "sample_count": 8,
            "started_at": "2026-07-03T01:54:09Z",
            "ended_at": "2026-07-03T01:54:43Z",
        }));

        assert_eq!(coverage["quality"], "short");
        assert_eq!(coverage["duration_seconds"], 34);
        assert_eq!(coverage["recommended_minimum_seconds"], 300);
    }

    #[test]
    fn diagnostics_runtime_status_json_redacts_network_identity() {
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
            device_identity_type: "device_uuid_v1".to_string(),
            device_identity: "device_uuid_v1_example".to_string(),
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
        assert_eq!(payload["device_identity"]["type"], "device_uuid_v1");
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

    #[test]
    fn diagnostics_summary_file_is_written() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let out = std::env::temp_dir().join(format!(
            "npcink-diagnostics-summary-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&out).unwrap();
        fs::write(
            out.join("recent-errors.log"),
            "command: log show\n--- stdout ---\nerror one\n",
        )
        .unwrap();
        fs::write(
            out.join("recent-diagnostic-reports.txt"),
            "/tmp/report.crash\n/tmp/report.ips\n",
        )
        .unwrap();
        fs::write(out.join(APP_LOG_FILE), "{}\n").unwrap();

        let static_data = json!({
            "os": {
                "hostname": "[redacted]",
                "distro": "MacOS",
                "release": "26.5.1"
            },
            "system": {
                "manufacturer": "Apple",
                "model": "MacBook Air"
            },
            "cpu": {
                "manufacturer": "Apple",
                "brand": "M5"
            },
            "mem": {
                "total": 17179869184_u64
            }
        });
        let runtime_status = json!({
            "collected_at": "2026-07-01T00:00:00Z",
            "cpu": { "usage_percent": 12.5 },
            "memory": { "used": 8_u64, "total": 16_u64 },
            "disk": { "used": 400_u64, "total": 500_u64, "available": 100_u64, "mount": "/" },
            "temperatures": [{ "label": "sensor", "temperature_c": 55.0 }]
        });
        let runtime_history_summary = json!({
            "sample_count": 1,
            "cpu": { "average_percent": 12.5, "max_percent": 12.5 },
        });
        let runtime_history_coverage = json!({
            "quality": "short",
            "sample_count": 1,
            "duration_seconds": 0,
        });
        let privilege_info = json!({
            "is_admin": false,
            "label": "普通权限",
            "source": "test",
        });

        write_diagnostics_summary(
            &out,
            &static_data,
            &runtime_status,
            &runtime_history_summary,
            &runtime_history_coverage,
            &privilege_info,
        )
        .unwrap();
        let summary: Value = serde_json::from_str(
            &fs::read_to_string(out.join("diagnostics-summary.json")).unwrap(),
        )
        .unwrap();

        assert_eq!(summary["schema"], "npcink-diagnostics-summary-v1");
        assert_eq!(summary["privilege"]["is_admin"], false);
        assert_eq!(summary["runtime"]["history_coverage"]["quality"], "short");
        assert_eq!(summary["signals"]["recent_error_lines"], 1);
        assert_eq!(summary["signals"]["diagnostic_report_count"], 2);
        assert!(summary["package_files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "diagnostics-summary.json"));

        fs::remove_dir_all(out).unwrap();
    }
}
