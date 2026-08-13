use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub(crate) const APP_DIR_NAME: &str = "npcink-device-agent";
const CREDENTIAL_SERVICE: &str = "ink.npc.npcink-device-agent";
const CREDENTIAL_USER: &str = "device-upload-token";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct AgentConfig {
    pub(crate) site: String,
    pub(crate) name: String,
    pub(crate) token: String,
    pub(crate) preset_label: String,
}

pub(crate) fn validate_config(config: &AgentConfig) -> Result<(), String> {
    if config.site.trim().is_empty() {
        return Err("请填写站点地址或设备上传接口地址".to_string());
    }
    if config.token.is_empty() {
        return Err("请填写上传授权码".to_string());
    }
    let endpoint = npcink_device_agent::upload::resolved_observation_endpoint(&config.site);
    npcink_device_agent::upload::validate_config_values(&endpoint, &config.token)
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn read_config() -> Result<AgentConfig> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AgentConfig::default());
    }
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("failed to read config {}", path.display()))?;
    let mut config: AgentConfig = serde_json::from_str(&raw).context("failed to parse config")?;
    if uses_system_credential_store() && !config.token.is_empty() {
        store_token(&config.token)?;
        config.token.clear();
        write_public_config(&path, &config)?;
    }
    config.token = read_token()?;
    Ok(config)
}

pub(crate) fn write_config(config: AgentConfig) -> Result<()> {
    validate_config(&config).map_err(anyhow::Error::msg)?;
    let path = config_path()?;
    store_token(&config.token)?;
    let mut public_config = config;
    if uses_system_credential_store() {
        public_config.token.clear();
    }
    write_public_config(&path, &public_config)
}

fn write_public_config(path: &Path, config: &AgentConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create config dir {}", parent.display()))?;
        restrict_directory_permissions(parent)?;
    }
    let raw = serde_json::to_string_pretty(config).context("failed to encode config")?;
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("failed to open config {}", path.display()))?;
    file.write_all(raw.as_bytes())
        .with_context(|| format!("failed to write config {}", path.display()))?;
    file.sync_all()
        .with_context(|| format!("failed to sync config {}", path.display()))?;
    restrict_file_permissions(path)
}

pub(crate) fn clear_config() -> Result<()> {
    let path = config_path()?;
    delete_token()?;
    if path.exists() {
        fs::remove_file(&path)
            .with_context(|| format!("failed to remove config {}", path.display()))?;
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn credential_entry() -> Result<keyring::Entry> {
    keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER)
        .context("failed to open system credential store")
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn store_token(token: &str) -> Result<()> {
    credential_entry()?
        .set_password(token)
        .context("failed to save upload token in system credential store")
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn store_token(_token: &str) -> Result<()> {
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn read_token() -> Result<String> {
    match credential_entry()?.get_password() {
        Ok(token) => Ok(token),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => {
            Err(error).context("failed to read upload token from system credential store")
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn read_token() -> Result<String> {
    Ok(String::new())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn delete_token() -> Result<()> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => {
            Err(error).context("failed to remove upload token from system credential store")
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn delete_token() -> Result<()> {
    Ok(())
}

const fn uses_system_credential_store() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

fn config_path() -> Result<PathBuf> {
    let base = dirs::config_dir().context("failed to resolve config dir")?;
    Ok(base.join(APP_DIR_NAME).join("config.json"))
}

#[cfg(unix)]
fn restrict_directory_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .with_context(|| format!("failed to restrict config dir {}", path.display()))
}

#[cfg(not(unix))]
fn restrict_directory_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn restrict_file_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .with_context(|| format!("failed to restrict config {}", path.display()))
}

#[cfg(not(unix))]
fn restrict_file_permissions(_path: &Path) -> Result<()> {
    Ok(())
}
