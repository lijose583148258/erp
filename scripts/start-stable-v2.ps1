$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 > $null
function Wait-ProcessExit {
  param(
    [Parameter(Mandatory = $true)]
    [System.Diagnostics.Process]$Process,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)]
    [string]$StepName
  )

  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch {}
    throw "$StepName exceeded ${TimeoutSeconds}s and is treated as stuck."
  }

  if ($Process.ExitCode -ne 0) {
    throw "$StepName failed with exit code $($Process.ExitCode)."
  }
}

function Invoke-TimeboxedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)]
    [string]$StepName,
    [switch]$QuietOutput
  )

  $job = Start-Job -ScriptBlock {
    param($wd, $cmd, $argsList)
    Set-Location $wd
    & $cmd @argsList 2>&1
    "__EXITCODE__=$LASTEXITCODE"
  } -ArgumentList $WorkingDirectory, $Command, $Arguments

  $completed = Wait-Job -Job $job -Timeout $TimeoutSeconds
  if (-not $completed) {
    Stop-Job -Job $job -Force -ErrorAction SilentlyContinue | Out-Null
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue | Out-Null
    throw "$StepName exceeded ${TimeoutSeconds}s and is treated as stuck."
  }

  $output = Receive-Job -Job $job
  Remove-Job -Job $job -Force -ErrorAction SilentlyContinue | Out-Null
  $exitLine = @($output | Where-Object { $_ -is [string] -and $_ -like '__EXITCODE__=*' })[-1]
  $exitCode = if ($exitLine) { [int]($exitLine -replace '^__EXITCODE__=', '') } else { 0 }
  $visibleOutput = @($output | Where-Object { -not ($_ -is [string] -and $_ -like '__EXITCODE__=*') })
  if ($visibleOutput -and (-not $QuietOutput -or $exitCode -ne 0)) { $visibleOutput | Write-Host }
  if ($exitCode -ne 0) {
    throw "$StepName failed with exit code $exitCode."
  }
}

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
    -or ($normalizedCommand -match 'scripts\\start-stable-v2\.ps1')
}

function Stop-PortProcess {
  param(
    [int]$Port,
    [string]$WorkspaceRoot,
    [switch]$Required
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
    $message = "Port $Port is occupied by a non-AilaoDa process (PID $pidNumber). CommandLine: $ownerCommandLine"
    if ($Required) {
      throw "$message. Stop it manually or change the AilaoDa port; this launcher will not kill unrelated processes."
    }
    Write-Warning "$message. Skip stopping it."
  }
}

$root = Split-Path -Parent $PSScriptRoot
$npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source
$nodeCmd = (Get-Command node.exe -ErrorAction Stop).Source
$backendOut = Join-Path $root 'backend\logs\stable-run.out.log'
$backendErr = Join-Path $root 'backend\logs\stable-run.err.log'
$frontendBuildOut = Join-Path $root 'logs\frontend-build.out.log'
$frontendBuildErr = Join-Path $root 'logs\frontend-build.err.log'
$backendBuildOut = Join-Path $root 'logs\backend-build.out.log'
$backendBuildErr = Join-Path $root 'logs\backend-build.err.log'
$frontendDistIndex = Join-Path $root 'dist\index.html'
$backendDistEntry = Join-Path $root 'backend\dist\server.js'
$rootPackageJson = Join-Path $root 'package.json'
$backendSrcDir = Join-Path $root 'backend\src'
$backendTsconfig = Join-Path $root 'backend\tsconfig.json'
$runtimeDbCandidates = @(
  $env:AILAODA_RUNTIME_DB_PATH
  (Join-Path 'D:\AilaoDaRuntime' 'stable.db')
  $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'AilaoDaRuntime\stable.db' })
  $(if ($env:TEMP) { Join-Path $env:TEMP 'AilaoDaRuntime\stable.db' })
  (Join-Path $root 'runtime-data\stable.db')
) | Where-Object { $_ -and $_.Trim() }
$frontendSourceDirs = @(
  (Join-Path $root 'app'),
  (Join-Path $root 'components'),
  (Join-Path $root 'pages'),
  (Join-Path $root 'services'),
  (Join-Path $root 'utils'),
  (Join-Path $root 'index.html'),
  (Join-Path $root 'index.tsx'),
  (Join-Path $root 'index.css')
)
$backendSourceDirs = @(
  (Join-Path $root 'backend\src'),
  (Join-Path $root 'backend\prisma'),
  (Join-Path $root 'backend\package.json'),
  (Join-Path $root 'backend\tsconfig.json')
)
$runtimeDbPath = $null
$workspaceSeedDbPath = Join-Path $root 'backend\prisma\dev.db'

