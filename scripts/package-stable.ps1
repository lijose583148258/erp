param(
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$destName = 'AilaoDa_Stable_Package'
$dest = Join-Path $root $destName

function ConvertFrom-Utf8Base64 {
  param([Parameter(Mandatory = $true)][string]$Value)
  return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

$mainLauncherName = ConvertFrom-Utf8Base64 '5ZCv5Yqo57O757ufLmJhdA=='
$stableLauncherName = ConvertFrom-Utf8Base64 '56iz5a6a5ZCv5YqoLmJhdA=='

function Copy-Directory {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing source directory: $Source"
  }

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
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
    'ARCHIVED AilaoDa stable package - do not run as the current system.',
    "Archived path: $PackagePath",
    "Current package path: $CurrentPackagePath",
    'Reason: previous packages are kept for audit/forensics only and can mislead browser tests if launched.',
    'Override only for a deliberate forensic drill: set AILAODA_ALLOW_ARCHIVED_PACKAGE_RUN=1.'
  ) -join [Environment]::NewLine
  Set-Content -LiteralPath $markerPath -Value $message -Encoding UTF8
}

function Get-ExistingFiles {
  param([Parameter(Mandatory = $true)][string[]]$Paths)

  $files = @()
  foreach ($item in $Paths) {
    if ($item -match '[\*\?]') {
      $matches = @(Get-ChildItem -Path $item -File -ErrorAction SilentlyContinue)
      $files += $matches
      continue
    }

    if (Test-Path -LiteralPath $item -PathType Leaf) {
      $files += Get-Item -LiteralPath $item
    } elseif (Test-Path -LiteralPath $item -PathType Container) {
      $files += Get-ChildItem -LiteralPath $item -Recurse -File -ErrorAction SilentlyContinue
    }
  }

  return @($files)
}

function Get-NewestSourceTimeUtc {
  param([Parameter(Mandatory = $true)][string[]]$Paths)

  $files = @(Get-ExistingFiles -Paths $Paths)
  if ($files.Count -eq 0) {
    throw "No source files found for freshness check."
  }

  return ($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
}

function Get-NewestArtifactTimeUtc {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string[]]$Patterns
  )

  $files = @()
  foreach ($pattern in $Patterns) {
    $matches = @(Get-ExistingFiles -Paths @($pattern))
    if ($matches.Count -eq 0) {
      throw "Missing $Name artifact: $pattern"
    }
    $files += $matches
  }

  return ($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
}

function Assert-ArtifactFresh {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string[]]$ArtifactPatterns,
    [Parameter(Mandatory = $true)][string[]]$SourcePaths,
    [Parameter(Mandatory = $true)][string]$BuildCommand
  )

  $artifactTime = Get-NewestArtifactTimeUtc -Name $Name -Patterns $ArtifactPatterns
  $sourceTime = Get-NewestSourceTimeUtc -Paths $SourcePaths

  if ($sourceTime -gt $artifactTime) {
    throw "$Name package artifacts are stale. Newest source=$($sourceTime.ToString('o')), newest artifact=$($artifactTime.ToString('o')). Run $BuildCommand before packaging."
  }

  Write-Host "$Name freshness OK. source=$($sourceTime.ToString('s')) artifact=$($artifactTime.ToString('s'))"
}

