param(
  [string]$RuntimeRoot = 'C:\AilaoDaPostgresRehearsal',
  [string]$ArtifactRoot = '',
  [int[]]$Ports = @(5006, 5008)
)

$ErrorActionPreference = 'Stop'

function Assert-AsciiRuntimePath([string]$PathValue, [string]$Name) {
  $fullPath = [System.IO.Path]::GetFullPath($PathValue)
  if ($fullPath -match '[^\x00-\x7F]') {
    throw "$Name must use an ASCII-only path on Windows. Source code may stay in a Unicode path, but native PostgreSQL runtime data must not: $fullPath"
  }
  return $fullPath
}

$RuntimeRoot = Assert-AsciiRuntimePath $RuntimeRoot 'RuntimeRoot'
if (-not $ArtifactRoot) {
  $ArtifactRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'output\postgres-server-artifact'
}
$ArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)
if (-not (Test-Path -LiteralPath $ArtifactRoot -PathType Container)) {
  throw "Enterprise artifact root does not exist: $ArtifactRoot"
}
$ArtifactRoot = (Resolve-Path -LiteralPath $ArtifactRoot).Path.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$RuntimeOwnerDir = Join-Path $RuntimeRoot 'run'
if (-not (Test-Path -LiteralPath $RuntimeOwnerDir)) {
  New-Item -ItemType Directory -Path $RuntimeOwnerDir -Force | Out-Null
}

