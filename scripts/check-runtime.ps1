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

function Check-Url {
  param(
    [string]$Name,
    [string]$Url
  )

  try {
    $resp = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 5
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

$results = New-Object System.Collections.Generic.List[object]
$results.Add((Check-Url -Name 'health' -Url "$BaseUrl/health"))
$homeCheck = Check-Url -Name 'home' -Url "$BaseUrl/"
$results.Add($homeCheck)
$results.Add((Check-Url -Name 'manifest' -Url "$BaseUrl/manifest.json"))
$results.Add((Check-Url -Name 'icon' -Url "$BaseUrl/icon.svg"))
$results.Add((Check-Url -Name 'service-worker' -Url "$BaseUrl/sw.js"))

try {
  $homeResp = Invoke-WebRequest "$BaseUrl/" -UseBasicParsing -TimeoutSec 5
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
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Write-Host "Runtime check report: $ReportPath"

if ($failedResults.Count -gt 0) {
  exit 1
}
