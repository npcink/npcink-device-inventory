use serde_json::{json, Map, Value};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::process::Command;

// Some Windows NIC drivers fail when hidden adapters are enumerated. Retry
// without hidden adapters so a usable physical PCI NIC is not lost merely
// because an unrelated virtual adapter reports an error.
#[cfg(any(target_os = "windows", test))]
const WINDOWS_NETWORK_HARDWARE_COMMANDS: [&str; 4] = [
    "Get-NetAdapter -Physical -IncludeHidden -ErrorAction Stop | Where-Object { $_.Virtual -ne $true } | Select-Object Name,InterfaceDescription,InterfaceIndex,InterfaceGuid,PnPDeviceID,MacAddress,PermanentAddress,Status,ConnectorPresent,HardwareInterface,Virtual",
    "Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Virtual -ne $true } | Select-Object Name,InterfaceDescription,InterfaceIndex,InterfaceGuid,PnPDeviceID,MacAddress,PermanentAddress,Status,ConnectorPresent,HardwareInterface,Virtual",
    "Get-NetAdapter -IncludeHidden -ErrorAction Stop | Select-Object Name,InterfaceDescription,InterfaceIndex,InterfaceGuid,PnPDeviceID,MacAddress,PermanentAddress,Status,ConnectorPresent,HardwareInterface,Virtual",
    "Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetAdapter -ErrorAction Stop | Select-Object Name,InterfaceDescription,InterfaceIndex,InterfaceGuid,PnPDeviceID,MacAddress,PermanentAddress,Status,ConnectorPresent,HardwareInterface,Virtual",
];

#[cfg(any(target_os = "windows", test))]
const WINDOWS_POWERSHELL_UTF8_PREAMBLE: &str = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; ";

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
    enrich_identity(root);
    if let Some(value) = powershell_json("Get-NetIPConfiguration -All -ErrorAction SilentlyContinue | Select-Object InterfaceAlias,InterfaceIndex,@{Name='IPv4DefaultGateway';Expression={$_.IPv4DefaultGateway.NextHop}},@{Name='IPv6DefaultGateway';Expression={$_.IPv6DefaultGateway.NextHop}},@{Name='DnsServers';Expression={$_.DNSServer.ServerAddresses}},@{Name='Dhcp';Expression={$_.NetIPv4Interface.Dhcp}}") {
        enrich_windows_network_configuration(root, &value);
    }
    if let Some(value) = powershell_json("Get-CimInstance Win32_SystemEnclosure | Select-Object Manufacturer,SerialNumber,ChassisTypes") {
        root.insert("chassis".to_string(), normalize_windows_chassis(&value));
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
    if let Some(value) = powershell_json("Get-CimInstance Win32_DiskDrive | Select-Object Model,SerialNumber,Size,MediaType,InterfaceType,DeviceID,FirmwareRevision,PNPDeviceID") {
        let disks = normalize_windows_physical_disks(&value);
        if disks.as_array().is_some_and(|items| !items.is_empty()) {
            root.insert("diskLayout".to_string(), disks);
        }
    }
    enrich_windows_summary_with(root, powershell_identity_json);
    insert_empty_if_missing(root, "bios");
    insert_empty_if_missing(root, "baseboard");
    insert_empty_if_missing(root, "chassis");
    insert_empty_if_missing(root, "graphics");
    insert_array_if_missing(root, "processorIdentity");
    insert_array_if_missing(root, "networkHardware");
}

// Ordinary uploads include the hardware that the local summary promises to show.
pub(crate) fn enrich_upload(root: &mut Map<String, Value>) {
    enrich_identity(root);
    #[cfg(target_os = "windows")]
    enrich_windows_summary_with(root, powershell_identity_json);
    #[cfg(target_os = "macos")]
    {
        let started = std::time::Instant::now();
        let value = command_json(
            "system_profiler",
            &[
                "-json",
                "SPHardwareDataType",
                "SPDisplaysDataType",
                "SPPowerDataType",
            ],
        );
        if let Some(value) = &value {
            enrich_macos_bios(root, value);
            enrich_macos_media(root, value);
        }
        root.insert(
            "hardwareProbeAttempts".into(),
            json!([{
                "source": "system_profiler_hardware_displays_power",
                "status": if value.is_some() { "ok" } else { "failed" },
                "elapsedMs": started.elapsed().as_millis() as u64,
            }]),
        );
    }
}

#[cfg(any(target_os = "windows", test))]
fn enrich_windows_summary_with(
    root: &mut Map<String, Value>,
    mut query: impl FnMut(&str) -> Result<Value, String>,
) {
    let mut attempts = Vec::new();
    let mut read = |source: &str, command: &str| {
        let started = std::time::Instant::now();
        let result = query(command);
        let mut attempt =
            json!({"source": source, "elapsedMs": started.elapsed().as_millis() as u64});
        let value = match result {
            Ok(value) => {
                attempt["status"] = json!(if value_items(&value).is_empty() {
                    "empty"
                } else {
                    "ok"
                });
                value
            }
            Err(error) => {
                attempt["status"] = json!("failed");
                attempt["error"] = json!(error);
                json!([])
            }
        };
        attempts.push(attempt);
        value
    };
    let controllers = read("video_controllers", "Get-CimInstance Win32_VideoController -ErrorAction Stop | Select-Object Name,AdapterRAM,VideoProcessor,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate");
    let monitors = read("monitor_edid", "Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID -ErrorAction Stop | Select-Object InstanceName,Active,ManufacturerName,UserFriendlyName,SerialNumberID,YearOfManufacture,WeekOfManufacture");
    let desktop = read("desktop_monitors", "Get-CimInstance Win32_DesktopMonitor -ErrorAction Stop | Select-Object PNPDeviceID,Name,MonitorManufacturer,MonitorType,ScreenWidth,ScreenHeight,Status");
    let batteries = read("batteries", "Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object Name,DeviceID,Status,BatteryStatus,Chemistry,DesignCapacity,FullChargeCapacity,EstimatedChargeRemaining,EstimatedRunTime,DesignVoltage");
    let bios = read("bios", "Get-CimInstance Win32_BIOS -ErrorAction Stop | Select-Object Manufacturer,SMBIOSBIOSVersion,SerialNumber,ReleaseDate,Version");
    if let Some(bios) = value_items(&bios).first() {
        root.insert("bios".into(), normalize_windows_bios(bios));
    }
    root.insert(
        "graphics".into(),
        json!({
            "controllers": normalize_windows_graphics_controllers(&controllers),
            "displays": normalize_windows_displays(&monitors, &desktop, &controllers),
        }),
    );
    root.insert("battery".into(), normalize_windows_batteries(&batteries));
    root.insert("hardwareProbeAttempts".into(), json!(attempts));
}

// Identity facts are required even when upload-light skips other inventories.
pub(crate) fn enrich_identity(root: &mut Map<String, Value>) {
    #[cfg(target_os = "windows")]
    enrich_windows_identity_with(root, powershell_identity_json);
    #[cfg(not(target_os = "windows"))]
    let _ = root;
}

