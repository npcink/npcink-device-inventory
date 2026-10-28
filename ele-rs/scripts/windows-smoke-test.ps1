[CmdletBinding()]
param(
    [string]$Site = $env:NPCINK_SMOKE_SITE,
    [string]$Token = $env:NPCINK_SMOKE_TOKEN,
    [string]$Note = "Windows smoke test",
    [switch]$SkipBuild,
    [switch]$SkipCargoTest,
    [switch]$SkipSubmit,
    [switch]$SkipDiagnostics,
    [switch]$OpenDev,
    [ValidateRange(10, 3600)][int]$CommandTimeoutSeconds = 120,
    [ValidateRange(60, 3600)][int]$BuildTimeoutSeconds = 1200,
    [ValidateRange(5, 300)][int]$ProbeTimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-smoke-functions.ps1")

function New-StepResult {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Log,
        [int]$ExitCode = 0,
        [string]$Message = "",
        [hashtable]$Metrics = @{}
    )

    [ordered]@{
        name = $Name
        status = $Status
        exit_code = $ExitCode
        log = $Log
        message = $Message
        metrics = $Metrics
    }
}

function Invoke-LoggedCommand {
    param(
        [string]$Name,
        [string]$LogName,
        [string]$FilePath,
        [string[]]$Arguments,
        [switch]$AllowFailure,
        [int]$TimeoutSeconds = $BuildTimeoutSeconds
    )

    $logPath = Join-Path $script:ReportDir $LogName
    $result = Invoke-SmokeCommand -FilePath $FilePath -Arguments $Arguments -StdoutPath $logPath -StderrPath "$logPath.stderr.txt" -TimeoutSeconds $TimeoutSeconds
    $exitCode = $result.exit_code

    if ($exitCode -ne 0 -and -not $AllowFailure) {
        $script:Steps.Add((New-StepResult -Name $Name -Status "failed" -ExitCode $exitCode -Log $logPath -Message $result.failure))
        throw "$Name failed with exit code $exitCode. See $logPath"
    }

    $status = if ($exitCode -eq 0) { "passed" } else { "failed_allowed" }
    $script:Steps.Add((New-StepResult -Name $Name -Status $status -ExitCode $exitCode -Log $logPath))
}

function Invoke-CargoJson {
    param(
        [string]$Name,
        [string[]]$Arguments,
        [string]$JsonName
    )

    $jsonPath = Join-Path $script:ReportDir $JsonName
    $stderrPath = Join-Path $script:ReportDir "$JsonName.stderr.txt"
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $metrics = @{}
    $result = Invoke-SmokeCommand -FilePath "cargo" -Arguments $Arguments -StdoutPath $jsonPath -StderrPath $stderrPath -TimeoutSeconds $CommandTimeoutSeconds
    $exitCode = $result.exit_code
    if ($exitCode -ne 0) {
        $script:Steps.Add((New-StepResult -Name $Name -Status "failed" -ExitCode $exitCode -Log $stderrPath -Message $result.failure))
        throw "$Name failed with exit code $exitCode. See $stderrPath"
    }

    try {
        $payload = Get-Content -Raw -Encoding UTF8 -Path $jsonPath | ConvertFrom-Json
        if ($Name -in @("hardware.inspect", "hardware.upload-inspect")) {
            if ($payload.os.platform -ne "windows" -or $payload.cpu.cores -lt 1 -or $payload.mem.total -le 0) {
                throw "Missing Windows platform, CPU or memory data"
            }
            if ($payload.identityDiagnostics.decision -ne "ready" -or @($payload.identityDiagnostics.identityTypes).Count -eq 0) {
                throw "No usable v2 hardware identity"
            }
            if ($Name -eq "hardware.upload-inspect" -and $payload.collector.schema -ne "npcink-hardware-inventory-v3") {
                throw "Unexpected hardware inventory schema"
            }
            if ($Name -eq "hardware.upload-inspect") {
                $timing = Get-Content -Raw -Encoding UTF8 -Path $stderrPath
                $metrics = Get-SmokeInventoryMetrics -Stderr $timing
                $metrics.command_wall_elapsed_ms = $watch.ElapsedMilliseconds
                $metrics.hardware_query_status_counts = @{}
                foreach ($group in @($payload.hardwareProbeAttempts | Group-Object status)) {
                    $metrics.hardware_query_status_counts[$group.Name] = $group.Count
                }
            }
        } elseif ($Name -eq "runtime.monitor") {
            if ($payload.cpu.cores -lt 1 -or $payload.memory.total -le 0 -or [string]::IsNullOrWhiteSpace($payload.collected_at)) {
                throw "Missing runtime CPU, memory or collection time"
            }
        }
    } catch {
        $script:Steps.Add((New-StepResult -Name $Name -Status "failed" -ExitCode 0 -Log $jsonPath -Message $_.Exception.Message))
        throw "$Name output failed JSON or collection validation. See $jsonPath"
    }

    $script:Steps.Add((New-StepResult -Name $Name -Status "passed" -Log $jsonPath -Metrics $metrics))
}

