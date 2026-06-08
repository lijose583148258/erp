$ErrorActionPreference = 'Stop'

function Wait-StableRuntime {
  param(
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Seconds 2
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5001/api/health' -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        Write-Host "Stable runtime healthy: $($response.Content)"
        return $true
      }
    } catch {
      Write-Host "Waiting for stable runtime: $($_.Exception.Message)"
    }
  } while ((Get-Date) -lt $deadline)

  return $false
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function ConvertFrom-Utf8Base64 {
  param(
    [Parameter(Mandatory = $true)][string]$Value
  )

  return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

$cleanRuntimeRoot = if ($env:AILAODA_CLEAN_RUNTIME_ROOT -and $env:AILAODA_CLEAN_RUNTIME_ROOT.Trim()) {
  $env:AILAODA_CLEAN_RUNTIME_ROOT
} else {
  ConvertFrom-Utf8Base64 'RTpc54ix5Yqz6L6+57qv5YeA57O757uf'
}
$cleanRuntimeStartScript = Join-Path $cleanRuntimeRoot 'scripts\start-stable-v2.ps1'
$packageRoot = Join-Path $root 'AilaoDa_Stable_Package'
$stablePackageStartScript = Join-Path $packageRoot 'scripts\start-stable-v2.ps1'
$allowPackageFallback = $env:AILAODA_ALLOW_STABLE_PACKAGE_FALLBACK -eq '1'
$packageStartScript = if (Test-Path -LiteralPath $cleanRuntimeStartScript) {
  $cleanRuntimeStartScript
} elseif ($allowPackageFallback -and (Test-Path -LiteralPath $stablePackageStartScript)) {
  Write-Warning "Using F: stable package fallback because AILAODA_ALLOW_STABLE_PACKAGE_FALLBACK=1: $stablePackageStartScript"
  $stablePackageStartScript
} else {
  throw "Clean runtime start script not found: $cleanRuntimeStartScript. Deploy E: clean runtime first; set AILAODA_ALLOW_STABLE_PACKAGE_FALLBACK=1 only for explicit development fallback."
}

function Assert-PathUnderDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$PathToCheck,
    [Parameter(Mandatory = $true)][string]$AllowedDirectory,
    [string]$Label = 'path'
  )

  $allowedFull = [System.IO.Path]::GetFullPath($AllowedDirectory).TrimEnd('\', '/')
  $targetFull = [System.IO.Path]::GetFullPath($PathToCheck)
  $comparison = [System.StringComparison]::OrdinalIgnoreCase
  $isInside = $targetFull.Equals($allowedFull, $comparison) -or $targetFull.StartsWith("$allowedFull\", $comparison)
  if (-not $isInside) {
    throw "Refusing to use $Label outside governed directory. target=$targetFull allowed=$allowedFull"
  }

  return $targetFull
}

function Remove-OwnedAuditLog {
  param(
    [Parameter(Mandatory = $true)][string]$PathToRemove,
    [Parameter(Mandatory = $true)][string]$AuditOutputDir
  )

  $safePath = Assert-PathUnderDirectory -PathToCheck $PathToRemove -AllowedDirectory $AuditOutputDir -Label 'audit log'
  if (Test-Path -LiteralPath $safePath) {
    Remove-Item -LiteralPath $safePath -Force
  }
}

function Stop-OwnedAuditProcess {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$Reason
  )

  try { $Process.Refresh() } catch {}
  if ($Process.HasExited) { return }

  $liveProcess = Get-Process -Id $Process.Id -ErrorAction Stop
  if ($liveProcess.ProcessName -notmatch '^node') {
    throw "Refusing to stop non-node process pid=$($Process.Id) name=$($liveProcess.ProcessName) reason=$Reason"
  }

  Stop-Process -Id $Process.Id -Force -ErrorAction Stop
  Write-Warning "Terminated owned Phase 3 audit process pid=$($Process.Id) reason=$Reason"
}