#[cfg(any(target_os = "windows", test))]
fn enrich_windows_identity_with(
    root: &mut Map<String, Value>,
    mut query: impl FnMut(&str) -> Result<Value, String>,
) {
    let mut attempts = Vec::new();
    for (source, command) in [
        ("baseboard", "Get-CimInstance Win32_BaseBoard -ErrorAction Stop | Select-Object Manufacturer,Product,SerialNumber,Version"),
        ("processors", "Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object Name,Manufacturer,ProcessorId,UniqueId,SerialNumber,SocketDesignation,NumberOfCores,NumberOfLogicalProcessors,CurrentClockSpeed,MaxClockSpeed,ExtClock"),
    ] {
        match query(command) {
            Ok(value) => {
                attempts.push(json!({"source": source, "status": if value_items(&value).is_empty() { "empty" } else { "ok" }}));
                if source == "baseboard" {
                    if let Some(board) = value_items(&value).first() {
                        root.insert("baseboard".into(), normalize_windows_baseboard(board));
                    }
                } else {
                    root.insert("processorIdentity".into(), normalize_windows_processor_identity(&value));
                    enrich_windows_cpu(root, &value);
                }
            }
            Err(error) => attempts.push(json!({"source": source, "status": "failed", "error": error})),
        }
    }
    let mut interfaces = Vec::new();
    for (index, command) in WINDOWS_NETWORK_HARDWARE_COMMANDS.iter().enumerate() {
        let source = [
            "physical_hidden",
            "physical",
            "all_hidden",
            "cim_netadapter",
        ][index];
        match query(command) {
            Ok(value) => {
                let normalized = normalize_windows_network_hardware(&value);
                let rows = normalized
                    .as_array()
                    .expect("normalized adapters are an array");
                let usable = rows
                    .iter()
                    .filter(|item| super::permanent_pci_mac(item).is_some())
                    .count();
                attempts.push(json!({"source": source, "status": "ok", "adapterCount": rows.len(), "usablePermanentPciMacCount": usable}));
                for row in rows {
                    if !interfaces.contains(row) {
                        interfaces.push(row.clone());
                    }
                }
                // Nonempty results alone do not establish a usable identity.
                if usable > 0 {
                    break;
                }
            }
            Err(error) => {
                attempts.push(json!({"source": source, "status": "failed", "error": error}))
            }
        }
    }
    root.insert("networkHardware".into(), json!(interfaces));
    root.insert("identityProbeAttempts".into(), json!(attempts));
}

#[cfg(target_os = "windows")]
fn powershell_identity_json(command: &str) -> Result<Value, String> {
    let wrapped = powershell_utf8_command(&format!(
        "$ErrorActionPreference='Stop'; {command} | ConvertTo-Json -Compress -Depth 4"
    ));
    let output = new_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &wrapped])
        .output()
        .map_err(|error| format!("spawn_failed: {error}"))?;
    if !output.status.success() {
        // Do not put raw command output or private identifiers into diagnostics.
        return Err(format!(
            "query_failed: exit_code={:?}",
            output.status.code()
        ));
    }
    parse_identity_query_output(&output.stdout)
}

#[cfg(any(target_os = "windows", test))]
fn parse_identity_query_output(stdout: &[u8]) -> Result<Value, String> {
    let text = std::str::from_utf8(stdout).map_err(|_| "invalid_utf8".to_string())?;
    let text = text.trim_start_matches('\u{feff}').trim();
    if text.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }
    let value: Value = serde_json::from_str(text).map_err(|_| "invalid_json".to_string())?;
    if value.is_null() {
        Ok(json!([]))
    } else if value.is_object() || value.is_array() {
        Ok(value)
    } else {
        Err("unexpected_json_type".to_string())
    }
}

#[cfg(target_os = "macos")]
fn enrich_impl(root: &mut Map<String, Value>) {
    if let Some(value) = command_json(
        "system_profiler",
        &[
            "-json",
            "SPHardwareDataType",
            "SPDisplaysDataType",
            "SPNVMeDataType",
            "SPSerialATADataType",
            "SPPowerDataType",
        ],
    ) {
        enrich_macos_system_profiler(root, &value);
        root.insert("platformData".to_string(), value);
    }
    enrich_macos_network_configuration(root);
    enrich_macos_cpu(root);
    insert_empty_if_missing(root, "bios");
    insert_empty_if_missing(root, "baseboard");
    insert_empty_if_missing(root, "chassis");
    insert_empty_if_missing(root, "graphics");
    insert_array_if_missing(root, "processorIdentity");
    insert_array_if_missing(root, "networkHardware");
}

#[cfg(target_os = "macos")]
fn enrich_macos_cpu(root: &mut Map<String, Value>) {
    let sysctl_u64 = |name: &str| {
        command_text("sysctl", &["-n", name]).and_then(|value| value.trim().parse::<u64>().ok())
    };
    let Some(cpu) = root.get_mut("cpu").and_then(Value::as_object_mut) else {
        return;
    };
    let frequency_mhz = |name: &str| sysctl_u64(name).map(|hz| hz / 1_000_000);
    if let Some(value) = frequency_mhz("hw.cpufrequency") {
        cpu.insert("baseFrequency".to_string(), json!(value));
    }
    if let Some(value) = frequency_mhz("hw.cpufrequency_min") {
        cpu.insert("minFrequency".to_string(), json!(value));
    }
    if let Some(value) = frequency_mhz("hw.cpufrequency_max") {
        cpu.insert("maxFrequency".to_string(), json!(value));
    }
    if let Some(value) = sysctl_u64("hw.perflevel0.physicalcpu") {
        cpu.insert("performanceCores".to_string(), json!(value));
    }
    if let Some(value) = sysctl_u64("hw.perflevel1.physicalcpu") {
        cpu.insert("efficiencyCores".to_string(), json!(value));
    }
}

#[cfg(target_os = "macos")]
fn enrich_macos_network_configuration(root: &mut Map<String, Value>) {
    let Some(route) = command_text("route", &["-n", "get", "default"]) else {
        return;
    };
    let Some((interface, gateway)) = parse_macos_default_route(&route) else {
        return;
    };
    let dns_servers = command_text("scutil", &["--dns"])
        .map(|value| parse_macos_dns_servers(&value))
        .unwrap_or_default();
    let dhcp =
        command_text("ipconfig", &["getpacket", &interface]).map(|value| !value.trim().is_empty());
    let Some(rows) = root.get_mut("net").and_then(Value::as_array_mut) else {
        return;
    };
    for row in rows {
        let is_default = [value_text(row, "iface"), value_text(row, "ifaceName")]
            .iter()
            .any(|value| value == &interface);
        let Some(map) = row.as_object_mut() else {
            continue;
        };
        map.insert("default".to_string(), json!(is_default));
        if is_default {
            map.insert("defaultGateway".to_string(), json!(gateway));
            map.insert("gateway".to_string(), json!(gateway));
            map.insert("dnsServers".to_string(), json!(dns_servers));
            map.insert("dhcp".to_string(), json!(dhcp));
        }
    }
}

#[cfg(any(target_os = "macos", test))]
fn parse_macos_default_route(value: &str) -> Option<(String, String)> {
    let field = |name: &str| {
        value.lines().find_map(|line| {
            let (key, result) = line.trim().split_once(':')?;
            key.eq_ignore_ascii_case(name)
                .then(|| result.trim().to_string())
                .filter(|result| !result.is_empty())
        })
    };
    Some((field("interface")?, field("gateway")?))
}