function Invoke-Probe {
    param(
        [string]$Name,
        [string]$Command,
        [string]$OutputName
    )

    $probePath = Join-Path $script:DiagnosticsDir $OutputName
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding(`$false); `$OutputEncoding=[Console]::OutputEncoding; " + $Command))
    $result = Invoke-SmokeCommand -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded) -StdoutPath $probePath -StderrPath "$probePath.stderr.txt" -TimeoutSeconds $ProbeTimeoutSeconds
    $exitCode = $result.exit_code
    $status = if ($exitCode -eq 0) { "passed" } else { "failed_allowed" }
    $script:Steps.Add((New-StepResult -Name "diagnostics.$Name" -Status $status -ExitCode $exitCode -Log $probePath -Message $result.failure))
}

function Write-WinDbgInstallHint {
    $hintPath = Join-Path $script:DiagnosticsDir "windbg-install-hint.txt"
    $cdb = Get-Command cdb.exe -ErrorAction SilentlyContinue
    $windbgx = Get-Command windbgx.exe -ErrorAction SilentlyContinue

    if ($cdb) {
        "Detected cdb.exe: $($cdb.Source)" | Out-File -FilePath $hintPath -Encoding utf8
        $script:Steps.Add((New-StepResult -Name "diagnostics.windbg-hint" -Status "passed" -Log $hintPath))
        return
    }

    if ($windbgx) {
        "Detected windbgx.exe: $($windbgx.Source)" | Out-File -FilePath $hintPath -Encoding utf8
        $script:Steps.Add((New-StepResult -Name "diagnostics.windbg-hint" -Status "passed" -Log $hintPath))
        return
    }

    @"
No debugger was detected.

Install Microsoft WinDbg to enable automatic minidump analysis:
  winget install --id Microsoft.WinDbg -e

After installing, rerun this smoke test or regenerate the app diagnostics package.
"@ | Out-File -FilePath $hintPath -Encoding utf8
    $script:Steps.Add((New-StepResult -Name "diagnostics.windbg-hint" -Status "info" -Log $hintPath))
}

function Assert-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name"
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$eleRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $eleRoot

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$script:ReportDir = Join-Path $eleRoot "smoke-reports\windows-$stamp"
$script:DiagnosticsDir = Join-Path $script:ReportDir "windows-diagnostics-probes"
New-Item -ItemType Directory -Force -Path $script:DiagnosticsDir | Out-Null

$script:Steps = New-Object System.Collections.Generic.List[object]

$summary = [ordered]@{
    schema = "npcink-windows-smoke-report-v2"
    scope = "source-cli-smoke"
    generated_at = (Get-Date).ToString("o")
    root = $eleRoot.ToString()
    platform = [ordered]@{
        ps_edition = $PSVersionTable.PSEdition
        ps_version = $PSVersionTable.PSVersion.ToString()
        os = [System.Environment]::OSVersion.VersionString
        is_windows = $IsWindows -or $env:OS -eq "Windows_NT"
        is_admin = if ($env:OS -eq "Windows_NT") { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } else { $false }
    }
    inputs = [ordered]@{
        site_present = -not [string]::IsNullOrWhiteSpace($Site)
        token_present = -not [string]::IsNullOrWhiteSpace($Token)
        note = $Note
        skip_build = [bool]$SkipBuild
        skip_cargo_test = [bool]$SkipCargoTest
        skip_diagnostics = [bool]$SkipDiagnostics
        skip_submit = [bool]$SkipSubmit
        open_dev = [bool]$OpenDev
    }
}

