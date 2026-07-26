param(
  [string]$RuntimeRoot = 'C:\AilaoDaBomGridPoc'
)

$pidFile = Join-Path $RuntimeRoot 'pids.json'
if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Output 'No BOM Grid Lab runtime pid file found.'
  exit 0
}

$runtimePids = Get-Content -Raw -LiteralPath $pidFile | ConvertFrom-Json
function Stop-ProcessTree {
  param([int]$RootProcessId)

  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$RootProcessId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) {
    Stop-ProcessTree -RootProcessId ([int]$child.ProcessId)
  }
  if ($RootProcessId -gt 0 -and (Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $RootProcessId -Force
  }
}

@(
  $runtimePids.backendPid,
  $runtimePids.frontendPid,
  $runtimePids.backendLauncherPid,
  $runtimePids.frontendLauncherPid
) | Where-Object { $_ } | Select-Object -Unique | ForEach-Object {
  Stop-ProcessTree -RootProcessId ([int]$_)
}
Remove-Item -LiteralPath $pidFile -Force
Write-Output 'BOM Grid Lab runtime stopped.'
