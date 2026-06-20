param(
  [switch]$SkipCacheClear
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot

function Get-ProcessCommandLine {
  param([int]$ProcessId)

  try {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    return [string]$processInfo.CommandLine
  } catch {
    return ''
  }
}

function Test-AilaoDaProcessOwner {
  param(
    [int]$ProcessId,
    [string]$WorkspaceRoot
  )

  $commandLine = Get-ProcessCommandLine -ProcessId $ProcessId
  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    return $false
  }

  $normalizedCommand = $commandLine.Replace('/', '\')
  $normalizedRoot = ([System.IO.Path]::GetFullPath($WorkspaceRoot)).TrimEnd('\')

  if (-not $normalizedCommand.Contains($normalizedRoot)) {
    return $false
  }

  return ($normalizedCommand -match 'backend\\dist\\server\.js') `
    -or ($normalizedCommand -match 'backend\\src\\server\.ts') `
    -or ($normalizedCommand -match 'scripts\\start-stable-v2\.ps1')
}

function Test-AilaoDaHttpOwner {
  param([int]$Port)

  try {
    $client = New-Object System.Net.WebClient
    $client.Encoding = [System.Text.Encoding]::UTF8
    $manifest = $client.DownloadString("http://127.0.0.1:$Port/manifest.json")
    return $manifest.Contains('/icon.svg') `
      -and $manifest.Contains('business') `
      -and $manifest.Contains('productivity') `
      -and $manifest.Contains('zh-CN')
  } catch {
    return $false
  }
}

function Get-ShutdownSignalPaths {
  param([string]$WorkspaceRoot)

  $paths = @(
    (Join-Path 'D:\AilaoDaRuntime' 'shutdown.signal')
  )
  if ($env:AILAODA_RUNTIME_DB_PATH) {
    $paths += (Join-Path (Split-Path -Parent $env:AILAODA_RUNTIME_DB_PATH) 'shutdown.signal')
  }
  if ($env:LOCALAPPDATA) {
    $paths += (Join-Path $env:LOCALAPPDATA 'AilaoDaRuntime\shutdown.signal')
  }
  if ($env:TEMP) {
    $paths += (Join-Path $env:TEMP 'AilaoDaRuntime\shutdown.signal')
  }
  $paths += (Join-Path $WorkspaceRoot 'runtime-data\shutdown.signal')

  return $paths | Where-Object { $_ -and $_.Trim() } | Select-Object -Unique
}

function Request-AilaoDaGracefulShutdown {
  param([string]$WorkspaceRoot)

  foreach ($signalPath in (Get-ShutdownSignalPaths -WorkspaceRoot $WorkspaceRoot)) {
    try {
      $signalDir = Split-Path -Parent $signalPath
      New-Item -ItemType Directory -Path $signalDir -Force | Out-Null
      Set-Content -LiteralPath $signalPath -Value ((Get-Date).ToUniversalTime().ToString('o')) -Encoding UTF8
    } catch {}
  }
}

function Wait-ProcessExitById {
  param(
    [int]$ProcessId,
    [int]$TimeoutSeconds
  )

  for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
    Start-Sleep -Seconds 1
    $existing = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $existing) {
      return $true
    }
  }
  return $false
}

function Stop-PortProcess {
  param(
    [int]$Port,
    [string]$WorkspaceRoot
  )

  $lines = netstat -ano | Select-String ":$Port"
  $processedPids = @{}
  foreach ($line in $lines) {
    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }
    if ($parts.Length -lt 5) { continue }
    $state = if ($parts.Length -ge 4) { $parts[3] } else { '' }
    $procId = $parts[-1]
    if ($state -ne 'LISTENING') { continue }
    $pidNumber = [int]$procId
    if ($processedPids.ContainsKey($pidNumber)) { continue }
    $processedPids[$pidNumber] = $true

    if ((Test-AilaoDaProcessOwner -ProcessId $pidNumber -WorkspaceRoot $WorkspaceRoot) -or (Test-AilaoDaHttpOwner -Port $Port)) {
      Write-Host "Request graceful shutdown for AilaoDa listener on port $Port (PID $pidNumber)."
      Request-AilaoDaGracefulShutdown -WorkspaceRoot $WorkspaceRoot
      if (Wait-ProcessExitById -ProcessId $pidNumber -TimeoutSeconds 12) {
        Write-Host "AilaoDa listener on port $Port exited gracefully."
        continue
      }
      Write-Warning "Graceful shutdown timed out for PID $pidNumber; forcing stop."
      try { Stop-Process -Id $pidNumber -Force -ErrorAction SilentlyContinue } catch {}
      continue
    }

    $ownerCommandLine = Get-ProcessCommandLine -ProcessId $pidNumber
    Write-Warning "Skip non-AilaoDa listener on port $Port (PID $pidNumber). CommandLine: $ownerCommandLine"
  }
}

Write-Host '[1/3] Stopping AilaoDa runtime listeners only...'
Stop-PortProcess -Port 5001 -WorkspaceRoot $root
Stop-PortProcess -Port 3000 -WorkspaceRoot $root
Stop-PortProcess -Port 3001 -WorkspaceRoot $root
Stop-PortProcess -Port 3002 -WorkspaceRoot $root
Stop-PortProcess -Port 4173 -WorkspaceRoot $root
Write-Host 'Skip 5173/5180 by policy: those ports may belong to other projects or dev tools.'
Start-Sleep -Seconds 1

if (-not $SkipCacheClear) {
  Write-Host '[2/3] Clearing Vite cache (prevent EPERM cache lock)...'
  $customCache = Join-Path $root '.vite-cache'
  $defaultCache = Join-Path $root 'node_modules\.vite'
  if (Test-Path $customCache)  { Remove-Item -LiteralPath $customCache  -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $defaultCache) { Remove-Item -LiteralPath $defaultCache -Recurse -Force -ErrorAction SilentlyContinue }
} else {
  Write-Host '[2/3] Cache clear skipped.'
}

Write-Host '[3/3] AilaoDa runtime ports stopped safely.'