try {
    if (-not $summary.platform.is_windows) {
        throw "This smoke test must run on Windows to exercise Windows hardware, runtime, and diagnostics paths."
    }

    Assert-Command "node"
    Assert-Command "cargo"
    if (-not $SkipSubmit -and ([string]::IsNullOrWhiteSpace($Site) -or [string]::IsNullOrWhiteSpace($Token))) {
        throw "Upload requires both -Site and -Token. Use -SkipSubmit explicitly for collection-only smoke."
    }
    if (-not $SkipSubmit -and ([uri]$Site).Scheme -ne "https") {
        throw "Use an isolated HTTPS acceptance site for upload."
    }
    Assert-Command "npm"
    Assert-Command "powershell.exe"

    if (-not $SkipBuild) {
        Invoke-LoggedCommand -Name "frontend.build" -LogName "npm-build.log" -FilePath "npm" -Arguments @("run", "build")
        Invoke-LoggedCommand -Name "collector.build" -LogName "cargo-build.log" -FilePath "cargo" -Arguments @("build", "--locked")
    } else {
        $script:Steps.Add((New-StepResult -Name "frontend.build" -Status "skipped" -Log ""))
        $script:Steps.Add((New-StepResult -Name "collector.build" -Status "skipped" -Log ""))
    }

    if (-not $SkipCargoTest) {
        Invoke-LoggedCommand -Name "cargo.test" -LogName "cargo-test.log" -FilePath "cargo" -Arguments @("test", "--locked")
    } else {
        $script:Steps.Add((New-StepResult -Name "cargo.test" -Status "skipped" -Log ""))
    }

    Invoke-CargoJson -Name "hardware.inspect" -Arguments @("run", "--locked", "--quiet", "--", "inspect", "--pretty") -JsonName "inspect.json"
    Invoke-CargoJson -Name "hardware.upload-inspect" -Arguments @("run", "--locked", "--quiet", "--", "upload-inspect", "--pretty") -JsonName "upload-inspect.json"
    Invoke-CargoJson -Name "runtime.monitor" -Arguments @("run", "--locked", "--quiet", "--", "runtime", "--pretty") -JsonName "runtime.json"

    $deviceIdPath = Join-Path $script:ReportDir "device-id.txt"
    $deviceIdErrPath = Join-Path $script:ReportDir "device-id.stderr.txt"
    $deviceIdResult = Invoke-SmokeCommand -FilePath "cargo" -Arguments @("run", "--locked", "--quiet", "--", "device-id") -StdoutPath $deviceIdPath -StderrPath $deviceIdErrPath -TimeoutSeconds $CommandTimeoutSeconds
    $deviceIdExit = $deviceIdResult.exit_code
    $deviceId = if (Test-Path $deviceIdPath) { (Get-Content -Raw -Encoding UTF8 -Path $deviceIdPath).Trim() } else { "" }
    if ($deviceIdExit -ne 0 -or $deviceId -notmatch "^(system|board|pci)-v2-[0-9a-f]{29}$") {
        $script:Steps.Add((New-StepResult -Name "device-id" -Status "failed" -ExitCode $deviceIdExit -Log $deviceIdPath -Message "Device identity missing or invalid"))
        throw "Device identity check failed. See $deviceIdPath and $deviceIdErrPath"
    }
    $script:Steps.Add((New-StepResult -Name "device-id" -Status "passed" -Log $deviceIdPath))

    if (-not $SkipSubmit -and -not [string]::IsNullOrWhiteSpace($Site) -and -not [string]::IsNullOrWhiteSpace($Token)) {
        $submitJson = Join-Path $script:ReportDir "submit-response.json"
        $submitErr = Join-Path $script:ReportDir "submit.stderr.txt"
        $submitResult = Invoke-SmokeCommand -FilePath "cargo" -Arguments @("run", "--locked", "--quiet", "--", "submit", "--site", $Site, "--token", $Token, "--note", $Note) -StdoutPath $submitJson -StderrPath $submitErr -TimeoutSeconds $CommandTimeoutSeconds
        $submitExit = $submitResult.exit_code
        if ($submitExit -ne 0) {
            $script:Steps.Add((New-StepResult -Name "upload.submit" -Status "failed" -ExitCode $submitExit -Log $submitErr))
            throw "Upload submit failed. See $submitErr"
        }
        $script:Steps.Add((New-StepResult -Name "upload.submit" -Status "passed" -Log $submitJson))
    } else {
        $script:Steps.Add((New-StepResult -Name "upload.submit" -Status "skipped" -Log "" -Message "Upload explicitly skipped; this report does not verify upload."))
    }

    if ($SkipDiagnostics) {
        $script:Steps.Add((New-StepResult -Name "diagnostics.probes" -Status "skipped" -Log ""))
    } else {
        Invoke-Probe -Name "system-events" -OutputName "system-relevant-events.txt" -Command "Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=(Get-Date).AddDays(-14); Id=41,1001,6008,6005,6006,1074,7,11,15,51,55,57,129,153,157,161,17,18,19,219,7000,7001,7009,7011,7022,7023,7024,7031,7034} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,MachineName,Message | Format-List"
        Invoke-Probe -Name "system-events-csv" -OutputName "system-relevant-events.csv" -Command "Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=(Get-Date).AddDays(-14); Id=41,1001,6008,6005,6006,1074,7,11,15,51,55,57,129,153,157,161,17,18,19,46,47,219,7000,7001,7009,7011,7022,7023,7024,7031,7034} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,MachineName,Message | ConvertTo-Csv -NoTypeInformation"
        Invoke-Probe -Name "application-crashes" -OutputName "application-crash-events.txt" -Command "Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddDays(-14); Id=1000,1001,1002,1005,1026} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,MachineName,Message | Format-List"
        Invoke-Probe -Name "setup-events" -OutputName "setup-events.csv" -Command "Get-WinEvent -FilterHashtable @{LogName='Setup'; StartTime=(Get-Date).AddDays(-14)} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,Message | ConvertTo-Csv -NoTypeInformation"
        Invoke-Probe -Name "windows-update-events" -OutputName "windows-update-events.csv" -Command "Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-WindowsUpdateClient/Operational'; StartTime=(Get-Date).AddDays(-14)} -ErrorAction SilentlyContinue | Sort-Object TimeCreated -Descending | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,Message | ConvertTo-Csv -NoTypeInformation"
        Invoke-Probe -Name "reliability-records" -OutputName "reliability-records.txt" -Command "Get-CimInstance -ClassName Win32_ReliabilityRecords -ErrorAction SilentlyContinue | Where-Object { `$_.TimeGenerated -ge (Get-Date).AddDays(-14) } | Select-Object TimeGenerated,SourceName,EventIdentifier,ProductName,Message | Format-List"
        Invoke-Probe -Name "hardware-info" -OutputName "hardware-info.txt" -Command "`$classes='Win32_BIOS','Win32_BaseBoard','Win32_SystemEnclosure','Win32_Processor','Win32_PhysicalMemory','Win32_VideoController','Win32_DesktopMonitor','Win32_DiskDrive','Win32_Battery'; foreach (`$class in `$classes) { `"===== `$class =====`"; Get-CimInstance -ClassName `$class -ErrorAction SilentlyContinue | Format-List * }; `"===== root\wmi:WmiMonitorID =====`"; Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue | Select-Object InstanceName,Active,ManufacturerName,UserFriendlyName,SerialNumberID,YearOfManufacture,WeekOfManufacture | Format-List *"
        Invoke-Probe -Name "driverquery" -OutputName "driverquery.csv" -Command "driverquery /v /fo csv"
        Invoke-Probe -Name "pnputil" -OutputName "pnputil-enum-drivers.txt" -Command "pnputil /enum-drivers"
        Invoke-Probe -Name "problem-devices" -OutputName "problem-devices.txt" -Command "Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { `$_.Status -ne 'OK' -or `$_.ConfigManagerErrorCode -ne 0 } | Format-List *"
        Invoke-Probe -Name "storage-reliability" -OutputName "storage-reliability.txt" -Command "Get-PhysicalDisk -ErrorAction SilentlyContinue | Format-List *; Get-PhysicalDisk -ErrorAction SilentlyContinue | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue | Format-List *; Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue | Format-List *"
        Invoke-Probe -Name "wmic-diskdrive" -OutputName "wmic-diskdrive-status.txt" -Command "`$wmic=Get-Command wmic.exe -ErrorAction SilentlyContinue; if (`$wmic) { & `$wmic.Source diskdrive get model,serialnumber,status,size,interfacetype /format:list } else { 'wmic.exe is not available on this Windows installation.' }"
        Invoke-Probe -Name "powercfg" -OutputName "powercfg.txt" -Command "powercfg /a; powercfg /lastwake; powercfg /waketimers"
        Invoke-Probe -Name "debugger-presence" -OutputName "debugger-presence.txt" -Command "`$cdb=Get-Command cdb.exe -ErrorAction SilentlyContinue; `$windbgx=Get-Command windbgx.exe -ErrorAction SilentlyContinue; if (`$cdb) { `"cdb.exe: `$(`$cdb.Source)`" } elseif (`$windbgx) { `"windbgx.exe: `$(`$windbgx.Source)`" } else { 'No debugger detected.' }"
        Write-WinDbgInstallHint
    }

    if ($OpenDev) {
        $script:Steps.Add((New-StepResult -Name "tauri.dev" -Status "manual" -Log "" -Message "Starting npm run tauri:dev; close the app window to finish."))
        Invoke-LoggedCommand -Name "tauri.dev.process" -LogName "tauri-dev.log" -FilePath "npm" -Arguments @("run", "tauri:dev") -TimeoutSeconds $BuildTimeoutSeconds
    }

    $summary.status = "completed"
} catch {
    $summary.status = "failed"
    $summary.error = $_.Exception.Message
} finally {
    $summary.steps = $script:Steps
    $summary.coverage = Get-SmokeCoverage -Steps $script:Steps.ToArray()
    $reportPath = Join-Path $script:ReportDir "windows-smoke-report.json"
    $summary | ConvertTo-Json -Depth 8 | Out-File -FilePath $reportPath -Encoding utf8

    Write-Host ""
    Write-Host "Windows smoke report: $reportPath"
    Write-Host "Status: $($summary.status)"
    if ($summary.status -eq "failed") {
        exit 1
    }
}
