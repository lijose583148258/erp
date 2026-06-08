param(
  [string]$TargetBase64 = 'RTpc54ix5Yqz6L6+57qv5YeA57O757uf'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'AilaoDa_Stable_Package'
$target = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TargetBase64))
$targetParent = Split-Path -Parent $target
$targetName = Split-Path -Leaf $target

function Assert-PathNotRoot {
  param([Parameter(Mandatory = $true)][string]$PathValue)
  $full = [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\')
  $rootPath = [System.IO.Path]::GetPathRoot($full).TrimEnd('\')
  if ($full -eq $rootPath) {
    throw "Refuse to deploy to drive root: $full"
  }
}

function Copy-Directory {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing source directory: $Source"
  }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $args = @($Source, $Destination, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1')
  & robocopy @args | Out-Host
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed from $Source to $Destination with exit code $LASTEXITCODE"
  }
}

function Write-ArchiveMarker {
  param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][string]$CurrentPackagePath
  )

  if (-not (Test-Path -LiteralPath $PackagePath -PathType Container)) {
    return
  }

  $markerPath = Join-Path $PackagePath 'DO_NOT_RUN.txt'
  $message = @(
    'ARCHIVED AilaoDa clean runtime package - do not run as the current system.',
    "Archived path: $PackagePath",
    "Current clean runtime path: $CurrentPackagePath",
    'Reason: previous runtime folders are kept for audit/forensics only and can mislead browser tests if launched.',
    'Override only for a deliberate forensic drill: set AILAODA_ALLOW_ARCHIVED_PACKAGE_RUN=1.'
  ) -join [Environment]::NewLine
  Set-Content -LiteralPath $markerPath -Value $message -Encoding UTF8
}

function Copy-File {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [switch]$AllowLockedExisting
  )
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Missing source file: $Source"
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  try {
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
  } catch {
    if ($AllowLockedExisting -and (Test-Path -LiteralPath $Destination -PathType Leaf)) {
      $existing = Get-Item -LiteralPath $Destination
      $bytes = [System.IO.File]::ReadAllBytes($Destination)
      $header = if ($bytes.Length -ge 2) { [System.Text.Encoding]::ASCII.GetString($bytes, 0, 2) } else { '' }
      if ($header -eq 'MZ' -and $existing.Length -gt 8192) {
        Write-Warning "Could not replace locked file, but existing desktop shell is a valid EXE and will be kept: $Destination"
        return
      }
    }
    throw
  }
}

Assert-PathNotRoot -PathValue $target

if (-not (Test-Path -LiteralPath $source)) {
  throw "Missing stable package source: $source"
}
if (-not (Test-Path -LiteralPath (Join-Path $source 'AilaoDa-ERP-CRM.exe'))) {
  throw 'Stable package does not contain AilaoDa-ERP-CRM.exe. Run npm run build:desktop-shell or package-stable first.'
}

if (-not (Test-Path -LiteralPath $targetParent)) {
  New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
}

$inPlaceUpdate = $false
if (Test-Path -LiteralPath $target) {
  $backupName = "${targetName}_previous_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  $backupPath = Join-Path $targetParent $backupName
  Write-Host "Existing clean runtime package found. Preserving it as $backupPath"
  try {
    Rename-Item -LiteralPath $target -NewName $backupName -ErrorAction Stop
    Write-ArchiveMarker -PackagePath $backupPath -CurrentPackagePath $target
  } catch {
    $inPlaceUpdate = $true
    Write-Warning "Could not rename existing clean runtime package. Refreshing it in place instead. Reason: $($_.Exception.Message)"
  }
}

if ($inPlaceUpdate) {
  Write-Host "Refreshing clean runtime package in place: $target"
} else {
  Write-Host "Creating clean runtime package: $target"
}
New-Item -ItemType Directory -Path $target -Force | Out-Null