function Assert-PackageFreshness {
  Write-Host 'Checking package freshness gates...'

  $frontendSources = @(
    (Join-Path $root 'App.tsx'),
    (Join-Path $root 'main.tsx'),
    (Join-Path $root 'index.html'),
    (Join-Path $root 'index.css'),
    (Join-Path $root 'vite.config.ts'),
    (Join-Path $root 'tailwind.config.cjs'),
    (Join-Path $root 'package.json'),
    (Join-Path $root 'components'),
    (Join-Path $root 'config'),
    (Join-Path $root 'hooks'),
    (Join-Path $root 'pages'),
    (Join-Path $root 'services'),
    (Join-Path $root 'translations'),
    (Join-Path $root 'types'),
    (Join-Path $root 'utils')
  )

  $backendSources = @(
    (Join-Path $root 'backend\src'),
    (Join-Path $root 'backend\prisma'),
    (Join-Path $root 'backend\package.json'),
    (Join-Path $root 'backend\tsconfig.json')
  )

  Assert-ArtifactFresh `
    -Name 'frontend' `
    -ArtifactPatterns @(
      (Join-Path $root 'dist\index.html'),
      (Join-Path $root 'dist\assets\index-*.js'),
      (Join-Path $root 'dist\assets\index-*.css')
    ) `
    -SourcePaths $frontendSources `
    -BuildCommand 'npm run build'

  Assert-ArtifactFresh `
    -Name 'backend' `
    -ArtifactPatterns @((Join-Path $root 'backend\dist\server.js')) `
    -SourcePaths $backendSources `
    -BuildCommand 'npm run build:backend'

  if ($CheckOnly -and (Test-Path -LiteralPath $dest)) {
    Assert-ArtifactFresh `
      -Name 'stable package launcher chain' `
      -ArtifactPatterns @(
        (Join-Path $dest $mainLauncherName),
        (Join-Path $dest $stableLauncherName),
        (Join-Path $dest 'scripts\start-stable-v2.ps1'),
        (Join-Path $dest 'scripts\stop-runtime.ps1'),
        (Join-Path $dest 'scripts\check-runtime.ps1')
      ) `
      -SourcePaths @(
        (Join-Path $root 'scripts\start-stable-v2.ps1'),
        (Join-Path $root 'scripts\stop-runtime.ps1'),
        (Join-Path $root 'scripts\check-runtime.ps1'),
        (Join-Path $root 'scripts\package-stable.ps1'),
        (Join-Path $root '.env.production.example')
      ) `
      -BuildCommand 'powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-stable.ps1'

    $desktopShellSource = Join-Path $root 'desktop-shell\AilaoDaLauncher.cs'
    if (Test-Path -LiteralPath $desktopShellSource) {
      Assert-ArtifactFresh `
        -Name 'desktop shell' `
        -ArtifactPatterns @((Join-Path $dest 'AilaoDa-ERP-CRM.exe')) `
        -SourcePaths @(
          $desktopShellSource,
          (Join-Path $root 'scripts\build-desktop-shell-v1.ps1')
        ) `
        -BuildCommand 'npm run build:desktop-shell'
    }
  } elseif ($CheckOnly) {
    Write-Host 'Stable package launcher freshness skipped because package does not exist yet.'
  }

  Write-Host 'Package freshness gates passed.'
}

Assert-PackageFreshness

if ($CheckOnly) {
  Write-Host 'Check-only mode complete. No package files were copied or renamed.'
  exit 0
}

$inPlaceUpdate = $false
if (Test-Path -LiteralPath $dest) {
  $backupName = "${destName}_previous_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  $backupPath = Join-Path $root $backupName
  Write-Host "Existing package found. Preserving it as $backupName"
  try {
    Rename-Item -LiteralPath $dest -NewName $backupName -ErrorAction Stop
    Write-ArchiveMarker -PackagePath $backupPath -CurrentPackagePath $dest
  } catch {
    # Windows can keep the runtime package directory locked while the local shell,
    # antivirus, or a just-stopped Node process still holds a handle. Do not delete
    # or force-unlock it; update the existing package in place instead.
    $inPlaceUpdate = $true
    Write-Warning "Could not rename existing package. Updating it in place instead. Reason: $($_.Exception.Message)"
  }
}

if ($inPlaceUpdate) {
  Write-Host 'Refreshing stable package layout in place...'
} else {
  Write-Host 'Creating stable package layout...'
}
New-Item -ItemType Directory -Path $dest -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dest 'dist') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dest 'backend') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dest 'backend\dist') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dest 'backend\prisma') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dest 'scripts') -Force | Out-Null

Write-Host 'Copying frontend dist...'
Copy-Directory -Source (Join-Path $root 'dist') -Destination (Join-Path $dest 'dist')

Write-Host 'Copying backend dist...'
Copy-Directory -Source (Join-Path $root 'backend\dist') -Destination (Join-Path $dest 'backend\dist')

