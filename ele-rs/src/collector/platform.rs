use serde_json::{json, Map, Value};
use std::process::Command;

// Some Windows NIC drivers fail when hidden adapters are enumerated. Retry
// without hidden adapters so a usable physical PCI NIC is not lost merely
// because an unrelated virtual adapter reports an error.
#[cfg(any(target_os = "windows", test))]
const WINDOWS_NETWORK_HARDWARE_COMMANDS: [&str; 2] = [
    "Get-NetAdapter -Physical -IncludeHidden -ErrorAction Stop | Where-Object { $_.Virtual -ne $true } | Select-Object Name,InterfaceDescription,InterfaceIndex,InterfaceGuid,PnPDeviceID,MacAddress,PermanentAddress,Status,ConnectorPresent,HardwareInterface,Virtual",
    "Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Virtual -ne $true } | Select-Object Name,InterfaceDescription,InterfaceIndex,InterfaceGuid,PnPDeviceID,MacAddress,PermanentAddress,Status,ConnectorPresent,HardwareInterface,Virtual",
];

pub(crate) fn enrich(root: &mut Map<String, Value>) {
    enrich_impl(root);
}

pub(crate) fn hardware_uuid() -> Option<String> {
    hardware_uuid_impl()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(target_os = "windows")]
fn enrich_impl(root: &mut Map<String, Value>) {
    if let Some(value) = powershell_json("Get-CimInstance Win32_BIOS | Select-Object Manufacturer,SMBIOSBIOSVersion,SerialNumber,ReleaseDate,Version") {
        root.insert("bios".to_string(), normalize_windows_bios(&value));
    }
    if let Some(value) = powershell_json(
        "Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer,Product,SerialNumber,Version",
    ) {
        root.insert("baseboard".to_string(), normalize_windows_baseboard(&value));
    }
    if let Some(value) = powershell_json("Get-CimInstance Win32_Processor | Select-Object Name,Manufacturer,ProcessorId,UniqueId,SerialNumber,SocketDesignation,NumberOfCores,NumberOfLogicalProcessors") {
        root.insert(
            "processorIdentity".to_string(),
            normalize_windows_processor_identity(&value),
        );
    }
    let network_hardware = collect_windows_network_hardware();
    if !network_hardware.is_empty() {
        root.insert("networkHardware".to_string(), network_hardware);
    }
    if let Some(value) = powershell_json("Get-CimInstance Win32_SystemEnclosure | Select-Object Manufacturer,SerialNumber,ChassisTypes") {
        root.insert("chassis".to_string(), value);
    }
    if let Some(value) = powershell_json("Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,SystemType,SystemFamily,SystemSKUNumber") {
        root.insert(
            "system".to_string(),
            normalize_windows_system(&value, root.get("system")),
        );
    }
    if let Some(value) = powershell_json("Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer,PartNumber,SerialNumber,Capacity,Speed,ConfiguredClockSpeed,SMBIOSMemoryType,FormFactor,DeviceLocator,BankLabel") {
        let modules = normalize_windows_memory_modules(&value);
        if modules.as_array().is_some_and(|items| !items.is_empty()) {
            root.insert("memLayout".to_string(), modules);
        }
    }
    if let Some(value) = powershell_json("Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,VideoProcessor,DriverVersion") {
        root.insert(
            "graphics".to_string(),
            json!({ "controllers": normalize_windows_graphics_controllers(&value) }),
        );
    }
    insert_empty_if_missing(root, "bios");
    insert_empty_if_missing(root, "baseboard");
    insert_empty_if_missing(root, "chassis");
    insert_empty_if_missing(root, "graphics");
    insert_array_if_missing(root, "processorIdentity");
    insert_array_if_missing(root, "networkHardware");
}

#[cfg(target_os = "windows")]
fn collect_windows_network_hardware() -> Value {
    for command in WINDOWS_NETWORK_HARDWARE_COMMANDS {
        if let Some(value) = powershell_json(command) {
            let interfaces = normalize_windows_network_hardware(&value);
            if !interfaces.is_empty() {
                return interfaces;
            }
        }
    }

    Value::Array(Vec::new())
}

#[cfg(target_os = "macos")]
fn enrich_impl(root: &mut Map<String, Value>) {
    if let Some(value) = command_json(
        "system_profiler",
        &["-json", "SPHardwareDataType", "SPDisplaysDataType"],
    ) {
        enrich_macos_system_profiler(root, &value);
        root.insert("platformData".to_string(), value);
    }
    insert_empty_if_missing(root, "bios");
    insert_empty_if_missing(root, "baseboard");
    insert_empty_if_missing(root, "chassis");
    insert_empty_if_missing(root, "graphics");
    insert_array_if_missing(root, "processorIdentity");
    insert_array_if_missing(root, "networkHardware");
}