Copy-Directory -Source (Join-Path $source 'dist') -Destination (Join-Path $target 'dist')
Copy-Directory -Source (Join-Path $source 'backend\dist') -Destination (Join-Path $target 'backend\dist')
Copy-Directory -Source (Join-Path $source 'backend\prisma') -Destination (Join-Path $target 'backend\prisma')
Copy-Directory -Source (Join-Path $source 'backend\node_modules') -Destination (Join-Path $target 'backend\node_modules')
Copy-Directory -Source (Join-Path $source 'scripts') -Destination (Join-Path $target 'scripts')

Copy-File -Source (Join-Path $source 'backend\package.json') -Destination (Join-Path $target 'backend\package.json')
Copy-File -Source (Join-Path $source 'backend\package-lock.json') -Destination (Join-Path $target 'backend\package-lock.json')
Copy-File -Source (Join-Path $source 'AilaoDa-ERP-CRM.exe') -Destination (Join-Path $target 'AilaoDa-ERP-CRM.exe') -AllowLockedExisting
Copy-File -Source (Join-Path $source 'PACKAGE_CONTENTS.txt') -Destination (Join-Path $target 'PACKAGE_CONTENTS.txt')
Copy-File -Source (Join-Path $source '.env.production.example') -Destination (Join-Path $target '.env.production.example')

Get-ChildItem -LiteralPath $source -File -Filter '*.bat' | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $target $_.Name) -Force
}

foreach ($dir in @(
  (Join-Path $target 'backend\logs'),
  (Join-Path $target 'logs'),
  (Join-Path $target 'output\audit'),
  (Join-Path $target 'runtime-data')
)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$jwtSecretBytes = New-Object byte[] 48
$jwtSecretGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $jwtSecretGenerator.GetBytes($jwtSecretBytes)
} finally {
  $jwtSecretGenerator.Dispose()
}
$generatedJwtSecret = [Convert]::ToBase64String($jwtSecretBytes)

$envProduction = @(
  'NODE_ENV=production',
  'AILAODA_DEPLOYMENT_MODE=local',
  'PORT=5001',
  "JWT_SECRET=$generatedJwtSecret",
  'SERVE_FRONTEND=true',
  'FRONTEND_DIST_DIR=dist',
  'AILAODA_RUNTIME_DB_PATH=D:\AilaoDaRuntime\stable.db',
  'BACKUP_DIR=D:\AilaoDaRuntime\backups',
  'UPLOAD_DIR=D:\AilaoDaRuntime\uploads',
  'LOG_DIR=D:\AilaoDaRuntime\logs',
  'CORS_ORIGIN=http://127.0.0.1:5001,http://localhost:5001'
)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $target '.env.production'), (($envProduction -join "`n") + "`n"), $utf8NoBom)

$manifest = [ordered]@{
  name = 'AilaoDa Clean Runtime Package'
  version = '1.0'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  source = $source
  target = $target
  entryExe = (Join-Path $target 'AilaoDa-ERP-CRM.exe')
  entryUrl = 'http://127.0.0.1:5001/'
  runtimeDb = 'D:\AilaoDaRuntime\stable.db'
  runtimeDataRoot = 'D:\AilaoDaRuntime'
  policy = 'Program files live under target. Business data, uploads, backups, and logs live under D:\AilaoDaRuntime.'
  copiedScopes = @('dist', 'backend/dist', 'backend/prisma', 'backend/node_modules', 'scripts', 'launchers', 'desktop-shell-exe')
  excludedScopes = @('old output reports', 'old logs', 'old backups', 'old runtime uploads', 'source pages/components/services')
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'PURE_RUNTIME_PACKAGE.json') -Encoding UTF8

[PSCustomObject]@{
  status = 'passed'
  source = $source
  target = $target
  exe = Join-Path $target 'AilaoDa-ERP-CRM.exe'
  runtimeDb = 'D:\AilaoDaRuntime\stable.db'
} | ConvertTo-Json -Depth 4
