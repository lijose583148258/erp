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

function Import-DotEnvFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = [string]$_
    if (-not $line.Trim() -or $line.TrimStart().StartsWith('#')) {
      return
    }
    $match = [regex]::Match($line, '^\s*([^=\s]+)\s*=\s*(.*)\s*$')
    if (-not $match.Success) {
      return
    }
    $name = $match.Groups[1].Value
    $value = $match.Groups[2].Value.Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
      [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
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
    $message = "Port $Port is occupied by a non-AilaoDa process (PID $pidNumber). CommandLine: $ownerCommandLine"
    if ($Required) {
      throw "$message. Stop it manually or change the AilaoDa port; this launcher will not kill unrelated processes."
    }
    Write-Warning "$message. Skip stopping it."
  }
}

$root = Split-Path -Parent $PSScriptRoot
$rootFullPath = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
$rootLeafName = Split-Path -Leaf $rootFullPath
$archiveMarkers = @(
  (Join-Path $rootFullPath 'DO_NOT_RUN.txt'),
  (Join-Path $rootFullPath 'ARCHIVED.txt')
)
$allowArchivedPackageRun = $env:AILAODA_ALLOW_ARCHIVED_PACKAGE_RUN -eq '1'
if (-not $allowArchivedPackageRun) {
  $hasArchiveMarker = @($archiveMarkers | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }).Count -gt 0
  if ($rootLeafName -like '*_previous_*' -or $hasArchiveMarker) {
    throw "Refuse to start archived AilaoDa package: $rootFullPath. Use the current clean runtime package E:\爱劳达纯净系统 or set AILAODA_ALLOW_ARCHIVED_PACKAGE_RUN=1 only for a deliberate forensic drill."
  }
}
$npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source
$nodeCmd = (Get-Command node.exe -ErrorAction Stop).Source
Import-DotEnvFile -Path (Join-Path $root '.env.production')
Import-DotEnvFile -Path (Join-Path $root '.env')
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
$expectedRuntimeDbPath = Join-Path 'D:\AilaoDaRuntime' 'stable.db'
$allowRuntimeDbFallback = $env:AILAODA_ALLOW_RUNTIME_DB_FALLBACK -eq '1'
$requestedRuntimeDbPath = if ($env:AILAODA_RUNTIME_DB_PATH -and $env:AILAODA_RUNTIME_DB_PATH.Trim()) { $env:AILAODA_RUNTIME_DB_PATH.Trim() } else { $expectedRuntimeDbPath }
if (([System.IO.Path]::GetFullPath($requestedRuntimeDbPath) -ne [System.IO.Path]::GetFullPath($expectedRuntimeDbPath)) -and (-not $allowRuntimeDbFallback)) {
  throw "Runtime DB path override is blocked for stable local mode: $requestedRuntimeDbPath. Expected $expectedRuntimeDbPath. Set AILAODA_ALLOW_RUNTIME_DB_FALLBACK=1 only for an intentional migration drill."
}
$runtimeDbCandidates = if ($allowRuntimeDbFallback) {
  @(
    $requestedRuntimeDbPath
    $expectedRuntimeDbPath
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'AilaoDaRuntime\stable.db' })
    $(if ($env:TEMP) { Join-Path $env:TEMP 'AilaoDaRuntime\stable.db' })
    (Join-Path $root 'runtime-data\stable.db')
  ) | Where-Object { $_ -and $_.Trim() }
} else {
  @($expectedRuntimeDbPath)
}
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
$allowLegacyPrismaSeed = $env:AILAODA_ALLOW_LEGACY_PRISMA_SEED -eq '1'

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

