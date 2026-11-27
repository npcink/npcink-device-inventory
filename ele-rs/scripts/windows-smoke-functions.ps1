$script:SmokeUtf8 = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $script:SmokeUtf8
[Console]::OutputEncoding = $script:SmokeUtf8
$script:CommandRunner = Join-Path $PSScriptRoot "windows-command-runner.mjs"

function Invoke-SmokeCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$StdoutPath,
        [string]$StderrPath,
        [int]$TimeoutSeconds = 120
    )

    # npm is a .cmd/.ps1 shim on Windows. Encode its command instead of feeding
    # user-controlled paths/notes/tokens to cmd.exe's argument parser.
    if ($FilePath -eq "npm") {
        $quoted = @($Arguments | ForEach-Object { "'" + $_.Replace("'", "''") + "'" })
        $command = "`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding(`$false); `$OutputEncoding=[Console]::OutputEncoding; & npm $($quoted -join ' '); exit `$LASTEXITCODE"
        $FilePath = "powershell.exe"
        $Arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command)))
    }
    $request = @{
        file = $FilePath
        args = @($Arguments)
        stdout = $StdoutPath
        stderr = $StderrPath
        timeout_ms = $TimeoutSeconds * 1000
    } | ConvertTo-Json -Depth 5 -Compress
    # Windows PowerShell 5.1 can retain the caller's native-pipeline code page.
    # ASCII JSON escapes preserve Unicode even when that caller uses ASCII/OEM.
    $request = [regex]::Replace($request, '[^\x00-\x7F]', [System.Text.RegularExpressions.MatchEvaluator]{
        param($match)
        '\u{0:x4}' -f [int][char]$match.Value
    })
    # The runner emits only a short JSON result; native stderr is saved as bytes,
    # never reinterpreted as a PowerShell ErrorRecord under ErrorAction=Stop.
    $response = $request | & node $script:CommandRunner
    if ($LASTEXITCODE -ne 0) { throw "Command runner failed; inspect the step logs." }
    $response | ConvertFrom-Json
}

function Get-SmokeCoverage {
    param([object[]]$Steps)
    [ordered]@{
        skipped_steps = @($Steps | Where-Object { $_.status -eq "skipped" } | ForEach-Object { $_.name })
        failed_optional_steps = @($Steps | Where-Object { $_.status -eq "failed_allowed" } | ForEach-Object { $_.name })
        manual_steps = @($Steps | Where-Object { $_.status -eq "manual" } | ForEach-Object { $_.name })
        installation_verified = $false
        update_verified = $false
        platform_signing_verified = $false
    }
}

function Get-SmokeInventoryMetrics {
    param([string]$Stderr)
    if ($Stderr -notmatch 'elapsed_ms=(\d+) payload_bytes=(\d+)') {
        throw "Missing required collection timing and payload size metrics"
    }
    @{
        collector_elapsed_ms = [long]$Matches[1]
        inventory_json_bytes = [long]$Matches[2]
    }
}
