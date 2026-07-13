[CmdletBinding()]
param(
    [string]$RuntimeRoot = $env:POSTGRES_RUNTIME_ROOT,
    [string]$PostgresPortableDir = $env:POSTGRES_PORTABLE_DIR
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    throw $Message
}

function Resolve-RuntimeRoot {
    param([string]$ConfiguredRoot)

    if ($ConfiguredRoot) {
        if ($ConfiguredRoot -match '[^\x00-\x7F]') {
            Fail "POSTGRES_RUNTIME_ROOT must use an ASCII-only path for the native PostgreSQL Windows tools: $ConfiguredRoot"
        }
        return $ConfiguredRoot
    }

    $workspaceRuntimeRoot = Join-Path (Get-Location).Path 'output\postgres-runtime'
    if ($workspaceRuntimeRoot -match '[^\x00-\x7F]') {
        $systemDrive = if ($env:SystemDrive) { $env:SystemDrive } else { 'C:' }
        return (Join-Path $systemDrive 'AilaoDaPostgresRehearsal')
    }

    return $workspaceRuntimeRoot
}

function Resolve-PortableRoot {
    param([string]$ConfiguredPortableRoot, [string]$RuntimeRoot)

    if ($ConfiguredPortableRoot) {
        return (Resolve-Path -LiteralPath $ConfiguredPortableRoot -ErrorAction Stop).Path
    }

    $flatPortableRoot = Join-Path $RuntimeRoot 'portable'
    $nestedPortableRoot = Join-Path $flatPortableRoot 'pgsql'
    if (Test-Path -LiteralPath (Join-Path $flatPortableRoot 'bin\pg_ctl.exe')) {
        return $flatPortableRoot
    }
    if (Test-Path -LiteralPath (Join-Path $nestedPortableRoot 'bin\pg_ctl.exe')) {
        return $nestedPortableRoot
    }

    Fail "pg_ctl.exe is missing under $flatPortableRoot"
}

$resolvedRuntimeRoot = Resolve-RuntimeRoot -ConfiguredRoot $RuntimeRoot
$runtimeRootResolved = Resolve-Path -LiteralPath $resolvedRuntimeRoot -ErrorAction SilentlyContinue
if (-not $runtimeRootResolved) {
    Fail "Runtime root does not exist: $resolvedRuntimeRoot"
}

$portableRoot = Resolve-PortableRoot -ConfiguredPortableRoot $PostgresPortableDir -RuntimeRoot $runtimeRootResolved.Path

$pgCtlExe = Join-Path $portableRoot 'bin\pg_ctl.exe'
if (-not (Test-Path -LiteralPath $pgCtlExe)) {
    Fail "pg_ctl.exe is missing: $pgCtlExe"
}

$dataDir = Join-Path $runtimeRootResolved.Path 'data'
if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'PG_VERSION'))) {
    Fail "PostgreSQL data directory is not initialized: $dataDir"
}

& $pgCtlExe stop -D $dataDir -m fast
if ($LASTEXITCODE -ne 0) {
    Fail "Failed to stop PostgreSQL rehearsal at $dataDir"
}

Write-Output "PostgreSQL rehearsal stopped: $dataDir"
