[CmdletBinding()]
param(
    [string]$AssetNumber = "",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$script:ProbeErrors = @()

trap {
    $lineNumber = $_.InvocationInfo.ScriptLineNumber
    $sourceLine = $_.InvocationInfo.Line
    Write-Host "Probe failed at script line $lineNumber."
    if (-not [string]::IsNullOrWhiteSpace($sourceLine)) {
        Write-Host ($sourceLine.Trim())
    }
    Write-Host $_.Exception.Message
    exit 1
}

function Add-ProbeError {
    param(
        [string]$Source,
        [string]$Message
    )

    $script:ProbeErrors += [pscustomobject][ordered]@{
        source = $Source
        message = $Message
    }
}

function Get-ObjectProperty {
    param(
        [object]$InputObject,
        [string]$Name
    )

    if ($null -eq $InputObject) {
        return $null
    }

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Get-CimRows {
    param(
        [string]$ClassName,
        [string]$Namespace = "root/cimv2"
    )

    try {
        return @(Get-CimInstance -Namespace $Namespace -ClassName $ClassName -ErrorAction Stop)
    } catch {
        Add-ProbeError -Source "$Namespace/$ClassName" -Message $_.Exception.Message
        return @()
    }
}

function Convert-SystemProduct {
    param([object]$Row)

    if ($null -eq $Row) {
        return [ordered]@{}
    }

    return [ordered]@{
        uuid = Get-ObjectProperty $Row "UUID"
        vendor = Get-ObjectProperty $Row "Vendor"
        name = Get-ObjectProperty $Row "Name"
        version = Get-ObjectProperty $Row "Version"
        identifyingNumber = Get-ObjectProperty $Row "IdentifyingNumber"
    }
}

function Convert-Baseboard {
    param([object]$Row)

    if ($null -eq $Row) {
        return [ordered]@{}
    }

    return [ordered]@{
        manufacturer = Get-ObjectProperty $Row "Manufacturer"
        product = Get-ObjectProperty $Row "Product"
        version = Get-ObjectProperty $Row "Version"
        serialNumber = Get-ObjectProperty $Row "SerialNumber"
    }
}

function Convert-Processor {
    param([object]$Row)

    return [ordered]@{
        name = Get-ObjectProperty $Row "Name"
        manufacturer = Get-ObjectProperty $Row "Manufacturer"
        processorId = Get-ObjectProperty $Row "ProcessorId"
        uniqueId = Get-ObjectProperty $Row "UniqueId"
        serialNumber = Get-ObjectProperty $Row "SerialNumber"
        socketDesignation = Get-ObjectProperty $Row "SocketDesignation"
        numberOfCores = Get-ObjectProperty $Row "NumberOfCores"
        numberOfLogicalProcessors = Get-ObjectProperty $Row "NumberOfLogicalProcessors"
    }
}

function Convert-NetworkAdapter {
    param(
        [object]$Row,
        [string]$Source
    )

    return [ordered]@{
        source = $Source
        name = Get-ObjectProperty $Row "Name"
        interfaceDescription = Get-ObjectProperty $Row "InterfaceDescription"
        interfaceIndex = Get-ObjectProperty $Row "InterfaceIndex"
        interfaceGuid = Get-ObjectProperty $Row "InterfaceGuid"
        pnpDeviceId = Get-ObjectProperty $Row "PnPDeviceID"
        macAddress = Get-ObjectProperty $Row "MacAddress"
        permanentAddress = Get-ObjectProperty $Row "PermanentAddress"
        status = Get-ObjectProperty $Row "Status"
        connectorPresent = Get-ObjectProperty $Row "ConnectorPresent"
        notUserRemovable = Get-ObjectProperty $Row "NotUserRemovable"
        hardwareInterface = Get-ObjectProperty $Row "HardwareInterface"
        virtual = Get-ObjectProperty $Row "Virtual"
    }
}

function Get-PhysicalNetworkAdapters {
    $command = Get-Command "Get-NetAdapter" -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        try {
            return @(
                Get-NetAdapter -Name "*" -Physical -IncludeHidden -ErrorAction Stop |
                    Where-Object { (Get-ObjectProperty $_ "Virtual") -ne $true } |
                    ForEach-Object { Convert-NetworkAdapter -Row $_ -Source "Get-NetAdapter" }
            )
        } catch {
            Add-ProbeError -Source "Get-NetAdapter" -Message $_.Exception.Message
        }
    } else {
        Add-ProbeError -Source "Get-NetAdapter" -Message "Command is not available on this Windows installation."
    }

    $fallbackRows = Get-CimRows -ClassName "Win32_NetworkAdapter"
    return @(
        $fallbackRows |
            Where-Object { (Get-ObjectProperty $_ "PhysicalAdapter") -eq $true } |
            ForEach-Object {
                [ordered]@{
                    source = "Win32_NetworkAdapter"
                    name = Get-ObjectProperty $_ "Name"
                    interfaceDescription = Get-ObjectProperty $_ "Description"
                    interfaceIndex = Get-ObjectProperty $_ "InterfaceIndex"
                    interfaceGuid = Get-ObjectProperty $_ "GUID"
                    pnpDeviceId = Get-ObjectProperty $_ "PNPDeviceID"
                    macAddress = Get-ObjectProperty $_ "MACAddress"
                    permanentAddress = $null
                    status = Get-ObjectProperty $_ "NetConnectionStatus"
                    connectorPresent = $null
                    notUserRemovable = $null
                    hardwareInterface = $true
                    virtual = $false
                }
            }
    )
}

function Get-NetworkHardwareInfo {
    $command = Get-Command "Get-NetAdapterHardwareInfo" -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        Add-ProbeError -Source "Get-NetAdapterHardwareInfo" -Message "Command is not available on this Windows installation."
        return @()
    }

    try {
        return @(
            Get-NetAdapterHardwareInfo -Name "*" -IncludeHidden -ErrorAction Stop |
                ForEach-Object {
                    [ordered]@{
                        name = Get-ObjectProperty $_ "Name"
                        interfaceDescription = Get-ObjectProperty $_ "InterfaceDescription"
                        locationInformationString = Get-ObjectProperty $_ "LocationInformationString"
                        segmentNumber = Get-ObjectProperty $_ "SegmentNumber"
                        busNumber = Get-ObjectProperty $_ "BusNumber"
                        deviceNumber = Get-ObjectProperty $_ "DeviceNumber"
                        functionNumber = Get-ObjectProperty $_ "FunctionNumber"
                        slotNumber = Get-ObjectProperty $_ "SlotNumber"
                    }
                }
        )
    } catch {
        Add-ProbeError -Source "Get-NetAdapterHardwareInfo" -Message $_.Exception.Message
        return @()
    }
}

