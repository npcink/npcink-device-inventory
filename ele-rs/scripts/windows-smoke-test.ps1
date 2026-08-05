[CmdletBinding()]
param(
    [string]$Site = $env:NPCINK_SMOKE_SITE,
    [string]$Token = $env:NPCINK_SMOKE_TOKEN,
    [string]$Note = "Windows smoke test",
    [switch]$SkipBuild,
    [switch]$SkipCargoTest,
    [switch]$SkipSubmit,
    [switch]$OpenDev
)

$ErrorActionPreference = "Stop"

function New-StepResult {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Log,
        [int]$ExitCode = 0,
        [string]$Message = ""
    )

    [ordered]@{
        name = $Name
        status = $Status
        exit_code = $ExitCode
        log = $Log
        message = $Message
    }
}

function Invoke-LoggedCommand {
    param(
        [string]$Name,
        [string]$LogName,
        [string]$FilePath,
        [string[]]$Arguments,
        [switch]$AllowFailure
    )

    $logPath = Join-Path $script:ReportDir $LogName
    $output = & $FilePath @Arguments 2>&1
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    $output | Out-File -FilePath $logPath -Encoding utf8

    if ($exitCode -ne 0 -and -not $AllowFailure) {
        $script:Steps.Add((New-StepResult -Name $Name -Status "failed" -ExitCode $exitCode -Log $logPath))
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
    & cargo @Arguments 1> $jsonPath 2> $stderrPath
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    if ($exitCode -ne 0) {
        $script:Steps.Add((New-StepResult -Name $Name -Status "failed" -ExitCode $exitCode -Log $stderrPath))
        throw "$Name failed with exit code $exitCode. See $stderrPath"
    }

    try {
        $null = Get-Content -Raw -Path $jsonPath | ConvertFrom-Json
    } catch {
        $script:Steps.Add((New-StepResult -Name $Name -Status "failed" -ExitCode 0 -Log $jsonPath -Message "JSON parse failed"))
        throw "$Name output was not valid JSON. See $jsonPath"
    }

    $script:Steps.Add((New-StepResult -Name $Name -Status "passed" -Log $jsonPath))
}

function Invoke-Probe {
    param(
        [string]$Name,
        [string]$Command,
        [string]$OutputName
    )

    $probePath = Join-Path $script:DiagnosticsDir $OutputName
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $Command 2>&1
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    $output | Out-File -FilePath $probePath -Encoding utf8
    $status = if ($exitCode -eq 0) { "passed" } else { "failed_allowed" }
    $script:Steps.Add((New-StepResult -Name "diagnostics.$Name" -Status $status -ExitCode $exitCode -Log $probePath))
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
    schema = "npcink-windows-smoke-report-v1"
    generated_at = (Get-Date).ToString("o")
    root = $eleRoot.ToString()
    platform = [ordered]@{
        ps_edition = $PSVersionTable.PSEdition
        ps_version = $PSVersionTable.PSVersion.ToString()
        os = [System.Environment]::OSVersion.VersionString
        is_windows = $IsWindows -or $env:OS -eq "Windows_NT"
    }
    inputs = [ordered]@{
        site_present = -not [string]::IsNullOrWhiteSpace($Site)
        token_present = -not [string]::IsNullOrWhiteSpace($Token)
        note = $Note
        skip_build = [bool]$SkipBuild
        skip_cargo_test = [bool]$SkipCargoTest
        skip_submit = [bool]$SkipSubmit
        open_dev = [bool]$OpenDev
    }
}

try {
    if (-not $summary.platform.is_windows) {
        throw "This smoke test must run on Windows to exercise Windows hardware, runtime, and diagnostics paths."
    }

    Assert-Command "cargo"
    Assert-Command "npm"
    Assert-Command "powershell.exe"

    if (-not $SkipBuild) {
        Invoke-LoggedCommand -Name "frontend.build" -LogName "npm-build.log" -FilePath "npm" -Arguments @("run", "build")
    } else {
        $script:Steps.Add((New-StepResult -Name "frontend.build" -Status "skipped" -Log ""))
    }

    if (-not $SkipCargoTest) {
        Invoke-LoggedCommand -Name "cargo.test" -LogName "cargo-test.log" -FilePath "cargo" -Arguments @("test")
    } else {
        $script:Steps.Add((New-StepResult -Name "cargo.test" -Status "skipped" -Log ""))
    }

    Invoke-CargoJson -Name "hardware.inspect" -Arguments @("run", "--quiet", "--", "inspect", "--pretty") -JsonName "inspect.json"
    Invoke-CargoJson -Name "runtime.monitor" -Arguments @("run", "--quiet", "--", "runtime", "--pretty") -JsonName "runtime.json"

    $deviceIdPath = Join-Path $script:ReportDir "device-id.txt"
    $deviceIdErrPath = Join-Path $script:ReportDir "device-id.stderr.txt"
    & cargo run --quiet -- device-id 1> $deviceIdPath 2> $deviceIdErrPath
    $deviceIdExit = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    $deviceId = if (Test-Path $deviceIdPath) { (Get-Content -Raw -Path $deviceIdPath).Trim() } else { "" }
    if ($deviceIdExit -ne 0 -or $deviceId -notmatch "^(device|fallback)-v1-[0-9a-f]{29}$") {
        $script:Steps.Add((New-StepResult -Name "device-id" -Status "failed" -ExitCode $deviceIdExit -Log $deviceIdPath -Message "Device identity missing or invalid"))
        throw "Device identity check failed. See $deviceIdPath and $deviceIdErrPath"
    }
    $script:Steps.Add((New-StepResult -Name "device-id" -Status "passed" -Log $deviceIdPath))

    if (-not $SkipSubmit -and -not [string]::IsNullOrWhiteSpace($Site) -and -not [string]::IsNullOrWhiteSpace($Token)) {
        $submitJson = Join-Path $script:ReportDir "submit-response.json"
        $submitErr = Join-Path $script:ReportDir "submit.stderr.txt"
        & cargo run --quiet -- submit --site $Site --token $Token --note $Note 1> $submitJson 2> $submitErr
        $submitExit = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
        if ($submitExit -ne 0) {
            $script:Steps.Add((New-StepResult -Name "upload.submit" -Status "failed" -ExitCode $submitExit -Log $submitErr))
            throw "Upload submit failed. See $submitErr"
        }
        $script:Steps.Add((New-StepResult -Name "upload.submit" -Status "passed" -Log $submitJson))
    } else {
        $script:Steps.Add((New-StepResult -Name "upload.submit" -Status "skipped" -Log "" -Message "Provide -Site and -Token, or omit -SkipSubmit, to run upload."))
    }

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

    if ($OpenDev) {
        $script:Steps.Add((New-StepResult -Name "tauri.dev" -Status "manual" -Log "" -Message "Starting npm run tauri:dev; close the app window to finish."))
        npm run tauri:dev
    }

    $summary.status = "passed"
} catch {
    $summary.status = "failed"
    $summary.error = $_.Exception.Message
} finally {
    $summary.steps = $script:Steps
    $reportPath = Join-Path $script:ReportDir "windows-smoke-report.json"
    $summary | ConvertTo-Json -Depth 8 | Out-File -FilePath $reportPath -Encoding utf8

    Write-Host ""
    Write-Host "Windows smoke report: $reportPath"
    Write-Host "Status: $($summary.status)"
    if ($summary.status -ne "passed") {
        exit 1
    }
}
