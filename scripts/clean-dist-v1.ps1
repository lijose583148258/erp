$ErrorActionPreference = 'Stop'

$workspace = (Resolve-Path -LiteralPath (Get-Location).Path).Path
$target = Join-Path -Path $workspace -ChildPath 'dist'

if (-not $target.StartsWith($workspace + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Refusing to clean path outside workspace: $target"
}

if ($target -eq $workspace -or [System.IO.Path]::GetPathRoot($target) -eq $target) {
  throw "Refusing to clean unsafe root path: $target"
}

if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}

New-Item -ItemType Directory -Path $target -Force | Out-Null
Write-Output "{""status"":""passed"",""cleaned"":""$target""}"
