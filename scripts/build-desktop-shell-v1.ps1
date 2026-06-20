$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'desktop-shell\AilaoDaLauncher.cs'
$packageRoot = Join-Path $root 'AilaoDa_Stable_Package'
$outputExe = Join-Path $packageRoot 'AilaoDa-ERP-CRM.exe'

function Get-CSharpCompiler {
  $candidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  throw 'C# compiler not found. Expected .NET Framework csc.exe under Windows\Microsoft.NET.'
}

if (-not (Test-Path -LiteralPath $source)) {
  throw "Missing desktop shell source: $source"
}
if (-not (Test-Path -LiteralPath $packageRoot)) {
  throw "Missing stable package directory: $packageRoot"
}

$csc = Get-CSharpCompiler
Write-Host "Using compiler: $csc"
Write-Host "Building desktop shell: $outputExe"

& $csc `
  /nologo `
  /target:winexe `
  /platform:anycpu `
  /optimize+ `
  /reference:System.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  /out:$outputExe `
  $source

if ($LASTEXITCODE -ne 0) {
  throw "Desktop shell compile failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $outputExe)) {
  throw "Desktop shell executable was not created: $outputExe"
}

$item = Get-Item -LiteralPath $outputExe
[PSCustomObject]@{
  status = 'passed'
  exe = $item.FullName
  bytes = $item.Length
  lastWriteTime = $item.LastWriteTimeUtc.ToString('o')
} | ConvertTo-Json -Depth 4