function Assert-OwnedEnterpriseListener([int]$Port, [int]$ListenerProcessId) {
  $pidPath = Join-Path $RuntimeOwnerDir "otel-app-$Port.pid"
  $ownerPath = Join-Path $RuntimeOwnerDir "otel-app-$Port.owner.json"
  if (-not (Test-Path -LiteralPath $pidPath) -or -not (Test-Path -LiteralPath $ownerPath)) {
    throw "Refusing to stop process $ListenerProcessId on port $Port without AilaoDa PID and owner records."
  }

  $recordedPid = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$recordedPid) -or $recordedPid -ne $ListenerProcessId) {
    throw "Refusing to stop process $ListenerProcessId on port $Port because its PID record does not match."
  }

  try {
    $owner = Get-Content -LiteralPath $ownerPath -Raw | ConvertFrom-Json
  } catch {
    throw "Refusing to stop process $ListenerProcessId on port $Port because its owner record is invalid."
  }
  if ([int]$owner.processId -ne $ListenerProcessId) {
    throw "Refusing to stop process $ListenerProcessId on port $Port because its owner process ID does not match."
  }
  if (-not [string]$owner.artifactRoot) {
    throw "Refusing to stop process $ListenerProcessId on port $Port because its owner artifact root is missing."
  }
  try {
    $recordedArtifactRoot = [System.IO.Path]::GetFullPath([string]$owner.artifactRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  } catch {
    throw "Refusing to stop process $ListenerProcessId on port $Port because its owner artifact root is invalid."
  }
  if (-not $recordedArtifactRoot.Equals($ArtifactRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to stop process $ListenerProcessId on port $Port because it belongs to another artifact root: $recordedArtifactRoot"
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ListenerProcessId"
  if (-not $process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notlike '*backend/dist/server.js*') {
    throw "Refusing to stop unexpected process $ListenerProcessId on port $Port."
  }
  return [pscustomobject]@{ PidPath = $pidPath; OwnerPath = $ownerPath }
}

function Read-Secret([string]$RelativePath) {
  $path = Join-Path $RuntimeRoot $RelativePath
  if (-not (Test-Path -LiteralPath $path)) { throw "Required sandbox secret is missing: $path" }
  return (Get-Content -LiteralPath $path -Raw).Trim()
}

foreach ($port in $Ports) {
  $connections = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  if ($connections.Count -eq 0) { continue }
  $listenerProcessIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($listenerProcessIds.Count -ne 1) {
    throw "Refusing to stop port $port because it has multiple listener owners: $($listenerProcessIds -join ', ')"
  }
  $listenerProcessId = [int]$listenerProcessIds[0]
  $ownership = Assert-OwnedEnterpriseListener -Port $port -ListenerProcessId $listenerProcessId
  Stop-Process -Id $listenerProcessId -Force
  Wait-Process -Id $listenerProcessId -Timeout 10 -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ownership.PidPath -Force
  Remove-Item -LiteralPath $ownership.OwnerPath -Force
}

$postgresPassword = [uri]::EscapeDataString((Read-Secret '.pg-password.txt'))
$environment = @{
  NODE_ENV = 'production'
  AILAODA_DEPLOYMENT_MODE = 'saas'
  AILAODA_PRISMA_PROVIDER = 'postgresql'
  SERVE_FRONTEND = 'true'
  DATABASE_URL = "postgresql://ailaoda:$postgresPassword@127.0.0.1:55432/ailaoda?schema=public"
  JWT_SECRET = Read-Secret '.jwt-secret.txt'
  REDIS_URL = ''
  REDIS_SENTINELS = '127.0.0.1:26379,127.0.0.1:26380,127.0.0.1:26381'
  REDIS_MASTER_NAME = 'ailaoda-primary'
  REDIS_PASSWORD = Read-Secret '.redis-password.txt'
  CACHE_DRIVER = 'redis'
  AUTH_TOKEN_STORE_DRIVER = 'redis'
  LOGIN_RATE_LIMIT_STORE = 'redis'
  API_RATE_LIMIT_MAX = '10000'
  API_RATE_LIMIT_WINDOW_MS = '900000'
  REALTIME_BUS_DRIVER = 'redis'
  FILE_STORAGE_DRIVER = 's3'
  S3_ENDPOINT = 'http://127.0.0.1:9000'
  S3_ENDPOINTS = 'http://127.0.0.1:9010'
  S3_MIN_WRITE_SUCCESSES = '2'
  S3_REQUEST_TIMEOUT_MS = '1500'
  S3_REGION = 'us-east-1'
  S3_BUCKET = 'ailaoda-files'
  S3_ACCESS_KEY_ID = 'ailaoda'
  S3_SECRET_ACCESS_KEY = Read-Secret '.minio-secret.txt'
  S3_FORCE_PATH_STYLE = 'true'
  SEARCH_DRIVER = 'meilisearch'
  SEARCH_ENDPOINT = 'http://127.0.0.1:7700'
  SEARCH_ENDPOINTS = 'http://127.0.0.1:7710'
  MEILISEARCH_API_KEY = Read-Secret '.meilisearch-master-key.txt'
  SEARCH_REQUEST_TIMEOUT_MS = '1500'
  SEARCH_RESULT_CACHE_TTL_SECONDS = '5'
  OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4318'
  OTEL_SERVICE_NAME = 'ailaoda-erp-crm'
  AILAODA_METRICS_BEARER_TOKEN = Read-Secret 'observability\metrics-bearer-token.txt'
  AI_GATEWAY_EXTERNAL_ENABLED = 'false'
  AI_GATEWAY_ENDPOINT = ''
  AI_GATEWAY_ALLOWED_HOSTS = ''
  AI_GATEWAY_MODEL = ''
  AI_GATEWAY_TIMEOUT_MS = '12000'
  AI_GATEWAY_MAX_TOKENS = '500'
  AI_DAILY_TOKEN_BUDGET = '50000'
  AI_CIRCUIT_FAILURE_THRESHOLD = '5'
  AI_CIRCUIT_FAILURE_WINDOW_SECONDS = '300'
  AI_CIRCUIT_OPEN_SECONDS = '60'
  BACKUP_DIR = Join-Path $RuntimeRoot 'saas-backups'
  UPLOAD_DIR = Join-Path $RuntimeRoot 'saas-upload-cache'
  CORS_ORIGIN = ($Ports | ForEach-Object { "http://127.0.0.1:$_" }) -join ','
}
foreach ($entry in $environment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, 'Process')
}

$started = @()
foreach ($port in $Ports) {
  $env:PORT = [string]$port
  $env:OTEL_SERVICE_INSTANCE_ID = "windows-sandbox:$port"
  $env:LOG_DIR = Join-Path $RuntimeRoot "saas-logs-$port"
  $process = Start-Process -FilePath (Get-Command node).Source `
    -ArgumentList 'backend/dist/server.js' `
    -WorkingDirectory $ArtifactRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $RuntimeRoot "otel-app-$port.stdout.log") `
    -RedirectStandardError (Join-Path $RuntimeRoot "otel-app-$port.stderr.log") `
    -PassThru
  $pidPath = Join-Path $RuntimeOwnerDir "otel-app-$port.pid"
  $ownerPath = Join-Path $RuntimeOwnerDir "otel-app-$port.owner.json"
  Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
  [ordered]@{
    processId = $process.Id
    port = $port
    artifactRoot = $ArtifactRoot
    entrypoint = 'backend/dist/server.js'
    startedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $ownerPath -Encoding utf8
  $started += [pscustomobject]@{ Port = $port; ProcessId = $process.Id }
}

foreach ($instance in $started) {
  $health = $null
  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$($instance.Port)/health" -TimeoutSec 3
      if ($health.status -eq 'ok' -and $health.search.externalConfigured -and $health.telemetry.enabled) { break }
    } catch {}
  } while ((Get-Date) -lt $deadline)
  if (-not $health -or $health.status -ne 'ok' -or -not $health.search.externalConfigured -or -not $health.telemetry.enabled) {
    throw "Enterprise sandbox instance on port $($instance.Port) did not become fully healthy."
  }
}

$started | Format-Table -AutoSize
