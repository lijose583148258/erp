param(
  [string]$SourceBase64 = 'RTpc54ix5Yqz6L6+57qv5YeA57O757uf',
  [string]$PackageNameBase64 = '54ix5Yqz6L6+57qv5YeA57O757uf'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$source = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($SourceBase64))
$packageName = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PackageNameBase64))
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$packageDir = Join-Path $root 'output\packages'
$stagingRoot = Join-Path $root 'output\package-staging'
$stagingSession = Join-Path $stagingRoot "zip_staging_$stamp"
$staging = Join-Path $stagingSession $packageName
$zip = Join-Path $packageDir "$packageName`_$stamp.zip"

function Assert-PathUnder {
  param(
    [Parameter(Mandatory = $true)][string]$PathValue,
    [Parameter(Mandatory = $true)][string]$AllowedRoot
  )
  $full = [System.IO.Path]::GetFullPath($PathValue)
  $rootFull = [System.IO.Path]::GetFullPath($AllowedRoot)
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refuse unsafe path outside allowed root: $full"
  }
}

function Remove-PackagedDatabaseFiles {
  param([Parameter(Mandatory = $true)][string]$Directory)
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { return }
  Get-ChildItem -LiteralPath $Directory -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '\.db($|-journal$|-wal$|-shm$)' } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "Missing clean runtime package source: $source"
}

New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
Assert-PathUnder -PathValue $stagingSession -AllowedRoot $stagingRoot
if (Test-Path -LiteralPath $stagingSession) {
  Remove-Item -LiteralPath $stagingSession -Recurse -Force
}
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$excludedDirs = @(
  (Join-Path $source 'logs'),
  (Join-Path $source 'output'),
  (Join-Path $source 'runtime-data'),
  (Join-Path $source 'backend\logs')
)
$robocopyArgs = @(
  $source,
  $staging,
  '/E',
  '/NFL',
  '/NDL',
  '/NJH',
  '/NJS',
  '/R:1',
  '/W:1',
  '/XD'
) + $excludedDirs
& robocopy @robocopyArgs | Out-Host
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}

foreach ($dir in @('logs', 'output\audit', 'runtime-data', 'backend\logs')) {
  New-Item -ItemType Directory -Path (Join-Path $staging $dir) -Force | Out-Null
}

$prismaDir = Join-Path $staging 'backend\prisma'
Remove-PackagedDatabaseFiles -Directory $prismaDir
$dbFiles = @(Get-ChildItem -LiteralPath $prismaDir -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '\.db($|-journal$|-wal$|-shm$)' })
if ($dbFiles.Count -gt 0) {
  throw "Staging still contains SQLite database files: $($dbFiles[0].FullName)"
}

Compress-Archive -LiteralPath $staging -DestinationPath $zip -CompressionLevel Optimal -Force
$hash = Get-FileHash -LiteralPath $zip -Algorithm SHA256
$item = Get-Item -LiteralPath $zip

[PSCustomObject]@{
  status = 'passed'
  source = $source
  packageName = $packageName
  staging = $staging
  zip = $item.FullName
  mb = [Math]::Round($item.Length / 1MB, 2)
  sha256 = $hash.Hash
} | ConvertTo-Json -Depth 4