foreach ($logFile in @($backendOut, $backendErr, $frontendBuildOut, $frontendBuildErr, $backendBuildOut, $backendBuildErr)) {
  $logDir = Split-Path -Parent $logFile
  if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  }
}

function Resolve-RuntimeDbPath {
  foreach ($candidate in $runtimeDbCandidates) {
    try {
      $dir = Split-Path -Parent $candidate
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
      return $candidate
    } catch {
      continue
    }
  }
  throw 'No writable runtime database path was found.'
}

function Get-ExistingRuntimeDbCandidates {
  $existing = @()
  foreach ($candidate in $runtimeDbCandidates) {
    if (Test-Path -LiteralPath $candidate) {
      $existing += (Get-Item -LiteralPath $candidate)
    }
  }
  return $existing | Sort-Object LastWriteTime -Descending
}

Write-Host '[1/7] Stop old AilaoDa listeners'
Stop-PortProcess -Port 5001 -WorkspaceRoot $root -Required
Stop-PortProcess -Port 3000 -WorkspaceRoot $root
Stop-PortProcess -Port 3001 -WorkspaceRoot $root
Stop-PortProcess -Port 3002 -WorkspaceRoot $root
Stop-PortProcess -Port 4173 -WorkspaceRoot $root
Start-Sleep -Seconds 1

Write-Host '[2/7] Prepare writable runtime database'
$runtimeDbPath = Resolve-RuntimeDbPath
$existingRuntimeDbs = Get-ExistingRuntimeDbCandidates

if ($existingRuntimeDbs.Count -gt 0) {
  $selectedSource = $existingRuntimeDbs | Select-Object -First 1
  $shouldSync = (-not (Test-Path -LiteralPath $runtimeDbPath)) -or ($selectedSource.FullName -ne $runtimeDbPath)
  if ($shouldSync) {
    if (Test-Path -LiteralPath $runtimeDbPath) {
      $backupName = 'stable.pre-sync-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.db'
      Copy-Item -LiteralPath $runtimeDbPath -Destination (Join-Path (Split-Path -Parent $runtimeDbPath) $backupName) -Force
    }
    Copy-Item -LiteralPath $selectedSource.FullName -Destination $runtimeDbPath -Force
  }
} elseif ((Test-Path -LiteralPath $workspaceSeedDbPath) -and (-not (Test-Path -LiteralPath $runtimeDbPath))) {
  Copy-Item -LiteralPath $workspaceSeedDbPath -Destination $runtimeDbPath -Force
} elseif (-not (Test-Path -LiteralPath $runtimeDbPath)) {
  New-Item -ItemType File -Path $runtimeDbPath -Force | Out-Null
}

$runtimeDbUrl = "file:$($runtimeDbPath.Replace('\','/'))"

Write-Host '[3/7] Build frontend'
function Get-LatestFrontendSourceWriteTime {
  $latest = [datetime]::MinValue
  foreach ($item in $frontendSourceDirs) {
    if (-not (Test-Path $item)) { continue }
    $resolved = Get-Item -LiteralPath $item -ErrorAction SilentlyContinue
    if ($null -ne $resolved -and $resolved.LastWriteTime -gt $latest) {
      $latest = $resolved.LastWriteTime
    }
    if ($resolved -and $resolved.PSIsContainer) {
      $childLatest = Get-ChildItem -LiteralPath $resolved.FullName -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if ($null -ne $childLatest -and $childLatest.LastWriteTime -gt $latest) {
        $latest = $childLatest.LastWriteTime
      }
    }
  }
  return $latest
}

function Get-LatestBackendSourceWriteTime {
  $latest = [datetime]::MinValue
  foreach ($item in $backendSourceDirs) {
    if (-not (Test-Path $item)) { continue }
    $resolved = Get-Item -LiteralPath $item -ErrorAction SilentlyContinue
    if ($null -ne $resolved -and $resolved.LastWriteTime -gt $latest) {
      $latest = $resolved.LastWriteTime
    }
    if ($resolved -and $resolved.PSIsContainer) {
      $childLatest = Get-ChildItem -LiteralPath $resolved.FullName -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if ($null -ne $childLatest -and $childLatest.LastWriteTime -gt $latest) {
        $latest = $childLatest.LastWriteTime
      }
    }
  }
  return $latest
}