#[cfg(target_os = "macos")]
fn enrich_macos_system_profiler(root: &mut Map<String, Value>, value: &Value) {
    let hardware = value
        .get("SPHardwareDataType")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(Value::as_object);

    if let Some(hardware) = hardware {
        let machine_name = string_field(hardware, "machine_name");
        let machine_model = string_field(hardware, "machine_model");
        let model_number = string_field(hardware, "model_number");
        let serial_number = string_field(hardware, "serial_number");
        let platform_uuid = string_field(hardware, "platform_UUID");
        let chip_type = string_field(hardware, "chip_type");
        let physical_memory = string_field(hardware, "physical_memory");
        let boot_rom_version = string_field(hardware, "boot_rom_version");

        root.insert(
            "system".to_string(),
            json!({
                "manufacturer": "Apple",
                "model": machine_name,
                "version": model_number,
                "serial": serial_number,
                "uuid": platform_uuid,
                "sku": machine_model,
            }),
        );
        root.insert(
            "baseboard".to_string(),
            json!({
                "manufacturer": "Apple",
                "model": machine_model,
                "product": machine_name,
                "version": model_number,
                "serial": serial_number,
                "memMax": physical_memory,
                "chip": chip_type,
            }),
        );
        root.insert(
            "bios".to_string(),
            json!({
                "vendor": "Apple",
                "version": boot_rom_version,
                "serial": serial_number,
            }),
        );
    }

    if let Some(displays) = value.get("SPDisplaysDataType").and_then(Value::as_array) {
        let controllers = displays
            .iter()
            .map(|item| {
                let model = first_non_empty(&[
                    string_value(item, "sppci_model"),
                    string_value(item, "_name"),
                ]);
                json!({
                    "vendor": string_value(item, "spdisplays_vendor").replace("sppci_vendor_", ""),
                    "model": model,
                    "cores": string_value(item, "sppci_cores"),
                    "bus": string_value(item, "sppci_bus").replace("spdisplays_", ""),
                })
            })
            .collect::<Vec<_>>();

        let display_rows = displays
            .iter()
            .flat_map(|item| {
                item.get("spdisplays_ndrvs")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
            })
            .map(|display| {
                let resolution = first_non_empty(&[
                    string_value(&display, "_spdisplays_pixels"),
                    string_value(&display, "_spdisplays_resolution"),
                ]);
                json!({
                    "model": string_value(&display, "_name"),
                    "resolution": resolution,
                    "retina": string_value(&display, "spdisplays_pixelresolution"),
                    "type": string_value(&display, "spdisplays_display_type").replace("spdisplays_", ""),
                    "main": string_value(&display, "spdisplays_main"),
                })
            })
            .collect::<Vec<_>>();

        root.insert(
            "graphics".to_string(),
            json!({
                "controllers": controllers,
                "displays": display_rows,
            }),
        );
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn enrich_impl(root: &mut Map<String, Value>) {
    insert_empty_if_missing(root, "bios");
    insert_empty_if_missing(root, "baseboard");
    insert_empty_if_missing(root, "chassis");
    insert_empty_if_missing(root, "graphics");
    insert_array_if_missing(root, "processorIdentity");
    insert_array_if_missing(root, "networkHardware");
}

#[cfg(target_os = "windows")]
fn hardware_uuid_impl() -> Option<String> {
    powershell_scalar("(Get-CimInstance Win32_ComputerSystemProduct).UUID")
}

#[cfg(target_os = "macos")]
fn hardware_uuid_impl() -> Option<String> {
    let output = command_text("ioreg", &["-rd1", "-c", "IOPlatformExpertDevice"])?;
    output.lines().find_map(|line| {
        let line = line.trim();
        if !line.contains("IOPlatformUUID") {
            return None;
        }
        line.split('=')
            .nth(1)
            .map(|value| value.trim().trim_matches('"').to_string())
    })
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn hardware_uuid_impl() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn powershell_json(command: &str) -> Option<Value> {
    let wrapped = format!("{command} | ConvertTo-Json -Compress");
    command_json("powershell", &["-NoProfile", "-Command", &wrapped])
}

#[cfg(target_os = "windows")]
fn powershell_scalar(command: &str) -> Option<String> {
    command_text("powershell", &["-NoProfile", "-Command", command])
}

#[cfg(target_os = "windows")]
fn normalize_windows_bios(value: &Value) -> Value {
    json!({
        "vendor": value_text(value, "Manufacturer"),
        "version": first_non_empty(&[
            value_text(value, "SMBIOSBIOSVersion"),
            value_text(value, "Version"),
        ]),
        "serial": value_text(value, "SerialNumber"),
        "releaseDate": value_text(value, "ReleaseDate"),
    })
}

#[cfg(target_os = "windows")]
fn normalize_windows_baseboard(value: &Value) -> Value {
    json!({
        "manufacturer": value_text(value, "Manufacturer"),
        "product": value_text(value, "Product"),
        "model": value_text(value, "Product"),
        "version": value_text(value, "Version"),
        "serial": value_text(value, "SerialNumber"),
    })
}

#[cfg(target_os = "windows")]
fn normalize_windows_processor_identity(value: &Value) -> Value {
    Value::Array(
        value_items(value)
            .into_iter()
            .map(|item| {
                json!({
                    "name": value_text(item, "Name"),
                    "manufacturer": value_text(item, "Manufacturer"),
                    "processorId": value_text(item, "ProcessorId"),
                    "uniqueId": value_text(item, "UniqueId"),
                    "serialNumber": value_text(item, "SerialNumber"),
                    "socketDesignation": value_text(item, "SocketDesignation"),
                    "numberOfCores": value_u64_at(item, "NumberOfCores"),
                    "numberOfLogicalProcessors": value_u64_at(item, "NumberOfLogicalProcessors"),
                })
            })
            .collect(),
    )
}

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_network_hardware(value: &Value) -> Value {
    Value::Array(
        value_items(value)
            .into_iter()
            .map(|item| {
                json!({
                    "name": value_text(item, "Name"),
                    "interfaceDescription": value_text(item, "InterfaceDescription"),
                    "interfaceIndex": value_u64_at(item, "InterfaceIndex"),
                    "interfaceGuid": value_text(item, "InterfaceGuid"),
                    "pnpDeviceId": value_text(item, "PnPDeviceID"),
                    "macAddress": value_text(item, "MacAddress"),
                    "permanentAddress": value_text(item, "PermanentAddress"),
                    "status": value_text(item, "Status"),
                    "connectorPresent": item.get("ConnectorPresent").and_then(Value::as_bool),
                    "hardwareInterface": item.get("HardwareInterface").and_then(Value::as_bool),
                    "virtual": item.get("Virtual").and_then(Value::as_bool),
                })
            })
            .collect(),
    )
}

#[cfg(target_os = "windows")]
fn normalize_windows_system(value: &Value, current: Option<&Value>) -> Value {
    json!({
        "manufacturer": value_text(value, "Manufacturer"),
        "model": value_text(value, "Model"),
        "version": value_text(value, "SystemFamily"),
        "serial": value_text(current.unwrap_or(&Value::Null), "serial"),
        "uuid": value_text(current.unwrap_or(&Value::Null), "uuid"),
        "sku": value_text(value, "SystemSKUNumber"),
        "type": value_text(value, "SystemType"),
    })
}

#[cfg(target_os = "windows")]
fn normalize_windows_graphics_controllers(value: &Value) -> Value {
    Value::Array(
        value_items(value)
            .into_iter()
            .map(|item| {
                json!({
                    "model": value_text(item, "Name"),
                    "vendor": graphics_vendor(item),
                    "vram": item.get("AdapterRAM").and_then(Value::as_u64),
                    "videoProcessor": value_text(item, "VideoProcessor"),
                    "driverVersion": value_text(item, "DriverVersion"),
                })
            })
            .collect(),
    )
}

#[cfg(target_os = "windows")]
fn normalize_windows_memory_modules(value: &Value) -> Value {
    Value::Array(
        value_items(value)
            .into_iter()
            .filter_map(|item| {
                let size = value_u64_at(item, "Capacity")?;
                let clock_speed = value_u64_at(item, "ConfiguredClockSpeed")
                    .or_else(|| value_u64_at(item, "Speed"));
                let smbios_type = value_u64_at(item, "SMBIOSMemoryType");
                let form_factor = value_u64_at(item, "FormFactor");
                Some(json!({
                    "bank": first_non_empty(&[
                        value_text(item, "BankLabel"),
                        value_text(item, "DeviceLocator"),
                    ]),
                    "size": size,
                    "type": smbios_type
                        .map(memory_type_label)
                        .filter(|label| !label.is_empty())
                        .unwrap_or_default(),
                    "clockSpeed": clock_speed.unwrap_or_default(),
                    "formFactor": form_factor
                        .map(memory_form_factor_label)
                        .filter(|label| !label.is_empty())
                        .unwrap_or_default(),
                    "manufacturer": value_text(item, "Manufacturer"),
                    "serialNum": value_text(item, "SerialNumber"),
                    "partNum": value_text(item, "PartNumber"),
                }))
            })
            .collect(),
    )
}

#[cfg(target_os = "windows")]
fn memory_type_label(code: u64) -> String {
    match code {
        20 => "DDR",
        21 => "DDR2",
        24 => "DDR3",
        26 => "DDR4",
        34 => "DDR5",
        35 => "LPDDR",
        36 => "LPDDR2",
        37 => "LPDDR3",
        38 => "LPDDR4",
        39 => "Logical non-volatile device",
        40 => "HBM",
        41 => "HBM2",
        42 => "DDR5",
        43 => "LPDDR5",
        _ => "",
    }
    .to_string()
}

#[cfg(target_os = "windows")]
fn memory_form_factor_label(code: u64) -> String {
    match code {
        8 => "DIMM",
        9 => "TSOP",
        10 => "PGA",
        11 => "RIMM",
        12 => "SODIMM",
        13 => "SRIMM",
        14 => "SMD",
        15 => "SSMP",
        16 => "QFP",
        17 => "TQFP",
        18 => "SOIC",
        19 => "LCC",
        20 => "PLCC",
        21 => "BGA",
        22 => "FPBGA",
        23 => "LGA",
        _ => "",
    }
    .to_string()
}

#[cfg(target_os = "windows")]
fn graphics_vendor(value: &Value) -> String {
    let text = first_non_empty(&[
        value_text(value, "VideoProcessor"),
        value_text(value, "Name"),
    ]);
    text.split_whitespace()
        .next()
        .unwrap_or_default()
        .to_string()
}

#[cfg(any(target_os = "windows", test))]
fn value_items(value: &Value) -> Vec<&Value> {
    value
        .as_array()
        .map(|items| items.iter().collect())
        .unwrap_or_else(|| vec![value])
}

#[cfg(any(target_os = "windows", test))]
fn value_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or_default()
        .to_string()
}

#[cfg(any(target_os = "windows", test))]
fn value_u64_at(value: &Value, key: &str) -> Option<u64> {
    let value = value.get(key)?;
    if let Some(number) = value.as_u64() {
        return Some(number);
    }
    value
        .as_str()
        .map(str::trim)
        .and_then(|text| text.parse::<u64>().ok())
}

fn command_json(program: &str, args: &[&str]) -> Option<Value> {
    let text = command_text(program, args)?;
    serde_json::from_str(&text).ok()
}

fn command_text(program: &str, args: &[&str]) -> Option<String> {
    let output = new_command(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
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

fn insert_empty_if_missing(root: &mut Map<String, Value>, key: &str) {
    if !root.contains_key(key) {
        root.insert(key.to_string(), json!({}));
    }
}

fn insert_array_if_missing(root: &mut Map<String, Value>, key: &str) {
    if !root.contains_key(key) {
        root.insert(key.to_string(), Value::Array(Vec::new()));
    }
}

#[cfg(target_os = "macos")]
fn string_field(map: &Map<String, Value>, key: &str) -> String {
    map.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[cfg(target_os = "macos")]
fn string_value(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn first_non_empty(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_permanent_pci_mac_for_133_style_adapter() {
        let source = json!({
            "Name": "以太网",
            "InterfaceDescription": "Realtek PCIe GbE Family Controller",
            "InterfaceIndex": 2,
            "PnPDeviceID": "PCI\\VEN_10EC&DEV_8168",
            "MacAddress": "00-E0-1E-84-A4-99",
            "PermanentAddress": "00E01E84A499",
            "Virtual": false
        });

        let interfaces = normalize_windows_network_hardware(&source);
        assert_eq!(
            interfaces.pointer("/0/pnpDeviceId"),
            Some(&json!("PCI\\VEN_10EC&DEV_8168"))
        );
        assert_eq!(
            interfaces.pointer("/0/permanentAddress"),
            Some(&json!("00E01E84A499"))
        );
    }

    #[test]
    fn retries_visible_adapters_after_hidden_adapter_query() {
        assert!(WINDOWS_NETWORK_HARDWARE_COMMANDS[0].contains("-IncludeHidden"));
        assert!(WINDOWS_NETWORK_HARDWARE_COMMANDS[0].contains("-ErrorAction Stop"));
        assert!(!WINDOWS_NETWORK_HARDWARE_COMMANDS[1].contains("-IncludeHidden"));
        assert!(WINDOWS_NETWORK_HARDWARE_COMMANDS[1].contains("-ErrorAction Stop"));
    }
}