#[cfg(any(target_os = "macos", test))]
fn parse_macos_dns_servers(value: &str) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    value
        .lines()
        .filter_map(|line| {
            let (key, result) = line.trim().split_once(':')?;
            key.trim_start()
                .starts_with("nameserver[")
                .then(|| result.trim().to_string())
                .filter(|result| !result.is_empty())
        })
        .filter(|server| seen.insert(server.clone()))
        .collect()
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
    }
    enrich_macos_bios(root, value);
    enrich_macos_media(root, value);
}

#[cfg(any(target_os = "macos", test))]
fn enrich_macos_bios(root: &mut Map<String, Value>, value: &Value) {
    if let Some(hardware) = value
        .get("SPHardwareDataType")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
    {
        root.insert(
            "bios".into(),
            json!({
                "vendor": "Apple",
                "version": string_value(hardware, "boot_rom_version"),
                "serial": string_value(hardware, "serial_number"),
            }),
        );
    }
}

#[cfg(target_os = "macos")]
fn enrich_macos_media(root: &mut Map<String, Value>, value: &Value) {
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

    let physical_disks = normalize_macos_physical_disks(value);
    if physical_disks
        .as_array()
        .is_some_and(|items| !items.is_empty())
    {
        root.insert("diskLayout".to_string(), physical_disks);
    }

    let batteries = normalize_macos_batteries(value);
    if batteries.as_array().is_some_and(|items| !items.is_empty()) {
        root.insert("battery".to_string(), batteries);
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
    let wrapped = powershell_utf8_command(&format!("{command} | ConvertTo-Json -Compress"));
    command_json("powershell", &["-NoProfile", "-Command", &wrapped])
}

#[cfg(target_os = "windows")]
fn powershell_scalar(command: &str) -> Option<String> {
    let wrapped = powershell_utf8_command(command);
    command_text("powershell", &["-NoProfile", "-Command", &wrapped])
}

#[cfg(any(target_os = "windows", test))]
fn powershell_utf8_command(command: &str) -> String {
    format!("{WINDOWS_POWERSHELL_UTF8_PREAMBLE}{command}")
}

#[cfg(any(target_os = "windows", test))]
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

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_baseboard(value: &Value) -> Value {
    json!({
        "manufacturer": value_text(value, "Manufacturer"),
        "product": value_text(value, "Product"),
        "model": value_text(value, "Product"),
        "version": value_text(value, "Version"),
        "serial": value_text(value, "SerialNumber"),
    })
}

#[cfg(any(target_os = "windows", test))]
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
                    "currentClockSpeed": value_u64_at(item, "CurrentClockSpeed"),
                    "maxClockSpeed": value_u64_at(item, "MaxClockSpeed"),
                    "externalClock": value_u64_at(item, "ExtClock"),
                })
            })
            .collect(),
    )
}

