[CmdletBinding()]
param(
    [string]$PostgresPortableDir = $env:POSTGRES_PORTABLE_DIR,
    [string]$PostgresZipPath = $env:POSTGRES_WINDOWS_BIN_ZIP,
    [string]$RuntimeRoot = $env:POSTGRES_RUNTIME_ROOT,
    [string]$DataDir = $env:POSTGRES_DATA_DIR,
    [string]$Database = $(if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'ailaoda' }),
    [string]$Username = $(if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'ailaoda' }),
    [string]$Password = $env:POSTGRES_PASSWORD,
    [int]$Port = $(if ($env:POSTGRES_PORT) { [int]$env:POSTGRES_PORT } else { 5432 }),
    [switch]$CheckOnly
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
        $fallbackRoot = Join-Path $systemDrive 'AilaoDaPostgresRehearsal'
        Write-Warning "Workspace path contains non-ASCII characters; using PostgreSQL runtime root: $fallbackRoot"
        return $fallbackRoot
    }

    return $workspaceRuntimeRoot
}

function Resolve-PortableDir {
    param([string]$PortableDir, [string]$ZipPath, [string]$TargetRoot)

    if ($PortableDir) {
        $resolved = Resolve-Path -LiteralPath $PortableDir -ErrorAction SilentlyContinue
        if (-not $resolved) {
            Fail "POSTGRES_PORTABLE_DIR does not exist: $PortableDir"
        }
        return $resolved.Path
    }

    if (-not $ZipPath) {
        Fail 'Provide POSTGRES_PORTABLE_DIR or POSTGRES_WINDOWS_BIN_ZIP from the official PostgreSQL Windows binary archive.'
    }

    $resolvedZip = Resolve-Path -LiteralPath $ZipPath -ErrorAction SilentlyContinue
    if (-not $resolvedZip) {
        Fail "POSTGRES_WINDOWS_BIN_ZIP does not exist: $ZipPath"
    }

    $extractRoot = Join-Path $TargetRoot 'portable'
    if (-not (Test-Path -LiteralPath $extractRoot)) {
        New-Item -ItemType Directory -Path $extractRoot | Out-Null
    }

    $marker = Join-Path $extractRoot '.zip-source.txt'
    $currentZip = $resolvedZip.Path
    $flatPostgresExe = Join-Path $extractRoot 'bin\postgres.exe'
    $nestedPortableRoot = Join-Path $extractRoot 'pgsql'
    $nestedPostgresExe = Join-Path $nestedPortableRoot 'bin\postgres.exe'
    $needsExtract = -not ((Test-Path -LiteralPath $flatPostgresExe) -or (Test-Path -LiteralPath $nestedPostgresExe))

    if ((Test-Path -LiteralPath $marker) -and -not $needsExtract) {
        $previousZip = (Get-Content -LiteralPath $marker -Raw).Trim()
        if ($previousZip -ne $currentZip) {
            Remove-Item -LiteralPath $extractRoot -Recurse -Force
            New-Item -ItemType Directory -Path $extractRoot | Out-Null
            $needsExtract = $true
        }
    } else {
        $needsExtract = $true
    }

    if ($needsExtract) {
        Expand-Archive -LiteralPath $currentZip -DestinationPath $extractRoot -Force
        Set-Content -LiteralPath $marker -Value $currentZip -Encoding UTF8
    }

    if (Test-Path -LiteralPath $flatPostgresExe) {
        return $extractRoot
    }
    if (Test-Path -LiteralPath $nestedPostgresExe) {
        return $nestedPortableRoot
    }

    Fail "The PostgreSQL archive did not extract a usable bin\\postgres.exe under $extractRoot"
}

function Require-Binary {
    param([string]$Root, [string]$RelativePath)
    $candidate = Join-Path $Root $RelativePath
    if (-not (Test-Path -LiteralPath $candidate)) {
        Fail "Required PostgreSQL binary is missing: $candidate"
    }
    return $candidate
}

function Invoke-PostgresCommand {
    param([string]$FilePath, [string[]]$Arguments, [hashtable]$ExtraEnv = @{})

    $previous = @{}
    foreach ($key in $ExtraEnv.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $ExtraEnv[$key], 'Process')
    }

    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            Fail "Command failed: $FilePath $($Arguments -join ' ')"
        }
    } finally {
        foreach ($key in $ExtraEnv.Keys) {
            [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
        }
    }
}

function Invoke-PostgresCapture {
    param([string]$FilePath, [string[]]$Arguments, [hashtable]$ExtraEnv = @{})

    $previous = @{}
    foreach ($key in $ExtraEnv.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $ExtraEnv[$key], 'Process')
    }

    try {
        $output = & $FilePath @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            Fail "Command failed: $FilePath $($Arguments -join ' ')`n$output"
        }
        return [string]::Join([Environment]::NewLine, $output)
    } finally {
        foreach ($key in $ExtraEnv.Keys) {
            [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
        }
    }
}

