param(
  [string]$RuntimeRoot = 'C:\AilaoDaBomGridPoc',
  [string]$DatabaseUrl = 'file:C:/AilaoDaBomGridPoc/stable.db'
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

$secretFile = Join-Path $RuntimeRoot 'jwt-secret.txt'
if (-not (Test-Path -LiteralPath $secretFile)) {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  [Convert]::ToBase64String($bytes) | Set-Content -Encoding ascii -NoNewline $secretFile
}
$env:DATABASE_URL = $DatabaseUrl
$env:JWT_SECRET = (Get-Content -Raw -LiteralPath $secretFile).Trim()
$env:NODE_ENV = 'development'
$env:PORT = '5001'
$env:VITE_BOM_GRID_LAB_ENABLED = 'true'

$backend = Start-Process `
  -FilePath 'node.exe' `
  -ArgumentList 'backend/dist/server.js' `
  -WorkingDirectory $workspace `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $RuntimeRoot 'backend.out.log') `
  -RedirectStandardError (Join-Path $RuntimeRoot 'backend.err.log') `
  -PassThru

$frontend = Start-Process `
  -FilePath 'npm.cmd' `
  -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--force') `
  -WorkingDirectory $workspace `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $RuntimeRoot 'frontend.out.log') `
  -RedirectStandardError (Join-Path $RuntimeRoot 'frontend.err.log') `
  -PassThru

Start-Sleep -Seconds 3
$backendListenerPid = (Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
$frontendListenerPid = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if (-not $backendListenerPid -or -not $frontendListenerPid) {
  throw 'BOM Grid Lab runtime did not bind ports 5001 and 3000 within the startup window.'
}

@{
  backendPid = [int]$backendListenerPid
  frontendPid = [int]$frontendListenerPid
  backendLauncherPid = $backend.Id
  frontendLauncherPid = $frontend.Id
  startedAt = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $RuntimeRoot 'pids.json')

Get-Content (Join-Path $RuntimeRoot 'pids.json')