#[cfg(any(target_os = "windows", test))]
fn enrich_windows_cpu(root: &mut Map<String, Value>, value: &Value) {
    let processors = value_items(value);
    let Some(cpu) = root.get_mut("cpu").and_then(Value::as_object_mut) else {
        return;
    };
    let max_frequency = processors
        .iter()
        .filter_map(|item| value_u64_at(item, "MaxClockSpeed"))
        .max()
        .unwrap_or_default();
    let current_frequency = processors
        .iter()
        .filter_map(|item| value_u64_at(item, "CurrentClockSpeed"))
        .max()
        .unwrap_or_default();
    let physical_cores = processors
        .iter()
        .filter_map(|item| value_u64_at(item, "NumberOfCores"))
        .sum::<u64>();
    let logical_cores = processors
        .iter()
        .filter_map(|item| value_u64_at(item, "NumberOfLogicalProcessors"))
        .sum::<u64>();
    cpu.insert("frequency".to_string(), json!(current_frequency));
    cpu.insert("maxFrequency".to_string(), json!(max_frequency));
    cpu.insert("physicalCores".to_string(), json!(physical_cores));
    cpu.insert("cores".to_string(), json!(logical_cores));
    cpu.insert("processors".to_string(), json!(processors.len()));
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

#[cfg(any(target_os = "windows", test))]
fn enrich_windows_network_configuration(root: &mut Map<String, Value>, value: &Value) {
    let Some(rows) = root.get_mut("net").and_then(Value::as_array_mut) else {
        return;
    };
    let configurations = value_items(value);
    for row in rows {
        let iface = first_non_empty(&[value_text(row, "iface"), value_text(row, "ifaceName")]);
        let Some(configuration) = configurations.iter().copied().find(|configuration| {
            value_text(configuration, "InterfaceAlias").eq_ignore_ascii_case(&iface)
        }) else {
            continue;
        };
        let gateway = first_non_empty(&[
            value_text(configuration, "IPv4DefaultGateway"),
            value_text(configuration, "IPv6DefaultGateway"),
        ]);
        let dns_servers = string_array_at(configuration, "DnsServers");
        if let Some(map) = row.as_object_mut() {
            map.insert("defaultGateway".to_string(), json!(gateway));
            map.insert("gateway".to_string(), json!(gateway));
            map.insert("dnsServers".to_string(), json!(dns_servers));
            map.insert(
                "dhcp".to_string(),
                json!(configuration.get("Dhcp").and_then(parse_windows_enabled)),
            );
            map.insert("default".to_string(), json!(!gateway.is_empty()));
        }
    }
}

#[cfg(any(target_os = "windows", test))]
fn parse_windows_enabled(value: &Value) -> Option<bool> {
    if let Some(value) = value.as_bool() {
        return Some(value);
    }
    if let Some(value) = value.as_u64() {
        return match value {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        };
    }
    match value.as_str()?.trim().to_ascii_lowercase().as_str() {
        "enabled" | "true" | "1" => Some(true),
        "disabled" | "false" | "0" => Some(false),
        _ => None,
    }
}

#[cfg(any(target_os = "windows", test))]
fn string_array_at(value: &Value, key: &str) -> Vec<String> {
    match value.get(key) {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
            .collect(),
        Some(Value::String(text)) if !text.trim().is_empty() => vec![text.trim().to_string()],
        _ => Vec::new(),
    }
}

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_chassis(value: &Value) -> Value {
    let item = value_items(value)
        .into_iter()
        .next()
        .unwrap_or(&Value::Null);
    let chassis_types = item
        .get("ChassisTypes")
        .map(|value| {
            value_items(value)
                .into_iter()
                .filter_map(value_u64)
                .map(chassis_type_label)
                .filter(|label| !label.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    json!({
        "manufacturer": value_text(item, "Manufacturer"),
        "vendor": value_text(item, "Manufacturer"),
        "model": chassis_types.first().cloned().unwrap_or_default(),
        "type": chassis_types.join(", "),
        "serial": value_text(item, "SerialNumber"),
        "serialNumber": value_text(item, "SerialNumber"),
        "chassisTypes": item.get("ChassisTypes").cloned().unwrap_or(Value::Array(Vec::new())),
    })
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

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_graphics_controllers(value: &Value) -> Value {
    Value::Array(
        value_items(value)
            .into_iter()
            .filter(|item| item.is_object())
            .map(|item| {
                json!({
                    "model": value_text(item, "Name"),
                    "vendor": graphics_vendor(item),
                    "vram": item.get("AdapterRAM").and_then(Value::as_u64),
                    "videoProcessor": value_text(item, "VideoProcessor"),
                    "driverVersion": value_text(item, "DriverVersion"),
                    "currentResX": value_u64_at(item, "CurrentHorizontalResolution"),
                    "currentResY": value_u64_at(item, "CurrentVerticalResolution"),
                    "currentRefreshRate": value_u64_at(item, "CurrentRefreshRate"),
                })
            })
            .collect(),
    )
}

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_displays(
    monitors: &Value,
    desktop_monitors: &Value,
    controllers: &Value,
) -> Value {
    let mut monitor_values = value_items(monitors)
        .into_iter()
        .filter(|item| item.is_object())
        .cloned()
        .collect::<Vec<_>>();
    for desktop in value_items(desktop_monitors) {
        let pnp = value_text(desktop, "PNPDeviceID");
        if pnp.is_empty()
            || monitor_values
                .iter()
                .any(|item| same_display_instance(&value_text(item, "InstanceName"), &pnp))
        {
            continue;
        }
        monitor_values.push(json!({"InstanceName": pnp}));
    }
    let monitor_items = monitor_values
        .iter()
        .filter(|item| item.is_object())
        .collect::<Vec<_>>();
    // Win32_VideoController reports a controller mode rather than a monitor-specific
    // mode. It is safe as a fallback for one monitor, but would be misleading if
    // copied onto every row of a multi-monitor setup.
    let current_mode = (monitor_items.len() == 1)
        .then(|| {
            value_items(controllers).into_iter().find_map(|item| {
                let x = value_u64_at(item, "CurrentHorizontalResolution")?;
                let y = value_u64_at(item, "CurrentVerticalResolution")?;
                Some((x, y, value_u64_at(item, "CurrentRefreshRate")))
            })
        })
        .flatten();

    Value::Array(
        monitor_items
            .into_iter()
            .map(|item| {
                let instance_name = value_text(item, "InstanceName");
                let desktop = value_items(desktop_monitors).into_iter().find(|desktop| {
                    same_display_instance(
                        &instance_name,
                        &value_text(desktop, "PNPDeviceID"),
                    )
                });
                let desktop_x = desktop.and_then(|value| value_u64_at(value, "ScreenWidth"));
                let desktop_y = desktop.and_then(|value| value_u64_at(value, "ScreenHeight"));
                let (fallback_x, fallback_y, current_refresh_rate) =
                    current_mode.unwrap_or((0, 0, None));
                json!({
                    "model": first_non_empty(&[
                        wmi_char_array_text(item.get("UserFriendlyName")),
                        desktop.map(|value| value_text(value, "Name")).unwrap_or_default(),
                    ]),
                    "vendor": first_non_empty(&[
                        wmi_char_array_text(item.get("ManufacturerName")),
                        desktop.map(|value| value_text(value, "MonitorManufacturer")).unwrap_or_default(),
                    ]),
                    "serial": wmi_char_array_text(item.get("SerialNumberID")),
                    "instanceName": instance_name,
                    "pnpDeviceId": desktop.map(|value| value_text(value, "PNPDeviceID")).unwrap_or_default(),
                    "active": item.get("Active").and_then(Value::as_bool),
                    "status": desktop.map(|value| value_text(value, "Status")).unwrap_or_default(),
                    "type": desktop.map(|value| value_text(value, "MonitorType")).unwrap_or_default(),
                    "yearOfManufacture": value_u64_at(item, "YearOfManufacture"),
                    "weekOfManufacture": value_u64_at(item, "WeekOfManufacture"),
                    "currentResX": desktop_x.unwrap_or(fallback_x),
                    "currentResY": desktop_y.unwrap_or(fallback_y),
                    "currentRefreshRate": current_refresh_rate,
                })
            })
            .collect(),
    )
}

#[cfg(any(target_os = "windows", test))]
fn same_display_instance(wmi_instance: &str, pnp_device_id: &str) -> bool {
    let normalize = |value: &str| {
        let value = value.trim().to_ascii_uppercase();
        value
            .rsplit_once('_')
            .filter(|(_, suffix)| suffix.chars().all(|character| character.is_ascii_digit()))
            .map(|(prefix, _)| prefix.to_string())
            .unwrap_or(value)
    };
    let wmi = normalize(wmi_instance);
    let pnp = normalize(pnp_device_id);
    !wmi.is_empty()
        && !pnp.is_empty()
        && (wmi == pnp || wmi.starts_with(&pnp) || pnp.starts_with(&wmi))
}

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_physical_disks(value: &Value) -> Value {
    Value::Array(
        value_items(value)
            .into_iter()
            .filter(|item| item.is_object())
            .filter_map(|item| {
                let model = value_text(item, "Model");
                let device = value_text(item, "DeviceID");
                let serial = value_text(item, "SerialNumber");
                let size = value_u64_at(item, "Size").unwrap_or_default();
                if model.is_empty() && device.is_empty() && serial.is_empty() && size == 0 {
                    return None;
                }
                Some(json!({
                    "name": model,
                    "model": model,
                    "device": device,
                    "serialNum": serial,
                    "serial": serial,
                    "size": size,
                    "type": normalize_disk_media_type(&value_text(item, "MediaType"), &model),
                    "mediaType": value_text(item, "MediaType"),
                    "interfaceType": value_text(item, "InterfaceType"),
                    "firmwareRevision": value_text(item, "FirmwareRevision"),
                    "pnpDeviceId": value_text(item, "PNPDeviceID"),
                }))
            })
            .collect(),
    )
}

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_batteries(value: &Value) -> Value {
    Value::Array(
        value_items(value)
            .into_iter()
            .filter(|item| item.is_object())
            .filter_map(|item| {
                let name = value_text(item, "Name");
                let device_id = value_text(item, "DeviceID");
                if name.is_empty() && device_id.is_empty() {
                    return None;
                }
                let design_capacity = value_u64_at(item, "DesignCapacity").unwrap_or_default();
                let full_charge_capacity =
                    value_u64_at(item, "FullChargeCapacity").unwrap_or_default();
                Some(json!({
                    "name": name,
                    "deviceId": device_id,
                    "status": value_text(item, "Status"),
                    "batteryStatus": value_u64_at(item, "BatteryStatus"),
                    "chemistry": value_u64_at(item, "Chemistry"),
                    "designCapacity": design_capacity,
                    "fullChargeCapacity": full_charge_capacity,
                    "healthPercent": capacity_health_percent(full_charge_capacity, design_capacity),
                    "chargePercent": value_u64_at(item, "EstimatedChargeRemaining"),
                    "estimatedRunTimeMinutes": value_u64_at(item, "EstimatedRunTime"),
                    "designVoltageMv": value_u64_at(item, "DesignVoltage"),
                }))
            })
            .collect(),
    )
}

#[cfg(any(target_os = "windows", test))]
fn capacity_health_percent(full_charge_capacity: u64, design_capacity: u64) -> Option<u64> {
    (full_charge_capacity > 0 && design_capacity > 0)
        .then(|| full_charge_capacity.saturating_mul(100) / design_capacity)
}

#[cfg(any(target_os = "windows", target_os = "macos", test))]
fn normalize_disk_media_type(media_type: &str, model: &str) -> String {
    let combined = format!("{media_type} {model}").to_ascii_lowercase();
    if combined.contains("nvme") || combined.contains("ssd") || combined.contains("solid state") {
        "SSD".to_string()
    } else if combined.contains("fixed hard disk") || combined.contains("hdd") {
        "HDD".to_string()
    } else if combined.contains("removable") {
        "Removable".to_string()
    } else {
        media_type.trim().to_string()
    }
}

#[cfg(any(target_os = "macos", test))]
fn bytes_from_profiler_text(value: &str) -> Option<u64> {
    let lower = value.to_ascii_lowercase();
    let bytes_index = lower.find("bytes")?;
    let before_bytes = &value[..bytes_index];
    let start = before_bytes.rfind('(').unwrap_or_default();
    let digits = before_bytes[start..]
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    (!digits.is_empty()).then(|| digits.parse().ok()).flatten()
}

#[cfg(any(target_os = "macos", test))]
fn normalize_macos_physical_disks(value: &Value) -> Value {
    let mut rows = Vec::new();
    for data_type in ["SPNVMeDataType", "SPSerialATADataType"] {
        if let Some(items) = value.get(data_type).and_then(Value::as_array) {
            collect_macos_disk_rows(items, data_type, &mut rows);
        }
    }
    Value::Array(rows)
}

#[cfg(any(target_os = "macos", test))]
fn normalize_macos_batteries(value: &Value) -> Value {
    let rows = value
        .get("SPPowerDataType")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let health = item
                .get("sppower_battery_health_info")
                .and_then(Value::as_object);
            let charge = item
                .get("sppower_battery_charge_info")
                .and_then(Value::as_object);
            let model = item
                .get("sppower_battery_model_info")
                .and_then(Value::as_object);
            if health.is_none() && charge.is_none() && model.is_none() {
                return None;
            }
            Some(json!({
                "name": model.and_then(|map| map.get("sppower_device_name")).and_then(Value::as_str).unwrap_or("Internal Battery"),
                "serial": model.and_then(|map| map.get("sppower_battery_serial_number")).and_then(Value::as_str).unwrap_or_default(),
                "manufacturer": model.and_then(|map| map.get("sppower_battery_manufacturer")).and_then(Value::as_str).unwrap_or_default(),
                "firmwareVersion": model.and_then(|map| map.get("sppower_battery_firmware_version")).and_then(Value::as_str).unwrap_or_default(),
                "cycleCount": health.and_then(|map| map.get("sppower_battery_cycle_count")).and_then(value_u64),
                "condition": health.and_then(|map| map.get("sppower_battery_health")).and_then(Value::as_str).unwrap_or_default(),
                "healthPercent": health.and_then(|map| {
                    map.get("sppower_battery_health_maximum_capacity")
                        .or_else(|| map.get("sppower_battery_maximum_capacity"))
                }).and_then(percent_value),
                "chargePercent": charge.and_then(|map| map.get("sppower_battery_state_of_charge")).and_then(percent_value),
                "fullyCharged": charge.and_then(|map| map.get("sppower_battery_fully_charged")).and_then(Value::as_str).map(|value| value == "spbattery_yes"),
                "charging": charge.and_then(|map| map.get("sppower_battery_is_charging")).and_then(Value::as_str).map(|value| value == "spbattery_yes"),
            }))
        })
        .collect();
    Value::Array(rows)
}

#[cfg(any(target_os = "macos", test))]
fn percent_value(value: &Value) -> Option<u64> {
    value_u64(value).or_else(|| {
        value
            .as_str()
            .map(|text| text.trim().trim_end_matches('%'))
            .and_then(|text| text.parse().ok())
    })
}

#[cfg(any(target_os = "macos", test))]
fn collect_macos_disk_rows(items: &[Value], data_type: &str, rows: &mut Vec<Value>) {
    for item in items {
        if let Some(children) = item.get("_items").and_then(Value::as_array) {
            collect_macos_disk_rows(children, data_type, rows);
        }
        if let Some(children) = item
            .get("spsata_physical_interconnect")
            .and_then(Value::as_array)
        {
            collect_macos_disk_rows(children, data_type, rows);
        }

        let model = first_non_empty(&[
            string_value(item, "device_model"),
            string_value(item, "spsata_model"),
            string_value(item, "_name"),
        ]);
        let serial = first_non_empty(&[
            string_value(item, "device_serial"),
            string_value(item, "spsata_serial-number"),
        ]);
        let size_text = first_non_empty(&[
            string_value(item, "size"),
            string_value(item, "spsata_size"),
        ]);
        let size = item
            .get("size_in_bytes")
            .and_then(value_u64)
            .or_else(|| bytes_from_profiler_text(&size_text))
            .unwrap_or_default();
        let physical = item.get("physical_drive").and_then(Value::as_object);
        let media_type = first_non_empty(&[
            physical
                .and_then(|map| map.get("medium_type"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            string_value(item, "medium_type"),
        ]);

        let looks_like_disk = !serial.is_empty()
            || size > 0
            || item.get("device_model").is_some()
            || item.get("spsata_model").is_some();
        if !looks_like_disk {
            continue;
        }
        let interface_type = if data_type == "SPNVMeDataType" {
            "NVMe".to_string()
        } else {
            first_non_empty(&[
                string_value(item, "spsata_physical_interconnect"),
                string_value(item, "protocol"),
                "SATA".to_string(),
            ])
        };
        rows.push(json!({
            "name": model,
            "model": model,
            "device": string_value(item, "bsd_name"),
            "serialNum": serial,
            "serial": serial,
            "size": size,
            "type": normalize_disk_media_type(&media_type, &model),
            "mediaType": media_type,
            "interfaceType": interface_type,
            "firmwareRevision": first_non_empty(&[
                string_value(item, "firmware_revision"),
                string_value(item, "spsata_revision"),
            ]),
        }));
    }
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

#[cfg(any(target_os = "windows", test))]
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

#[cfg(any(target_os = "windows", target_os = "macos", test))]
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

#[cfg(any(target_os = "windows", target_os = "macos", test))]
fn value_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|number| u64::try_from(number).ok()))
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
}

#[cfg(any(target_os = "windows", test))]
fn wmi_char_array_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(value_u64)
            .take_while(|code| *code != 0)
            .filter_map(|code| char::from_u32(code as u32))
            .collect::<String>()
            .trim()
            .to_string(),
        Some(Value::String(text)) => text.trim_matches(char::from(0)).trim().to_string(),
        _ => String::new(),
    }
}

#[cfg(any(target_os = "windows", test))]
fn chassis_type_label(code: u64) -> String {
    match code {
        3 => "Desktop",
        4 => "Low Profile Desktop",
        5 => "Pizza Box",
        6 => "Mini Tower",
        7 => "Tower",
        8 => "Portable",
        9 => "Laptop",
        10 => "Notebook",
        13 => "All in One",
        14 => "Sub Notebook",
        30 => "Tablet",
        31 => "Convertible",
        32 => "Detachable",
        35 => "Mini PC",
        36 => "Stick PC",
        _ => "",
    }
    .to_string()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn command_json(program: &str, args: &[&str]) -> Option<Value> {
    let text = command_text(program, args)?;
    serde_json::from_str(&text).ok()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn command_text(program: &str, args: &[&str]) -> Option<String> {
    let output = new_command(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
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

#[cfg(target_os = "macos")]
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

#[cfg(any(target_os = "macos", test))]
fn string_value(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[cfg(any(target_os = "windows", target_os = "macos", test))]
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
    fn ordinary_upload_keeps_bios_graphics_battery_and_identity_when_edid_fails() {
        let data = super::super::collect_upload_data_with(|root| {
            root.insert("uuid".into(), json!({"hardware": "9e9738c7-0418-fb17-af0e-345a601d798b"}));
            enrich_windows_summary_with(root, |command| {
                if command.contains("Win32_BIOS") { return Ok(json!({"Manufacturer": "AMI", "SMBIOSBIOSVersion": "1.20", "SerialNumber": "Default string"})); }
                if command.contains("Win32_VideoController") { return Ok(json!({"Name": "Test GPU", "DriverVersion": "1.2", "CurrentHorizontalResolution": 1920, "CurrentVerticalResolution": 1080})); }
                if command.contains("WmiMonitorID") { return Err("query_failed".into()); }
                if command.contains("Win32_DesktopMonitor") { return Ok(json!({"PNPDeviceID": "DISPLAY\\TEST\\1", "Name": "Test monitor", "ScreenWidth": 1920, "ScreenHeight": 1080})); }
                Ok(json!({"Name": "Laptop battery", "EstimatedChargeRemaining": 0, "DesignCapacity": 50000, "FullChargeCapacity": 40000}))
            });
        }).unwrap();
        assert_eq!(data["bios"]["vendor"], "AMI");
        assert_eq!(data["bios"]["version"], "1.20");
        assert_eq!(data["graphics"]["controllers"][0]["model"], "Test GPU");
        assert_eq!(data["graphics"]["displays"][0]["model"], "Test monitor");
        assert_eq!(data["graphics"]["displays"][0]["currentResX"], 1920);
        assert_eq!(data["battery"][0]["chargePercent"], 0);
        assert_eq!(data["battery"][0]["healthPercent"], 80.0);
        assert_eq!(data["hardwareProbeAttempts"][1]["status"], "failed");
        let upload = crate::upload::build_observation_v3("test", &data).unwrap();
        assert_eq!(upload["asset"]["hardware"]["bios"], data["bios"]);
        assert_eq!(upload["asset"]["hardware"]["graphics"], data["graphics"]);
        assert_eq!(upload["asset"]["hardware"]["battery"], data["battery"]);
        assert_eq!(super::super::hardware_identities_v2(&data).len(), 1);
    }

    #[test]
    fn missing_optional_hardware_does_not_create_blank_devices_or_block_identity() {
        let mut root = Map::new();
        root.insert(
            "uuid".into(),
            json!({"hardware": "9e9738c7-0418-fb17-af0e-345a601d798b"}),
        );
        enrich_windows_summary_with(&mut root, |command| {
            if command.contains("Win32_Battery") {
                Ok(json!([]))
            } else {
                Err("query_failed".into())
            }
        });
        let data = Value::Object(root);
        assert_eq!(data["graphics"], json!({"controllers": [], "displays": []}));
        assert_eq!(data["battery"], json!([]));
        assert_eq!(data["hardwareProbeAttempts"][3]["status"], "empty");
        assert_eq!(data["hardwareProbeAttempts"][4]["status"], "failed");
        assert!(data.get("bios").is_none());
        assert!(crate::upload::build_observation_v3("test", &data).is_ok());
    }

    #[test]
    fn macos_firmware_summary_preserves_existing_identity_facts() {
        let mut root = Map::new();
        root.insert("system".into(), json!({"uuid": "existing-system"}));
        root.insert("baseboard".into(), json!({"serial": "existing-board"}));
        enrich_macos_bios(
            &mut root,
            &json!({"SPHardwareDataType": [{
                "boot_rom_version": "123.4", "serial_number": "new-serial", "platform_UUID": "new-uuid"
            }]}),
        );
        assert_eq!(root["bios"]["version"], "123.4");
        assert_eq!(root["system"]["uuid"], "existing-system");
        assert_eq!(root["baseboard"]["serial"], "existing-board");
    }

    #[test]
    fn desktop_monitor_fallback_fills_missing_screen_without_duplicating_edid() {
        let monitors = json!([{"InstanceName": "DISPLAY\\ONE\\1_0", "Active": true}]);
        let desktop = json!([
            {"PNPDeviceID": "DISPLAY\\ONE\\1", "Name": "First", "ScreenWidth": 1920, "ScreenHeight": 1080},
            {"PNPDeviceID": "DISPLAY\\TWO\\2", "Name": "Second", "ScreenWidth": 2560, "ScreenHeight": 1440}
        ]);
        let result = normalize_windows_displays(&monitors, &desktop, &json!([]));
        assert_eq!(result.as_array().unwrap().len(), 2);
        assert_eq!(result[0]["model"], "First");
        assert_eq!(result[1]["model"], "Second");
        assert_eq!(result[1]["currentResX"], 2560);
        assert!(result[1]["serial"].as_str().unwrap().is_empty());
        assert!(result[1]["currentRefreshRate"].is_null());
    }

    #[test]
    fn upload_light_135_survives_each_network_fallback_and_preserves_identity() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/identity-135.json")).unwrap();
        // Exercise normal success, visible-only, unfiltered, and direct CIM.
        for success_at in 0..4 {
            let mut network_calls = 0;
            let data = super::super::collect_upload_data_with(|root| {
                root.insert("uuid".into(), json!({"hardware": fixture["systemUuid"]}));
                root.insert("system".into(), json!({"uuid": fixture["systemUuid"]}));
                enrich_windows_identity_with(root, |command| {
                    if command.contains("Win32_BaseBoard") { return Ok(fixture["baseboard"].clone()); }
                    if command.contains("Win32_Processor") { return Ok(fixture["processor"].clone()); }
                    let attempt = network_calls;
                    network_calls += 1;
                    if attempt == success_at {
                        // Test single-object PowerShell JSON as well as arrays.
                        let response = if success_at % 2 == 0 { fixture["adapter"].clone() } else { json!([fixture["adapter"]]) };
                        return parse_identity_query_output(serde_json::to_string(&response).unwrap().as_bytes());
                    }
                    match attempt {
                        0 => Err("query_failed".into()),
                        1 => { let mut row = fixture["adapter"].clone(); row["PermanentAddress"] = json!(""); Ok(row) },
                        _ => Ok(json!([{"PnPDeviceID": "SWD\\VIRTUAL", "PermanentAddress": "00E01E8F0234", "Virtual": true}])),
                    }
                });
            }).unwrap();
            assert_eq!(network_calls, success_at + 1);
            let identities = super::super::hardware_identities_v2(&data);
            assert_eq!(
                identities,
                vec![(
                    "pci_permanent_mac_v2",
                    fixture["expectedIdentity"].as_str().unwrap().into()
                )]
            );
            assert_eq!(
                data["identityDiagnostics"]["systemUuid"],
                "invalid_placeholder"
            );
            assert_eq!(
                data["identityDiagnostics"]["baseboardSerial"],
                "invalid_placeholder"
            );
            assert_eq!(data["identityDiagnostics"]["permanentPciMacCount"], 1);
            assert_eq!(data["identityDiagnostics"]["decision"], "ready");
            let upload = crate::upload::build_observation_v3("135", &data).unwrap();
            let interfaces = upload
                .pointer("/asset/hardware/network/identityInterfaces")
                .unwrap()
                .as_array()
                .unwrap();
            assert!(interfaces
                .iter()
                .any(|row| row["permanentAddress"] == "00E01E8F0234"));
            assert_eq!(
                upload.pointer("/asset/hardware/baseboard/serial").unwrap(),
                "Default string"
            );
        }
    }

    #[test]
    fn upload_light_keeps_board_facts_for_legacy_transition() {
        let data = super::super::collect_upload_data_with(|root| {
            root.insert("uuid".into(), json!({"hardware": "ca64e029-40ba-7f2c-27dd-b082e209a3d2"}));
            enrich_windows_identity_with(root, |command| {
                if command.contains("Win32_BaseBoard") {
                    Ok(json!({"Manufacturer": "ASUSTeK COMPUTER INC.", "Product": "TUF GAMING B760M-PLUS WIFI D4", "SerialNumber": "260270757501248"}))
                } else { Ok(json!([])) }
            });
        }).unwrap();
        let expected = json!({
            "uuid": {"hardware": "ca64e029-40ba-7f2c-27dd-b082e209a3d2"},
            "baseboard": {"manufacturer": "ASUSTeK COMPUTER INC.", "model": "TUF GAMING B760M-PLUS WIFI D4", "serial": "260270757501248"}
        });
        assert!(super::super::device_uuid_v1(&data).is_some());
        assert_eq!(
            super::super::device_uuid_v1(&data),
            super::super::device_uuid_v1(&expected)
        );
        assert_eq!(super::super::hardware_identities_v2(&data).len(), 2);
        assert_eq!(data["identityDiagnostics"]["decision"], "ready");
    }

    #[test]
    fn all_identity_queries_fail_with_actionable_diagnostics_and_no_upload() {
        let data = super::super::collect_upload_data_with(|root| {
            root.insert(
                "uuid".into(),
                json!({"hardware": "03000200-0400-0500-0006-000700080009"}),
            );
            root.insert("system".into(), json!({}));
            enrich_windows_identity_with(root, |_| Err("query_failed".into()));
        })
        .unwrap();
        assert_eq!(data["identityDiagnostics"]["decision"], "needs_review");
        assert_eq!(
            data["identityDiagnostics"]["probeAttempts"]
                .as_array()
                .unwrap()
                .len(),
            6
        );
        let error = crate::upload::build_observation_v3("135", &data)
            .unwrap_err()
            .to_string();
        assert!(error.contains("尚未上传"));
        assert!(error.contains("查询失败：6 项"));
        assert!(!error.contains("03000200"));
    }

    #[test]
    fn identity_json_handles_encoding_empty_and_malformed_results() {
        assert_eq!(
            parse_identity_query_output("\u{feff}{\"Name\":\"以太网\"}".as_bytes()).unwrap()
                ["Name"],
            "以太网"
        );
        for text in ["", "  ", "null", "[]"] {
            assert!(value_items(&parse_identity_query_output(text.as_bytes()).unwrap()).is_empty());
        }
        assert_eq!(
            parse_identity_query_output(&[0xff]).unwrap_err(),
            "invalid_utf8"
        );
        assert_eq!(
            parse_identity_query_output(b"{bad").unwrap_err(),
            "invalid_json"
        );
        assert_eq!(
            parse_identity_query_output(b"42").unwrap_err(),
            "unexpected_json_type"
        );
    }

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

    #[test]
    fn forces_utf8_for_windows_powershell_output() {
        let command = powershell_utf8_command("Write-Output '{\"Name\":\"以太网\"}'");
        assert!(command.starts_with(WINDOWS_POWERSHELL_UTF8_PREAMBLE));
        assert!(command.contains("$OutputEncoding = [Console]::OutputEncoding"));
        assert!(command.ends_with("Write-Output '{\"Name\":\"以太网\"}'"));
    }

    #[test]
    fn normalizes_windows_monitor_edid_arrays_and_current_mode() {
        let monitors = json!([{
            "InstanceName": "DISPLAY\\DEL40A9\\5&123&0&UID4352_0",
            "Active": true,
            "ManufacturerName": [68, 69, 76, 0, 0],
            "UserFriendlyName": [68, 69, 76, 76, 32, 85, 50, 52, 49, 53, 0],
            "SerialNumberID": [65, 66, 67, 49, 50, 51, 0],
            "YearOfManufacture": 2024,
            "WeekOfManufacture": 18
        }]);
        let controllers = json!({
            "Name": "Intel(R) UHD Graphics",
            "CurrentHorizontalResolution": 1920,
            "CurrentVerticalResolution": 1080,
            "CurrentRefreshRate": 60
        });

        let desktop_monitors = json!({
            "PNPDeviceID": "DISPLAY\\DEL40A9\\5&123&0&UID4352",
            "Name": "Dell U2415",
            "ScreenWidth": 2560,
            "ScreenHeight": 1440,
            "Status": "OK"
        });
        let displays = normalize_windows_displays(&monitors, &desktop_monitors, &controllers);
        assert_eq!(displays.pointer("/0/model"), Some(&json!("DELL U2415")));
        assert_eq!(displays.pointer("/0/vendor"), Some(&json!("DEL")));
        assert_eq!(displays.pointer("/0/serial"), Some(&json!("ABC123")));
        assert_eq!(displays.pointer("/0/currentResX"), Some(&json!(2560)));
        assert_eq!(displays.pointer("/0/currentRefreshRate"), Some(&json!(60)));
    }

    #[test]
    fn tolerates_empty_monitor_fields_and_multiple_displays() {
        let monitors = json!([
            {
                "InstanceName": "DISPLAY\\VIRTUAL\\1",
                "Active": false,
                "ManufacturerName": [],
                "UserFriendlyName": null,
                "SerialNumberID": [0]
            },
            {
                "InstanceName": "DISPLAY\\GSM1234\\2",
                "Active": true,
                "ManufacturerName": "GSM",
                "UserFriendlyName": "LG HDR 4K",
                "SerialNumberID": "SERIAL-2"
            }
        ]);

        let desktops = json!([{
            "PNPDeviceID": "DISPLAY\\GSM1234\\2",
            "ScreenWidth": 3840,
            "ScreenHeight": 2160,
            "Status": "OK"
        }]);
        let displays = normalize_windows_displays(&monitors, &desktops, &json!([]));
        assert_eq!(displays.as_array().map(Vec::len), Some(2));
        assert_eq!(displays.pointer("/0/model"), Some(&json!("")));
        assert_eq!(displays.pointer("/1/model"), Some(&json!("LG HDR 4K")));
        assert_eq!(displays.pointer("/0/currentResX"), Some(&json!(0)));
        assert_eq!(displays.pointer("/1/currentResX"), Some(&json!(3840)));
    }

    #[test]
    fn normalizes_windows_chassis_for_admin_contract() {
        let chassis = normalize_windows_chassis(&json!({
            "Manufacturer": "Dell Inc.",
            "SerialNumber": "CHASSIS-123",
            "ChassisTypes": [3]
        }));

        assert_eq!(chassis.get("manufacturer"), Some(&json!("Dell Inc.")));
        assert_eq!(chassis.get("model"), Some(&json!("Desktop")));
        assert_eq!(chassis.get("serial"), Some(&json!("CHASSIS-123")));

        let scalar = normalize_windows_chassis(&json!({
            "Manufacturer": "OEM",
            "SerialNumber": "ONE",
            "ChassisTypes": 10
        }));
        assert_eq!(scalar.get("model"), Some(&json!("Notebook")));
    }

    #[test]
    fn normalizes_windows_physical_disk_inventory() {
        let disks = normalize_windows_physical_disks(&json!([{
            "Model": "Samsung SSD 980 PRO 1TB",
            "SerialNumber": "SSD-SERIAL",
            "Size": "1000204886016",
            "MediaType": "Fixed hard disk media",
            "InterfaceType": "SCSI",
            "DeviceID": "\\\\.\\PHYSICALDRIVE0",
            "FirmwareRevision": "5B2QGXA7"
        }]));

        assert_eq!(
            disks.pointer("/0/model"),
            Some(&json!("Samsung SSD 980 PRO 1TB"))
        );
        assert_eq!(disks.pointer("/0/serialNum"), Some(&json!("SSD-SERIAL")));
        assert_eq!(
            disks.pointer("/0/size"),
            Some(&json!(1_000_204_886_016_u64))
        );
        assert_eq!(disks.pointer("/0/type"), Some(&json!("SSD")));
    }

    #[test]
    fn normalizes_macos_nvme_physical_disk_inventory() {
        let source = json!({
            "SPNVMeDataType": [{
                "_name": "Apple SSD Controller",
                "_items": [{
                    "_name": "APPLE SSD AP0512Z",
                    "device_model": "APPLE SSD AP0512Z",
                    "device_serial": "MAC-DISK-SERIAL",
                    "size": "500.28 GB (500,277,790,720 bytes)",
                    "bsd_name": "disk0",
                    "physical_drive": { "medium_type": "Solid State" }
                }]
            }]
        });

        let disks = normalize_macos_physical_disks(&source);
        assert_eq!(disks.pointer("/0/model"), Some(&json!("APPLE SSD AP0512Z")));
        assert_eq!(
            disks.pointer("/0/serialNum"),
            Some(&json!("MAC-DISK-SERIAL"))
        );
        assert_eq!(disks.pointer("/0/size"), Some(&json!(500_277_790_720_u64)));
        assert_eq!(disks.pointer("/0/interfaceType"), Some(&json!("NVMe")));
    }

    #[test]
    fn enriches_windows_network_with_real_gateway_dns_and_dhcp() {
        let mut root = Map::new();
        root.insert(
            "net".to_string(),
            json!([
                { "iface": "Ethernet", "default": true },
                { "iface": "Wi-Fi", "default": false }
            ]),
        );
        let configuration = json!([
            {
                "InterfaceAlias": "Ethernet",
                "IPv4DefaultGateway": null,
                "DnsServers": ["192.168.1.1"],
                "Dhcp": "Disabled"
            },
            {
                "InterfaceAlias": "Wi-Fi",
                "IPv4DefaultGateway": "192.168.1.1",
                "DnsServers": ["192.168.1.1", "1.1.1.1"],
                "Dhcp": "Enabled"
            }
        ]);

        enrich_windows_network_configuration(&mut root, &configuration);
        let result = Value::Object(root);
        assert_eq!(result.pointer("/net/0/default"), Some(&json!(false)));
        assert_eq!(result.pointer("/net/1/default"), Some(&json!(true)));
        assert_eq!(
            result.pointer("/net/1/defaultGateway"),
            Some(&json!("192.168.1.1"))
        );
        assert_eq!(
            result.pointer("/net/1/dnsServers/1"),
            Some(&json!("1.1.1.1"))
        );
        assert_eq!(result.pointer("/net/1/dhcp"), Some(&json!(true)));
    }

    #[test]
    fn parses_macos_default_route_and_dns() {
        let route =
            "route to: default\ndestination: default\ngateway: 192.168.6.1\ninterface: en0\n";
        assert_eq!(
            parse_macos_default_route(route),
            Some(("en0".to_string(), "192.168.6.1".to_string()))
        );
        let dns = "resolver #1\n  nameserver[0] : 192.168.6.1\n  nameserver[1] : 1.1.1.1\nresolver #2\n  nameserver[0] : 192.168.6.1\n";
        assert_eq!(
            parse_macos_dns_servers(dns),
            vec!["192.168.6.1".to_string(), "1.1.1.1".to_string()]
        );
    }

    #[test]
    fn normalizes_windows_battery_health_when_capacity_is_available() {
        let batteries = normalize_windows_batteries(&json!({
            "Name": "Internal Battery",
            "DeviceID": "BAT0",
            "Status": "OK",
            "DesignCapacity": 50000,
            "FullChargeCapacity": 42500,
            "EstimatedChargeRemaining": 73,
            "DesignVoltage": 11400
        }));
        assert_eq!(batteries.pointer("/0/healthPercent"), Some(&json!(85)));
        assert_eq!(batteries.pointer("/0/chargePercent"), Some(&json!(73)));
    }

    #[test]
    fn enriches_windows_cpu_static_frequencies_and_core_counts() {
        let mut root = Map::new();
        root.insert("cpu".to_string(), json!({ "brand": "Example CPU" }));
        enrich_windows_cpu(
            &mut root,
            &json!([{
                "CurrentClockSpeed": 2800,
                "MaxClockSpeed": 4600,
                "NumberOfCores": 8,
                "NumberOfLogicalProcessors": 16
            }]),
        );
        let result = Value::Object(root);
        assert_eq!(result.pointer("/cpu/frequency"), Some(&json!(2800)));
        assert_eq!(result.pointer("/cpu/maxFrequency"), Some(&json!(4600)));
        assert_eq!(result.pointer("/cpu/physicalCores"), Some(&json!(8)));
        assert_eq!(result.pointer("/cpu/cores"), Some(&json!(16)));
    }

    #[test]
    fn normalizes_macos_battery_health() {
        let batteries = normalize_macos_batteries(&json!({
            "SPPowerDataType": [{
                "sppower_battery_model_info": {
                    "sppower_device_name": "InternalBattery-0",
                    "sppower_battery_serial_number": "BAT-SERIAL"
                },
                "sppower_battery_health_info": {
                    "sppower_battery_cycle_count": "128",
                    "sppower_battery_health": "Good",
                    "sppower_battery_health_maximum_capacity": "91%"
                },
                "sppower_battery_charge_info": {
                    "sppower_battery_state_of_charge": "76%",
                    "sppower_battery_is_charging": "spbattery_no"
                }
            }]
        }));
        assert_eq!(batteries.pointer("/0/cycleCount"), Some(&json!(128)));
        assert_eq!(batteries.pointer("/0/healthPercent"), Some(&json!(91)));
        assert_eq!(batteries.pointer("/0/charging"), Some(&json!(false)));
    }
}