$resolvedRuntimeRoot = Resolve-RuntimeRoot -ConfiguredRoot $RuntimeRoot
$runtimeRootResolved = Resolve-Path -LiteralPath $resolvedRuntimeRoot -ErrorAction SilentlyContinue
if (-not $runtimeRootResolved) {
    New-Item -ItemType Directory -Path $resolvedRuntimeRoot -Force | Out-Null
    $runtimeRootResolved = Resolve-Path -LiteralPath $resolvedRuntimeRoot
}

$portableRoot = Resolve-PortableDir -PortableDir $PostgresPortableDir -ZipPath $PostgresZipPath -TargetRoot $runtimeRootResolved.Path
$postgresExe = Require-Binary -Root $portableRoot -RelativePath 'bin\postgres.exe'
$pgCtlExe = Require-Binary -Root $portableRoot -RelativePath 'bin\pg_ctl.exe'
$initDbExe = Require-Binary -Root $portableRoot -RelativePath 'bin\initdb.exe'
$createdbExe = Require-Binary -Root $portableRoot -RelativePath 'bin\createdb.exe'
$psqlExe = Require-Binary -Root $portableRoot -RelativePath 'bin\psql.exe'

$resolvedDataDir = if ($DataDir) { $DataDir } else { Join-Path $runtimeRootResolved.Path 'data' }
$resolvedDataDir = [System.IO.Path]::GetFullPath($resolvedDataDir)
if ($resolvedDataDir -match '[^\x00-\x7F]') {
    Fail "PostgreSQL DataDir must use an ASCII-only path on Windows: $resolvedDataDir"
}
$resolvedLogDir = Join-Path $runtimeRootResolved.Path 'logs'
$resolvedSocketDir = Join-Path $runtimeRootResolved.Path 'run'
$passwordFile = Join-Path $runtimeRootResolved.Path '.pg-password.txt'
$statusFile = Join-Path $runtimeRootResolved.Path 'postgres-rehearsal.json'

foreach ($dir in @($resolvedDataDir, $resolvedLogDir, $resolvedSocketDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

if (-not $Password) {
    Fail 'POSTGRES_PASSWORD is required before starting PostgreSQL rehearsal.'
}

Set-Content -LiteralPath $passwordFile -Value $Password -Encoding ASCII -NoNewline

$connectionString = "postgresql://${Username}:***@127.0.0.1:${Port}/${Database}?schema=public"

if ($CheckOnly) {
    $report = [ordered]@{
        status = 'ready'
        portableRoot = $portableRoot
        runtimeRoot = $runtimeRootResolved.Path
        dataDir = $resolvedDataDir
        database = $Database
        username = $Username
        port = $Port
        connectionString = $connectionString
    }
    $report | ConvertTo-Json -Depth 4
    exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $resolvedDataDir 'PG_VERSION'))) {
    Invoke-PostgresCommand -FilePath $initDbExe -Arguments @(
        '-D', $resolvedDataDir,
        '-U', $Username,
        '--pwfile', $passwordFile,
        '--encoding', 'UTF8',
        '--locale', 'C'
    )
}

$pgCtlArgs = @(
    'start',
    '-D', $resolvedDataDir,
    '-l', (Join-Path $resolvedLogDir 'postgres.log'),
    '-o', """-p $Port -k `"$resolvedSocketDir`""""
)
Invoke-PostgresCommand -FilePath $pgCtlExe -Arguments $pgCtlArgs

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        Invoke-PostgresCommand -FilePath $psqlExe -Arguments @(
            '-h', '127.0.0.1',
            '-p', "$Port",
            '-U', $Username,
            '-d', 'postgres',
            '-c', 'select 1;'
        ) -ExtraEnv @{ PGPASSWORD = $Password }
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $ready) {
    Fail "PostgreSQL rehearsal did not become ready on 127.0.0.1:$Port"
}

$databaseExistsOutput = Invoke-PostgresCapture -FilePath $psqlExe -Arguments @(
    '-h', '127.0.0.1',
    '-p', "$Port",
    '-U', $Username,
    '-d', 'postgres',
    '-tAc', "select 1 from pg_database where datname = '$Database';"
) -ExtraEnv @{ PGPASSWORD = $Password }
$databaseExists = $databaseExistsOutput.Trim() -eq '1'

if (-not $databaseExists) {
    Invoke-PostgresCommand -FilePath $createdbExe -Arguments @(
        '-h', '127.0.0.1',
        '-p', "$Port",
        '-U', $Username,
        $Database
    ) -ExtraEnv @{ PGPASSWORD = $Password }
}

$status = [ordered]@{
    status = 'started'
    portableRoot = $portableRoot
    runtimeRoot = $runtimeRootResolved.Path
    dataDir = $resolvedDataDir
    database = $Database
    username = $Username
    port = $Port
    connectionString = $connectionString
    startedAt = (Get-Date).ToString('o')
}

$statusJson = $status | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($statusFile, $statusJson, [System.Text.UTF8Encoding]::new($false))
$statusJson
