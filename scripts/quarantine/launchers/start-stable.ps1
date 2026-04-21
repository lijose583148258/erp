$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'start-stable-v2.ps1'
if (-not (Test-Path $target)) {
  throw "Stable launcher target not found: $target"
}
Write-Host 'Deprecated launcher redirected to start-stable-v2.ps1'
& $target