if (Test-Path -LiteralPath $runtimeDbPath) {
  Write-Host "Use existing active runtime database: $runtimeDbPath"
} elseif ($existingRuntimeDbs.Count -gt 0) {
  $selectedSource = $existingRuntimeDbs | Select-Object -First 1
  Write-Host "Seed active runtime database from existing candidate: $($selectedSource.FullName)"
  Copy-Item -LiteralPath $selectedSource.FullName -Destination $runtimeDbPath -Force
} elseif ($allowLegacyPrismaSeed -and (Test-Path -LiteralPath $workspaceSeedDbPath) -and (-not (Test-Path -LiteralPath $runtimeDbPath))) {
  Write-Warning 'Seeding runtime database from backend\prisma\dev.db because AILAODA_ALLOW_LEGACY_PRISMA_SEED=1.'
  Copy-Item -LiteralPath $workspaceSeedDbPath -Destination $runtimeDbPath -Force
} elseif (-not (Test-Path -LiteralPath $runtimeDbPath)) {
  if (Test-Path -LiteralPath $workspaceSeedDbPath) {
    Write-Warning 'Legacy backend\prisma\dev.db exists but is quarantined by default. Creating a fresh runtime DB instead.'
  }
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

# ── dist 完整性预检 ──────────────────────────────────────
if (-not (Test-Path -LiteralPath $frontendDistIndex)) {
  throw "dist/index.html 不存在！请检查前端构建是否成功"
}
$distSize = (Get-Item -LiteralPath $frontendDistIndex).Length
if ($distSize -lt 500) {
  throw "dist/index.html 文件异常，大小仅 $distSize 字节，请重新构建"
}
$assetsDir = Join-Path $root 'dist\assets'
if (Test-Path -LiteralPath $assetsDir) {
  $zeroByteAssets = Get-ChildItem -LiteralPath $assetsDir -Filter "*.js" | Where-Object { $_.Length -eq 0 }
  if ($zeroByteAssets -and $zeroByteAssets.Count -gt 0) {
    throw "发现 $($zeroByteAssets.Count) 个 0 字节 JS 文件，dist 构建损坏，请重新构建"
  }
}
Write-Host '[✅] dist 完整性检查通过'

Write-Host '[4/7] Build backend'
$backendLatestSourceTime = Get-LatestBackendSourceWriteTime
$backendDistTime = if (Test-Path $backendDistEntry) { (Get-Item -LiteralPath $backendDistEntry).LastWriteTime } else { [datetime]::MinValue }
$backendNeedsBuild = ($env:FORCE_BACKEND_BUILD -eq 'true') -or (-not (Test-Path $backendDistEntry)) -or ($backendLatestSourceTime -gt $backendDistTime)
$canBuildBackend = (Test-Path -LiteralPath $rootPackageJson) -and (Test-Path -LiteralPath $backendSrcDir) -and (Test-Path -LiteralPath $backendTsconfig)
$isPackagedMode = (-not $canBuildFrontend) -or (-not $canBuildBackend)

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

$stableCorsOrigin = 'http://127.0.0.1:5001,http://localhost:5001'
$stableJwtSecret = if ($env:JWT_SECRET -and $env:JWT_SECRET.Trim()) {
  $env:JWT_SECRET
} else {
  $secretBytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($secretBytes)
  } finally {
    $rng.Dispose()
  }
  [Convert]::ToBase64String($secretBytes)
}
$stableBackupRetentionMode = if ($env:BACKUP_RETENTION_MODE -and $env:BACKUP_RETENTION_MODE.Trim()) {
  $env:BACKUP_RETENTION_MODE
} else {
  'report-only'
}
$stableBackupMaxFiles = if ($env:BACKUP_MAX_FILES -and $env:BACKUP_MAX_FILES.Trim()) {
  $env:BACKUP_MAX_FILES
} else {
  '800'
}
$stableBackupMaxTotalMb = if ($env:BACKUP_MAX_TOTAL_MB -and $env:BACKUP_MAX_TOTAL_MB.Trim()) {
  $env:BACKUP_MAX_TOTAL_MB
} else {
  '8192'
}
$stableBlockDemoCredentials = if ($env:AILAODA_BLOCK_DEMO_CREDENTIALS -and $env:AILAODA_BLOCK_DEMO_CREDENTIALS.Trim()) {
  $env:AILAODA_BLOCK_DEMO_CREDENTIALS
} elseif ($isPackagedMode) {
  '1'
} else {
  '1'
}
$previousNodeEnv = $env:NODE_ENV
$previousCorsOrigin = $env:CORS_ORIGIN
$previousDatabaseUrl = $env:DATABASE_URL
$previousJwtSecret = $env:JWT_SECRET
$previousBackupRetentionMode = $env:BACKUP_RETENTION_MODE
$previousBackupMaxFiles = $env:BACKUP_MAX_FILES
$previousBackupMaxTotalMb = $env:BACKUP_MAX_TOTAL_MB
$previousBlockDemoCredentials = $env:AILAODA_BLOCK_DEMO_CREDENTIALS
$previousServeFrontend = $env:SERVE_FRONTEND
$previousPort = $env:PORT
try {
  $env:NODE_ENV = 'production'
  $env:CORS_ORIGIN = $stableCorsOrigin
  $env:DATABASE_URL = $runtimeDbUrl
  $env:JWT_SECRET = $stableJwtSecret
  $env:BACKUP_RETENTION_MODE = $stableBackupRetentionMode
  $env:BACKUP_MAX_FILES = $stableBackupMaxFiles
  $env:BACKUP_MAX_TOTAL_MB = $stableBackupMaxTotalMb
  $env:AILAODA_BLOCK_DEMO_CREDENTIALS = $stableBlockDemoCredentials
  $env:SERVE_FRONTEND = 'true'
  $env:PORT = '5001'

  $server = Start-Process -FilePath $nodeCmd `
    -ArgumentList @($backendDistEntry) `
    -WorkingDirectory $root `
    -RedirectStandardOutput $backendOut `
    -RedirectStandardError $backendErr `
    -PassThru `
    -WindowStyle Hidden
} finally {
  $env:NODE_ENV = $previousNodeEnv
  $env:CORS_ORIGIN = $previousCorsOrigin
  $env:DATABASE_URL = $previousDatabaseUrl
  $env:JWT_SECRET = $previousJwtSecret
  $env:BACKUP_RETENTION_MODE = $previousBackupRetentionMode
  $env:BACKUP_MAX_FILES = $previousBackupMaxFiles
  $env:BACKUP_MAX_TOTAL_MB = $previousBackupMaxTotalMb
  $env:AILAODA_BLOCK_DEMO_CREDENTIALS = $previousBlockDemoCredentials
  $env:SERVE_FRONTEND = $previousServeFrontend
  $env:PORT = $previousPort
}

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

$originOutputDir = Join-Path $root 'output\audit'
New-Item -ItemType Directory -Path $originOutputDir -Force | Out-Null
$listeningPid = $server.Id
try {
  $listener = Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener -and $listener.OwningProcess) {
    $listeningPid = [int]$listener.OwningProcess
  }
} catch {}
$originReport = [ordered]@{
  status = 'passed'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  root = $root
  packagedMode = $isPackagedMode
  systemUrl = 'http://127.0.0.1:5001'
  runtimeDbPath = $runtimeDbPath
  backendPid = $listeningPid
  launcherPid = $server.Id
  frontendDistIndex = $frontendDistIndex
  backendDistEntry = $backendDistEntry
}
$originReport |
  ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath (Join-Path $originOutputDir 'stable-runtime-origin-v1.json') -Encoding UTF8

Write-Host '[7/7] Done'
Write-Host 'System URL: http://127.0.0.1:5001'
Write-Host 'Login with a seeded local account. The launcher no longer prints passwords.'
Write-Host "Runtime DB: $runtimeDbPath"
Write-Host "Backend PID: $($server.Id)"
