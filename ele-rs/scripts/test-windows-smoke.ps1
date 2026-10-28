$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-smoke-functions.ps1")

$reportDir = Join-Path ([IO.Path]::GetTempPath()) ("npcink-smoke-wrapper-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $reportDir | Out-Null
try {
    $outPath = Join-Path $reportDir "stdout.json"
    $errPath = Join-Path $reportDir "stderr.txt"
    # Build non-ASCII strings without depending on PS5.1's source-file encoding.
    $label = [string][char]0x4e2d + [char]0x6587
    $values = @($label, "space & dollar`$()", "single'quote", 'double"quote', 'trailing\', '')
    $source = 'process.stdout.write(JSON.stringify(process.argv.slice(1))); process.stderr.write("normal native stderr");'
    $result = Invoke-SmokeCommand -FilePath "node" -Arguments (@("-e", $source, "--") + $values) -StdoutPath $outPath -StderrPath $errPath -TimeoutSeconds 10
    if ($result.exit_code -ne 0) { throw "Native stderr was treated as failure" }
    # PS5.1 emits the JSON array as one pipeline object; PS7 enumerates it.
    # Direct assignment works for both, unlike wrapping the pipeline in @().
    $actual = Get-Content -Raw -Encoding UTF8 $outPath | ConvertFrom-Json
    if ($actual.Count -ne $values.Count) { throw "Argument count changed: expected $($values.Count), received $($actual.Count)" }
    for ($i = 0; $i -lt $values.Count; $i++) {
        if ($actual[$i] -cne $values[$i]) { throw "UTF-8 or argument boundary changed at index $i" }
    }
    $result = Invoke-SmokeCommand -FilePath "node" -Arguments @("-e", "process.exit(7)") -StdoutPath $outPath -StderrPath $errPath -TimeoutSeconds 10
    if ($result.exit_code -ne 7) { throw "Native exit code was lost" }
    $result = Invoke-SmokeCommand -FilePath "node" -Arguments @("-e", "setInterval(() => {}, 1000)") -StdoutPath $outPath -StderrPath $errPath -TimeoutSeconds 1
    if (-not $result.timed_out -or $result.exit_code -eq 0) { throw "Timeout did not fail" }
    if ($env:OS -eq "Windows_NT") {
        $result = Invoke-SmokeCommand -FilePath "npm" -Arguments @("--version") -StdoutPath $outPath -StderrPath $errPath -TimeoutSeconds 30
        if ($result.exit_code -ne 0) { throw "Windows npm shim did not run" }
    } else {
        Write-Host "Windows npm shim check skipped on this platform."
    }
    $coverage = Get-SmokeCoverage -Steps @(@{name='upload.submit';status='skipped'}, @{name='tauri.dev';status='manual'})
    if ($coverage.installation_verified -or $coverage.update_verified -or $coverage.skipped_steps -notcontains 'upload.submit' -or $coverage.manual_steps -notcontains 'tauri.dev') {
        throw "Partial smoke was incorrectly represented as full acceptance"
    }
    $metrics = Get-SmokeInventoryMetrics -Stderr "elapsed_ms=123 payload_bytes=456"
    if ($metrics.collector_elapsed_ms -ne 123 -or $metrics.inventory_json_bytes -ne 456) { throw "Missing metrics" }
    $rejected = $false
    try { Get-SmokeInventoryMetrics -Stderr "no metrics" | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw "Missing timing was silently accepted" }
    Write-Host "Smoke wrapper checks passed on $($PSVersionTable.PSVersion); Windows-only cases require Windows."
} finally {
    Remove-Item -Recurse -Force $reportDir
}
