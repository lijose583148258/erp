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

if (Test-Path -LiteralPath $dest) {
  $backupName = "${destName}_previous_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  $backupPath = Join-Path $root $backupName
  Write-Host "Existing package found. Preserving it as $backupName"
  Rename-Item -LiteralPath $dest -NewName $backupName -ErrorAction Stop
}

Write-Host 'Creating stable package layout...'
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
Copy-Item -LiteralPath (Join-Path $root $mainLauncherName) -Destination (Join-Path $dest $mainLauncherName) -Force
Copy-Item -LiteralPath (Join-Path $root $stableLauncherName) -Destination (Join-Path $dest $stableLauncherName) -Force
Copy-Item -LiteralPath (Join-Path $root 'scripts\start-stable-v2.ps1') -Destination (Join-Path $dest 'scripts\start-stable-v2.ps1') -Force
Copy-Item -LiteralPath (Join-Path $root 'scripts\stop-runtime.ps1') -Destination (Join-Path $dest 'scripts\stop-runtime.ps1') -Force
Copy-Item -LiteralPath (Join-Path $root 'scripts\check-runtime.ps1') -Destination (Join-Path $dest 'scripts\check-runtime.ps1') -Force

Write-Host ''
Write-Host "Package complete: $dest"
Write-Host "Entry: $(Join-Path $dest $mainLauncherName)"