function Start-StablePackage {
  if (-not (Test-Path -LiteralPath $packageStartScript)) {
    throw "Phase 3 package start script not found: $packageStartScript"
  }

  $startProcess = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $packageStartScript) `
    -PassThru `
    -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(300)
  while (-not $startProcess.HasExited) {
    Start-Sleep -Seconds 1
    try { $startProcess.Refresh() } catch {}
    if ((Get-Date) -gt $deadline) {
      try { Stop-Process -Id $startProcess.Id -Force -ErrorAction Stop } catch {}
      throw "Phase 3 package start script exceeded 300s and was terminated: $packageStartScript"
    }
  }

  if ($startProcess.ExitCode -ne 0) {
    throw "Phase 3 package start script failed with exit code $($startProcess.ExitCode)."
  }

  if (-not (Wait-StableRuntime -TimeoutSeconds 60)) {
    throw 'Stable runtime did not become healthy within 60 seconds.'
  }
}

function Invoke-Phase3BrowserAudit {
  param(
    [int]$TimeoutSeconds = 300,
    [int]$HeartbeatSeconds = 15,
    [int]$StaleSeconds = 120
  )

  $auditScript = Join-Path $root 'scripts\daily-local-governance-audit-v1.cjs'
  $auditOutputDir = Join-Path $root 'output\audit'
  $reportPath = Assert-PathUnderDirectory -PathToCheck (Join-Path $auditOutputDir 'daily-local-governance-audit-v1.json') -AllowedDirectory $auditOutputDir -Label 'daily governance report'
  $stdoutPath = Assert-PathUnderDirectory -PathToCheck (Join-Path $auditOutputDir 'phase3-package-browser.stdout.log') -AllowedDirectory $auditOutputDir -Label 'phase3 stdout log'
  $stderrPath = Assert-PathUnderDirectory -PathToCheck (Join-Path $auditOutputDir 'phase3-package-browser.stderr.log') -AllowedDirectory $auditOutputDir -Label 'phase3 stderr log'
  $nodeCommand = (Get-Command node -ErrorAction Stop).Source

  New-Item -ItemType Directory -Path $auditOutputDir -Force | Out-Null
  Remove-OwnedAuditLog -PathToRemove $stdoutPath -AuditOutputDir $auditOutputDir
  Remove-OwnedAuditLog -PathToRemove $stderrPath -AuditOutputDir $auditOutputDir

  $reportWriteTimeBefore = if (Test-Path -LiteralPath $reportPath) { (Get-Item -LiteralPath $reportPath).LastWriteTimeUtc } else { $null }
  $start = Get-Date
  $lastHeartbeat = $start
  $lastProgress = $start

  $proc = Start-Process -FilePath $nodeCommand `
    -ArgumentList @($auditScript, '--with-browser') `
    -WorkingDirectory $root `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru `
    -WindowStyle Hidden

  try {
    while (-not $proc.HasExited) {
      Start-Sleep -Seconds 3
      $proc.Refresh()
      $now = Get-Date
      $elapsed = [int](($now - $start).TotalSeconds)
      $stdoutStamp = if (Test-Path -LiteralPath $stdoutPath) { (Get-Item -LiteralPath $stdoutPath).LastWriteTime } else { $null }
      $stderrStamp = if (Test-Path -LiteralPath $stderrPath) { (Get-Item -LiteralPath $stderrPath).LastWriteTime } else { $null }
      $latestStamp = @($stdoutStamp, $stderrStamp) | Where-Object { $_ } | Sort-Object -Descending | Select-Object -First 1
      if ($latestStamp -and $latestStamp -gt $lastProgress) {
        $lastProgress = $latestStamp
      }

      if ($elapsed -ge $TimeoutSeconds) {
        try { Stop-OwnedAuditProcess -Process $proc -Reason "timeout ${TimeoutSeconds}s" } catch {}
        $stderrTail = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Tail 40) -join "`n" } else { '' }
        throw "Phase 3 browser audit exceeded ${TimeoutSeconds}s and was terminated. stderr tail: $stderrTail"
      }

      $idleSeconds = [int](($now - $lastProgress).TotalSeconds)
      if ($idleSeconds -ge $StaleSeconds) {
        try { Stop-OwnedAuditProcess -Process $proc -Reason "stale ${StaleSeconds}s" } catch {}
        $stdoutTail = if (Test-Path -LiteralPath $stdoutPath) { (Get-Content -LiteralPath $stdoutPath -Tail 60) -join "`n" } else { '' }
        $stderrTail = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Tail 60) -join "`n" } else { '' }
        throw "Phase 3 browser audit had no log progress for ${StaleSeconds}s and was terminated. stdout tail: $stdoutTail`nstderr tail: $stderrTail"
      }

      if (($now - $lastHeartbeat).TotalSeconds -ge $HeartbeatSeconds) {
        $reportUpdated = $false
        if (Test-Path -LiteralPath $reportPath) {
          $reportWriteTime = (Get-Item -LiteralPath $reportPath).LastWriteTimeUtc
          $reportUpdated = $reportWriteTimeBefore -and $reportWriteTime -gt $reportWriteTimeBefore
        }
        Write-Host ("Phase3 browser audit running... elapsed={0}s idle={1}s pid={2} reportUpdated={3}" -f $elapsed, $idleSeconds, $proc.Id, $reportUpdated)
        $lastHeartbeat = $now
      }
    }
  } finally {
    try { $proc.WaitForExit() } catch {}
    $proc.Refresh()
  }

  $stdoutTail = if (Test-Path -LiteralPath $stdoutPath) { (Get-Content -LiteralPath $stdoutPath -Tail 60) -join "`n" } else { '' }
  $stderrTail = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Tail 60) -join "`n" } else { '' }
  $exitCode = $proc.ExitCode
  if ($null -eq $exitCode -and (Test-Path -LiteralPath $reportPath)) {
    try {
      $phase3ReportText = Get-Content -LiteralPath $reportPath -Raw
      if ($phase3ReportText -match '"status"\s*:\s*"passed"') {
        $exitCode = 0
      } elseif ($phase3ReportText -match '"status"\s*:\s*"(failed|stuck)"') {
        $exitCode = 1
      }
    } catch {
      $exitCode = $null
    }
  }

  if ($null -eq $exitCode) {
    throw "Phase 3 browser audit exited but did not expose an exit code. stdout tail: $stdoutTail`nstderr tail: $stderrTail"
  }

  if ($exitCode -ne 0) {
    throw "Phase 3 browser audit failed with exit code $exitCode. stderr tail: $stderrTail"
  }

  return @{
    ExitCode = $exitCode
    StdoutPath = $stdoutPath
    StderrPath = $stderrPath
    ReportPath = $reportPath
    StdoutTail = $stdoutTail
    StderrTail = $stderrTail
  }
}

$env:AILAODA_RESTART_FROM_PACKAGE = '1'
$env:AILAODA_CLEAN_RUNTIME_ROOT = $cleanRuntimeRoot

Write-Host "Ensuring Phase 3 package runtime is running before audit: $packageStartScript"
Start-StablePackage

Write-Host 'Running Phase 3 browser audit with heartbeat and timeout guard...'
$auditResult = Invoke-Phase3BrowserAudit
$auditExitCode = $auditResult.ExitCode

if ($auditExitCode -ne 0) {
  try {
    Write-Warning 'Phase 3 audit failed. Restarting stable package for manual inspection before exiting.'
    Start-StablePackage
  } catch {
    Write-Warning "Failed to restart stable package after audit failure: $($_.Exception.Message)"
  }
  Write-Error "Phase 3 package browser audit failed with exit code $auditExitCode."
  exit $auditExitCode
}

Write-Host "Phase 3 browser audit report: $($auditResult.ReportPath)"
Write-Host 'Phase 3 audit passed. Ensuring the Phase 3 package runtime remains running on http://127.0.0.1:5001 ...'
Start-StablePackage

exit 0
