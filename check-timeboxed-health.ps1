param(
    [int]$TimeoutSeconds = 300,
    [int]$TotalTimeoutSeconds = 300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-TimeboxedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$CommandLine,
        [Parameter(Mandatory = $true)][int]$CommandTimeoutSeconds
    )

    $startedAt = Get-Date
    $logDir = Join-Path (Get-Location).Path "logs\timeboxed-health"
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $stdout = Join-Path $logDir ("ailao-" + [guid]::NewGuid().ToString() + ".out.log")
    $stderr = Join-Path $logDir ("ailao-" + [guid]::NewGuid().ToString() + ".err.log")

    Write-Host ("[START] {0} | timeout={1}s" -f $Name, $CommandTimeoutSeconds)

    $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c $CommandLine" `
        -WorkingDirectory (Get-Location).Path `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr

    $finished = $proc.WaitForExit($CommandTimeoutSeconds * 1000)
    $elapsed = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)

    if (-not $finished) {
        try { Stop-Process -Id $proc.Id -Force } catch { }
        Write-Host ("[STUCK] {0} | elapsed={1}s | exceeded timeout" -f $Name, $elapsed) -ForegroundColor Red
        if (Test-Path $stdout) {
            Write-Host "[TAIL:STDOUT]"
            Get-Content -Path $stdout -Tail 20 | ForEach-Object { Write-Host $_ }
        }
        if (Test-Path $stderr) {
            Write-Host "[TAIL:STDERR]"
            Get-Content -Path $stderr -Tail 20 | ForEach-Object { Write-Host $_ }
        }
        return [pscustomobject]@{
            Name = $Name
            Status = "stuck"
            ExitCode = $null
            ElapsedSeconds = $elapsed
        }
    }

    $exitCode = [int]$proc.ExitCode
    if ($exitCode -eq 0) {
        Write-Host ("[PASS]  {0} | elapsed={1}s" -f $Name, $elapsed) -ForegroundColor Green
        return [pscustomobject]@{
            Name = $Name
            Status = "pass"
            ExitCode = 0
            ElapsedSeconds = $elapsed
        }
    }

    Write-Host ("[FAIL]  {0} | elapsed={1}s | exit={2}" -f $Name, $elapsed, $exitCode) -ForegroundColor Yellow
    if (Test-Path $stdout) {
        Write-Host "[TAIL:STDOUT]"
        Get-Content -Path $stdout -Tail 20 | ForEach-Object { Write-Host $_ }
    }
    if (Test-Path $stderr) {
        Write-Host "[TAIL:STDERR]"
        Get-Content -Path $stderr -Tail 20 | ForEach-Object { Write-Host $_ }
    }
    return [pscustomobject]@{
        Name = $Name
        Status = "fail"
        ExitCode = $exitCode
        ElapsedSeconds = $elapsed
    }
}

$commands = @(
    @{ Name = "backend-build"; Command = "npm run build:backend" },
    @{ Name = "db-status"; Command = "npm run db:manage -- status" },
    @{ Name = "db-backup"; Command = "npm run db:manage -- backup" }
)

$overallStartedAt = Get-Date
$results = @()
foreach ($item in $commands) {
    $overallElapsed = [math]::Round(((Get-Date) - $overallStartedAt).TotalSeconds, 1)
    if ($overallElapsed -ge $TotalTimeoutSeconds) {
        Write-Host ("[STUCK] overall health check exceeded {0}s before {1}" -f $TotalTimeoutSeconds, $item.Name) -ForegroundColor Red
        $results += [pscustomobject]@{
            Name = $item.Name
            Status = "stuck"
            ExitCode = $null
            ElapsedSeconds = 0
        }
        break
    }
    $remainingSeconds = [Math]::Max(1, [int][Math]::Floor($TotalTimeoutSeconds - $overallElapsed))
    $commandTimeout = [Math]::Min($TimeoutSeconds, $remainingSeconds)
    $results += Invoke-TimeboxedCommand -Name $item.Name -CommandLine $item.Command -CommandTimeoutSeconds $commandTimeout
}

Write-Host ""
Write-Host "=== Timeboxed Health Summary ==="
$results | ForEach-Object {
    Write-Host ("- {0}: {1} ({2}s)" -f $_.Name, $_.Status, $_.ElapsedSeconds)
}

$hasBad = $results | Where-Object { $_.Status -ne "pass" }
if ($hasBad) {
    Write-Host "Health check failed or stuck. Inspect tail output above." -ForegroundColor Red
    exit 1
}

Write-Host "Health check passed." -ForegroundColor Green
exit 0
