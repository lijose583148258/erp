param(
  [string]$RuntimeRoot = 'C:\AilaoDaBomGridPoc',
  [string]$DatabaseUrl = 'file:C:/AilaoDaBomGridPoc/stable.db'
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

function Assert-PortAvailable {
  param([int]$Port)
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    throw "Port $Port is already owned by PID $($listener.OwningProcess): $($owner.CommandLine)"
  }
}

function Get-ProcessIdentity {
  param([int]$ProcessId)
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
  return [pscustomobject]@{
    pid = $ProcessId
    commandLine = [string]$processInfo.CommandLine
    executablePath = [string]$processInfo.ExecutablePath
    creationDate = ([datetime]$processInfo.CreationDate).ToUniversalTime().ToString('o')
  }
}

function Test-ProcessIdentity {
  param($Identity)
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($Identity.pid)" -ErrorAction SilentlyContinue
  if (-not $current) {
    return $false
  }
  $currentCreationDate = ([datetime]$current.CreationDate).ToUniversalTime().ToString('o')
  return (
    [string]$current.CommandLine -eq [string]$Identity.commandLine `
    -and [string]$current.ExecutablePath -eq [string]$Identity.executablePath `
    -and $currentCreationDate -eq [string]$Identity.creationDate
  )
}

function Stop-OwnedProcessTree {
  param($Identity)
  if (-not (Test-ProcessIdentity -Identity $Identity)) {
    return
  }
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($Identity.pid)" -ErrorAction SilentlyContinue)
  foreach ($child in $children) {
    $childIdentity = Get-ProcessIdentity -ProcessId ([int]$child.ProcessId)
    Stop-OwnedProcessTree -Identity $childIdentity
  }
  Stop-Process -Id ([int]$Identity.pid) -Force -ErrorAction SilentlyContinue
}

Assert-PortAvailable -Port 5001
Assert-PortAvailable -Port 3000

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

$ownedIdentities = @()
try {
  $backend = Start-Process `
    -FilePath 'node.exe' `
    -ArgumentList 'backend/dist/server.js' `
    -WorkingDirectory $workspace `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $RuntimeRoot 'backend.out.log') `
    -RedirectStandardError (Join-Path $RuntimeRoot 'backend.err.log') `
    -PassThru
  $ownedIdentities += Get-ProcessIdentity -ProcessId $backend.Id

  $frontend = Start-Process `
    -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--force') `
    -WorkingDirectory $workspace `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $RuntimeRoot 'frontend.out.log') `
    -RedirectStandardError (Join-Path $RuntimeRoot 'frontend.err.log') `
    -PassThru
  $ownedIdentities += Get-ProcessIdentity -ProcessId $frontend.Id

  Start-Sleep -Seconds 3
  $backendListenerPid = (Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
  $frontendListenerPid = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
  foreach ($listenerPid in @($backendListenerPid, $frontendListenerPid) | Where-Object { $_ }) {
    if (-not ($ownedIdentities | Where-Object { [int]$_.pid -eq [int]$listenerPid })) {
      $ownedIdentities += Get-ProcessIdentity -ProcessId ([int]$listenerPid)
    }
  }
  if (-not $backendListenerPid -or -not $frontendListenerPid) {
    throw 'BOM Grid Lab runtime did not bind ports 5001 and 3000 within the startup window.'
  }

  @{
    backendPid = [int]$backendListenerPid
    frontendPid = [int]$frontendListenerPid
    backendLauncherPid = $backend.Id
    frontendLauncherPid = $frontend.Id
    workspace = $workspace
    identities = $ownedIdentities
    startedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $RuntimeRoot 'pids.json')

  Get-Content (Join-Path $RuntimeRoot 'pids.json')
} catch {
  foreach ($identity in $ownedIdentities) {
    Stop-OwnedProcessTree -Identity $identity
  }
  throw
}