$frontendLatestSourceTime = Get-LatestFrontendSourceWriteTime
$frontendDistTime = if (Test-Path $frontendDistIndex) { (Get-Item -LiteralPath $frontendDistIndex).LastWriteTime } else { [datetime]::MinValue }
$frontendNeedsBuild = ($env:FORCE_FRONTEND_BUILD -eq 'true') -or (-not (Test-Path $frontendDistIndex)) -or ($frontendLatestSourceTime -gt $frontendDistTime)
$canBuildFrontend = (Test-Path -LiteralPath $rootPackageJson) -and (Test-Path -LiteralPath (Join-Path $root 'index.html'))

if (-not $frontendNeedsBuild) {
  Write-Host 'Use existing frontend dist.'
} elseif (-not $canBuildFrontend) {
  if (Test-Path -LiteralPath $frontendDistIndex) {
    Write-Host 'Packaged mode detected. Use existing frontend dist.'
  } else {
    throw 'Frontend dist is missing and packaged mode cannot rebuild it.'
  }
} else {
  Invoke-TimeboxedCommand -WorkingDirectory $root -Command $npmCmd -Arguments @('run', 'build') -TimeoutSeconds 180 -StepName 'Frontend build'
}

Write-Host '[4/7] Build backend'
$backendLatestSourceTime = Get-LatestBackendSourceWriteTime
$backendDistTime = if (Test-Path $backendDistEntry) { (Get-Item -LiteralPath $backendDistEntry).LastWriteTime } else { [datetime]::MinValue }
$backendNeedsBuild = ($env:FORCE_BACKEND_BUILD -eq 'true') -or (-not (Test-Path $backendDistEntry)) -or ($backendLatestSourceTime -gt $backendDistTime)
$canBuildBackend = (Test-Path -LiteralPath $rootPackageJson) -and (Test-Path -LiteralPath $backendSrcDir) -and (Test-Path -LiteralPath $backendTsconfig)

if (-not $backendNeedsBuild) {
  Write-Host 'Use existing backend dist.'
} elseif (-not $canBuildBackend) {
  if (Test-Path -LiteralPath $backendDistEntry) {
    Write-Host 'Packaged mode detected. Use existing backend dist.'
  } else {
    throw 'Backend dist is missing and packaged mode cannot rebuild it.'
  }
} else {
  Invoke-TimeboxedCommand -WorkingDirectory $root -Command $npmCmd -Arguments @('run', 'build:backend') -TimeoutSeconds 180 -StepName 'Backend build'
}

Write-Host '[5/7] Repair runtime database'
$previousDatabaseUrl = $env:DATABASE_URL
try {
  $env:DATABASE_URL = $runtimeDbUrl
  Invoke-TimeboxedCommand -WorkingDirectory $root -Command $nodeCmd -Arguments @('backend/dist/database/manage-db.cli.js', 'repair') -TimeoutSeconds 60 -StepName 'Runtime database repair' -QuietOutput
} finally {
  $env:DATABASE_URL = $previousDatabaseUrl
}

Write-Host '[6/7] Start stable runtime'
if (Test-Path $backendOut) { Remove-Item -LiteralPath $backendOut -Force -ErrorAction SilentlyContinue }
if (Test-Path $backendErr) { Remove-Item -LiteralPath $backendErr -Force -ErrorAction SilentlyContinue }

$serverCommand = "set DATABASE_URL=$runtimeDbUrl && set SERVE_FRONTEND=true && set PORT=5001 && node backend/dist/server.js 1>""$backendOut"" 2>""$backendErr"""

$server = Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/c', $serverCommand `
  -WorkingDirectory $root `
  -PassThru `
  -WindowStyle Hidden

$healthy = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $healthCode = (Invoke-WebRequest 'http://127.0.0.1:5001/health' -UseBasicParsing -TimeoutSec 3).StatusCode
    $homeCode = (Invoke-WebRequest 'http://127.0.0.1:5001/' -UseBasicParsing -TimeoutSec 3).StatusCode
    if ($healthCode -eq 200 -and $homeCode -eq 200) {
      $healthy = $true
      break
    }
  } catch {}
}

if (-not $healthy) {
  try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch {}
  throw "Stable runtime exceeded 15s startup window. Check $backendErr"
}

Write-Host '[7/7] Done'
Write-Host 'System URL: http://127.0.0.1:5001'
Write-Host 'Login with a seeded local account. The launcher no longer prints passwords.'
Write-Host "Runtime DB: $runtimeDbPath"
Write-Host "Backend PID: $($server.Id)"