Write-Host 'Copying backend runtime files...'
Copy-Item -LiteralPath (Join-Path $root 'backend\package.json') -Destination (Join-Path $dest 'backend\package.json') -Force
Copy-Item -LiteralPath (Join-Path $root 'backend\package-lock.json') -Destination (Join-Path $dest 'backend\package-lock.json') -Force
Copy-Directory -Source (Join-Path $root 'backend\prisma') -Destination (Join-Path $dest 'backend\prisma')

Write-Host 'Copying backend node_modules. This may take a while...'
$robocopyArgs = @(
  (Join-Path $root 'backend\node_modules'),
  (Join-Path $dest 'backend\node_modules'),
  '/E',
  '/NFL',
  '/NDL',
  '/NJH',
  '/NJS',
  '/R:1',
  '/W:1'
)
& robocopy @robocopyArgs | Out-Host
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}

Write-Host 'Copying stable launcher chain...'
$packageMainLauncher = @(
  '@echo off',
  'chcp 65001 >nul',
  'echo ========================================',
  'echo AilaoDa ERP+CRM local stable shell',
  'echo ========================================',
  'echo.',
  'echo Entry: http://127.0.0.1:5001/',
  'echo Runtime DB: D:\AilaoDaRuntime\stable.db',
  'echo This package shell only starts the stable 5001 entry.',
  'echo.',
  "call ""%~dp0$stableLauncherName""",
  'exit /b %errorlevel%'
)
$packageStableLauncher = @(
  '@echo off',
  'chcp 65001 >nul',
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-stable-v2.ps1"',
  'if errorlevel 1 (',
  '  echo Stable startup failed. Check the message above.',
  '  pause',
  '  exit /b 1',
  ')',
  'echo.',
  'echo Opening AilaoDa stable entry: http://127.0.0.1:5001/',
  'start "" "http://127.0.0.1:5001/"',
  'pause'
)
$packageMainLauncher | Set-Content -LiteralPath (Join-Path $dest $mainLauncherName) -Encoding UTF8
$packageStableLauncher | Set-Content -LiteralPath (Join-Path $dest $stableLauncherName) -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $root 'scripts\start-stable-v2.ps1') -Destination (Join-Path $dest 'scripts\start-stable-v2.ps1') -Force
Copy-Item -LiteralPath (Join-Path $root 'scripts\stop-runtime.ps1') -Destination (Join-Path $dest 'scripts\stop-runtime.ps1') -Force
Copy-Item -LiteralPath (Join-Path $root 'scripts\check-runtime.ps1') -Destination (Join-Path $dest 'scripts\check-runtime.ps1') -Force

$desktopShellBuilder = Join-Path $root 'scripts\build-desktop-shell-v1.ps1'
$desktopShellSource = Join-Path $root 'desktop-shell\AilaoDaLauncher.cs'
if ((Test-Path -LiteralPath $desktopShellBuilder) -and (Test-Path -LiteralPath $desktopShellSource)) {
  Write-Host 'Building desktop shell EXE...'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $desktopShellBuilder | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop shell build failed with exit code $LASTEXITCODE"
  }
}

$envExample = Join-Path $root '.env.production.example'
if (Test-Path -LiteralPath $envExample) {
  Copy-Item -LiteralPath $envExample -Destination (Join-Path $dest '.env.production.example') -Force
}

$packageManifest = @(
  'AilaoDa stable package whitelist',
  '',
  'Included runtime files:',
  '- dist/',
  '- backend/dist/',
  '- backend/prisma/',
  '- backend/package.json',
  '- backend/package-lock.json',
  '- backend/node_modules/',
  '- scripts/start-stable-v2.ps1',
  '- scripts/stop-runtime.ps1',
  '- scripts/check-runtime.ps1',
  '- AilaoDa-ERP-CRM.exe',
  '- .env.production.example',
  '',
  'Excluded by design:',
  '- source pages/components/services',
  '- output/logs/backups/user runtime database',
  '- historical packages and governance archives',
  '',
  'Writable runtime data must stay outside this package, for example D:\AilaoDaRuntime\stable.db.'
)
$packageManifest | Set-Content -LiteralPath (Join-Path $dest 'PACKAGE_CONTENTS.txt') -Encoding UTF8

Write-Host ''
Write-Host "Package complete: $dest"
Write-Host "Entry: $(Join-Path $dest $mainLauncherName)"
