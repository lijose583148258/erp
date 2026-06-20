param(
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path -Parent $PSScriptRoot
$reportDir = Join-Path $repoRoot 'output\audit'
$reportPath = Join-Path $reportDir 'archived-runtime-package-isolation-v1.json'
$mainLauncherName = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5ZCv5Yqo57O757ufLmJhdA=='))
$stableLauncherName = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('56iz5a6a5ZCv5YqoLmJhdA=='))

function Get-ArchiveDirectories {
  $items = @()
  $items += Get-ChildItem -LiteralPath $repoRoot -Directory -Filter 'AilaoDa_Stable_Package_previous_*' -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath 'E:\') {
    $items += Get-ChildItem -LiteralPath 'E:\' -Directory -Filter '爱劳达纯净系统_previous_*' -ErrorAction SilentlyContinue
  }
  return @($items | Sort-Object FullName -Unique)
}

function Assert-ArchivePath {
  param([Parameter(Mandatory = $true)][string]$PathValue)
  $full = [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\')
  $leaf = Split-Path -Leaf $full
  $isRepoArchive = $full.StartsWith(([System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\') + '\')) -and $leaf.StartsWith('AilaoDa_Stable_Package_previous_')
  $isCleanArchive = $full.StartsWith('E:\') -and $leaf.StartsWith('爱劳达纯净系统_previous_')
  if (-not ($isRepoArchive -or $isCleanArchive)) {
    throw "Refuse to isolate non-archive path: $full"
  }
}

function Write-TextFile {
  param(
    [Parameter(Mandatory = $true)][string]$PathValue,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($PathValue, $Content, $utf8NoBom)
}

function Backup-Then-Replace {
  param(
    [Parameter(Mandatory = $true)][string]$PathValue,
    [Parameter(Mandatory = $true)][string]$Replacement
  )
  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
    return $false
  }
  $backupPath = "$PathValue.before-archive-isolation"
  if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
    Copy-Item -LiteralPath $PathValue -Destination $backupPath -Force
  }
  Write-TextFile -PathValue $PathValue -Content $Replacement
  return $true
}

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null

$archives = Get-ArchiveDirectories
$entries = @()
$batchStub = @'
@echo off
chcp 65001 >nul
echo This is an archived AilaoDa package.
echo It is kept only for audit and forensic comparison.
echo Use the current clean runtime package: E:\爱劳达纯净系统
echo.
pause
exit /b 1
'@
$psStub = @'
throw "This is an archived AilaoDa package kept only for audit/forensics. Use E:\爱劳达纯净系统 for the current runtime. Set AILAODA_ALLOW_ARCHIVED_PACKAGE_RUN=1 only for a deliberate forensic drill."
'@

foreach ($archive in $archives) {
  Assert-ArchivePath -PathValue $archive.FullName
  $entry = [ordered]@{
    path = $archive.FullName
    marker = $false
    launchersPatched = @()
    startScriptPatched = $false
    mode = if ($Apply) { 'apply' } else { 'dry-run' }
  }

  if ($Apply) {
    $marker = Join-Path $archive.FullName 'DO_NOT_RUN.txt'
    $markerText = @(
      'ARCHIVED AilaoDa package - do not run as the current system.',
      "Archived path: $($archive.FullName)",
      'Current runtime: E:\爱劳达纯净系统',
      'Reason: archived packages can mislead browser tests and occupy port 5001.',
      'Original launchers are preserved with .before-archive-isolation suffix when patched.'
    ) -join [Environment]::NewLine
    Write-TextFile -PathValue $marker -Content $markerText
    $entry.marker = $true

    foreach ($launcher in @($mainLauncherName, $stableLauncherName)) {
      $launcherPath = Join-Path $archive.FullName $launcher
      if (Backup-Then-Replace -PathValue $launcherPath -Replacement $batchStub) {
        $entry.launchersPatched += $launcher
      }
    }

    $startScript = Join-Path $archive.FullName 'scripts\start-stable-v2.ps1'
    $entry.startScriptPatched = Backup-Then-Replace -PathValue $startScript -Replacement $psStub
  }

  $entries += [pscustomobject]$entry
}

$result = [ordered]@{
  status = 'passed'
  apply = [bool]$Apply
  scanned = $archives.Count
  isolated = if ($Apply) { @($entries | Where-Object { $_.marker }).Count } else { 0 }
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  entries = $entries
}

Write-TextFile -PathValue $reportPath -Content ($result | ConvertTo-Json -Depth 6)
$result | ConvertTo-Json -Depth 6
