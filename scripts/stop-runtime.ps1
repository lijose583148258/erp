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

  return $normalizedCommand.Contains($normalizedRoot) `
    -or ($normalizedCommand -match 'backend\\dist\\server\.js') `
    -or ($normalizedCommand -match 'backend\\src\\server\.ts') `
    -or ($normalizedCommand -match 'scripts\\start-stable-v2\.ps1')
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

    if (Test-AilaoDaProcessOwner -ProcessId $pidNumber -WorkspaceRoot $WorkspaceRoot) {
      Write-Host "Stop AilaoDa listener on port $Port (PID $pidNumber)."
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
