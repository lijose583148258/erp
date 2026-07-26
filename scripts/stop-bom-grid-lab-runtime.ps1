param(
  [string]$RuntimeRoot = 'C:\AilaoDaBomGridPoc'
)

$pidFile = Join-Path $RuntimeRoot 'pids.json'
if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Output 'No BOM Grid Lab runtime pid file found.'
  exit 0
}

$runtimePids = Get-Content -Raw -LiteralPath $pidFile | ConvertFrom-Json
if (-not $runtimePids.identities) {
  throw 'Refuse to stop from a legacy pid file without process identity evidence.'
}

function Assert-ProcessIdentity {
  param([int]$ProcessId)
  $expected = @($runtimePids.identities | Where-Object { [int]$_.pid -eq $ProcessId }) | Select-Object -First 1
  if (-not $expected) {
    throw "Refuse to stop PID $ProcessId because it is absent from the ownership ledger."
  }
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $current) {
    return $false
  }
  $currentCreationDate = ([datetime]$current.CreationDate).ToUniversalTime().ToString('o')
  if (
    [string]$current.CommandLine -ne [string]$expected.commandLine `
    -or [string]$current.ExecutablePath -ne [string]$expected.executablePath `
    -or $currentCreationDate -ne [string]$expected.creationDate
  ) {
    throw "Refuse to stop PID $ProcessId because its command line, executable, or creation time no longer matches."
  }
  return $true
}

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
  $processId = [int]$_
  if (Assert-ProcessIdentity -ProcessId $processId) {
    Stop-ProcessTree -RootProcessId $processId
  }
}
Remove-Item -LiteralPath $pidFile -Force
Write-Output 'BOM Grid Lab runtime stopped.'