function Get-TpmStatus {
    $command = Get-Command "Get-Tpm" -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return [ordered]@{
            commandAvailable = $false
            present = $null
            ready = $null
            enabled = $null
            activated = $null
            owned = $null
        }
    }

    try {
        $tpm = Get-Tpm -ErrorAction Stop
        return [ordered]@{
            commandAvailable = $true
            present = Get-ObjectProperty $tpm "TpmPresent"
            ready = Get-ObjectProperty $tpm "TpmReady"
            enabled = Get-ObjectProperty $tpm "TpmEnabled"
            activated = Get-ObjectProperty $tpm "TpmActivated"
            owned = Get-ObjectProperty $tpm "TpmOwned"
        }
    } catch {
        Add-ProbeError -Source "Get-Tpm" -Message $_.Exception.Message
        return [ordered]@{
            commandAvailable = $true
            present = $null
            ready = $null
            enabled = $null
            activated = $null
            owned = $null
        }
    }
}

$systemProductRows = Get-CimRows -ClassName "Win32_ComputerSystemProduct"
$baseboardRows = Get-CimRows -ClassName "Win32_BaseBoard"
$processorRows = Get-CimRows -ClassName "Win32_Processor"

$payload = [ordered]@{
    schema = "npcink-windows-hardware-identity-probe-v1"
    assetNumber = $AssetNumber.Trim()
    collectedAt = (Get-Date).ToUniversalTime().ToString("o")
    platform = [ordered]@{
        os = [System.Environment]::OSVersion.VersionString
        architecture = $env:PROCESSOR_ARCHITECTURE
        powershellVersion = $PSVersionTable.PSVersion.ToString()
    }
    systemProduct = Convert-SystemProduct -Row ($systemProductRows | Select-Object -First 1)
    baseboard = Convert-Baseboard -Row ($baseboardRows | Select-Object -First 1)
    processors = @($processorRows | ForEach-Object { Convert-Processor -Row $_ })
    physicalNetworkAdapters = @(Get-PhysicalNetworkAdapters)
    networkHardware = @(Get-NetworkHardwareInfo)
    tpm = Get-TpmStatus
    errors = $script:ProbeErrors
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $defaultDirectory = [Environment]::GetFolderPath("Desktop")
    if ([string]::IsNullOrWhiteSpace($defaultDirectory)) {
        $defaultDirectory = (Get-Location).Path
    }
    $filePrefix = if ([string]::IsNullOrWhiteSpace($AssetNumber)) { "device" } else { $AssetNumber.Trim() }
    $OutputPath = Join-Path $defaultDirectory "$filePrefix-windows-hardware-identity-probe.json"
}

$resolvedOutputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutputPath
if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$payload | ConvertTo-Json -Depth 8 | Set-Content -Path $resolvedOutputPath -Encoding UTF8

Write-Host "Windows hardware identity probe written to: $resolvedOutputPath"
Write-Host "The file contains private hardware identifiers (UUID, serials, MAC, PNP/PCI and interface IDs). Review before sharing."
