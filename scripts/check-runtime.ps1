$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$BaseUrl = $env:AILAODA_RUNTIME_URL
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = 'http://127.0.0.1:5001'
}
$BaseUrl = $BaseUrl.TrimEnd('/')

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
    $assetUrl = if ($assetPath.StartsWith('http')) { $assetPath } else { "$BaseUrl/$($assetPath.TrimStart('/'))" }
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

if ($results.Where({ -not $_.Ok }).Count -gt 0) {
  exit 1
}
