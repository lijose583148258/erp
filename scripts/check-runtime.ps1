$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$BaseUrl = $env:AILAODA_RUNTIME_URL
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = 'http://127.0.0.1:5001'
}
$BaseUrl = $BaseUrl.TrimEnd('/')
$OutputDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'output\audit'
$ReportPath = Join-Path $OutputDir 'runtime-check-v1.json'
$startedAt = (Get-Date).ToUniversalTime().ToString('o')

function Invoke-WebRequestWithRetry {
  param(
    [string]$Url,
    [int]$Attempts = 3,
    [int]$DelayMs = 500
  )

  $lastError = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      return Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 5
    } catch {
      $lastError = $_
      if ($attempt -lt $Attempts) {
        Start-Sleep -Milliseconds $DelayMs
      }
    }
  }
  throw $lastError
}

function Check-Url {
  param(
    [string]$Name,
    [string]$Url
  )

  try {
    $resp = Invoke-WebRequestWithRetry -Url $Url
    [PSCustomObject]@{
      Name = $Name
      Url = $Url
      Status = $resp.StatusCode
      Bytes = ($resp.Content | Out-String).Length
      Ok = $true
    }
  } catch {
    [PSCustomObject]@{
      Name = $Name
      Url = $Url
      Status = $_.Exception.Message
      Bytes = 0
      Ok = $false
    }
  }
}

function Check-DisabledUrl {
  param(
    [string]$Name,
    [string]$Url
  )

  try {
    $resp = Invoke-WebRequestWithRetry -Url $Url
    [PSCustomObject]@{
      Name = $Name
      Url = $Url
      Status = $resp.StatusCode
      Bytes = ($resp.Content | Out-String).Length
      Ok = $false
    }
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }
    [PSCustomObject]@{
      Name = $Name
      Url = $Url
      Status = if ($statusCode) { $statusCode } else { $_.Exception.Message }
      Bytes = 0
      Ok = ($statusCode -eq 404)
    }
  }
}

$results = New-Object System.Collections.Generic.List[object]
$results.Add((Check-Url -Name 'health' -Url "$BaseUrl/health"))
$homeCheck = Check-Url -Name 'home' -Url "$BaseUrl/"
$results.Add($homeCheck)
$results.Add((Check-Url -Name 'manifest' -Url "$BaseUrl/manifest.json"))
$results.Add((Check-Url -Name 'icon' -Url "$BaseUrl/icon.svg"))
$results.Add((Check-DisabledUrl -Name 'service-worker-disabled' -Url "$BaseUrl/sw.js"))

try {
  $homeResp = Invoke-WebRequestWithRetry -Url "$BaseUrl/"
  $matches = [regex]::Matches($homeResp.Content, '(?:src|href)="([^"]+\.(?:js|css))"')
  $assetPaths = @()
  foreach ($match in $matches) {
    $assetPaths += $match.Groups[1].Value
  }
  $assetPaths = $assetPaths | Select-Object -Unique | Select-Object -First 6
  foreach ($assetPath in $assetPaths) {
    if ($assetPath -match '^https?://') {
      $results.Add([PSCustomObject]@{
        Name = "asset:$assetPath"
        Url = $assetPath
        Status = 'external asset is not allowed for offline/EXE runtime'
        Bytes = 0
        Ok = $false
      })
      continue
    }

    $assetUrl = "$BaseUrl/$($assetPath.TrimStart('/'))"
    $results.Add((Check-Url -Name "asset:$assetPath" -Url $assetUrl))
  }
} catch {
  $results.Add([PSCustomObject]@{
    Name = 'asset-discovery'
    Url = "$BaseUrl/"
    Status = $_.Exception.Message
    Bytes = 0
    Ok = $false
  })
}

$results | Format-Table -AutoSize

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$failedResults = @($results | Where-Object { -not $_.Ok })
$status = if ($failedResults.Count -gt 0) { 'failed' } else { 'passed' }
$resultArray = @($results | ForEach-Object {
  [ordered]@{
    name = $_.Name
    url = $_.Url
    httpStatus = $_.Status
    bytes = $_.Bytes
    ok = [bool]$_.Ok
  }
})
$report = [ordered]@{
  name = 'Runtime Check'
  version = '1.1'
  baseUrl = $BaseUrl
  startedAt = $startedAt
  finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  status = $status
  results = $resultArray
}
$reportJson = ($report | ConvertTo-Json -Depth 5)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ReportPath, "$reportJson`n", $utf8NoBom)
Write-Host "Runtime check report: $ReportPath"

if ($failedResults.Count -gt 0) {
  exit 1
}
