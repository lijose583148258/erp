param(
  [string]$AppUrl = "http://127.0.0.1:5001/",
  [int]$Port = 9222,
  [string]$ProfileDir = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProfileDir)) {
  $ProfileDir = Join-Path (Resolve-Path ".").Path "output\browser-cdp-profile"
}

function Test-CdpPort {
  param([int]$TargetPort)
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$TargetPort/json/version" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (Test-CdpPort -TargetPort $Port) {
  Write-Host "CDP already available at http://127.0.0.1:$Port"
  exit 0
}

$edgeCandidates = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

$browserExe = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browserExe) {
  throw "No Edge or Chrome executable found for CDP browser verification."
}

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

$arguments = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$ProfileDir",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=Translate",
  $AppUrl
)

Start-Process -FilePath $browserExe -ArgumentList $arguments | Out-Null

$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  if (Test-CdpPort -TargetPort $Port) {
    Write-Host "CDP ready at http://127.0.0.1:$Port"
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

throw "CDP browser did not become ready within 15 seconds."
