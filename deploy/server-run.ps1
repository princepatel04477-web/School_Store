# Entry point of the startup task "SchoolStorePublic" (runs as SYSTEM ON THE SERVER at every boot, never exits).
#   1. creates the School Store PostgreSQL cluster on port 5433 (5432 belongs to another application) - first run only
#   2. restores the demo data from deploy\school_store.sql - first run only
#   3. starts PostgreSQL + Redis
#   4. hands over to publish.ps1 (builds the site, starts API + worker, opens the tunnel, registers the public link)
# Log: E:\runtime\data\school_store\logs\server-run.log (and publish.log)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path (Split-Path $project -Parent | Split-Path -Parent) 'runtime'
. "$runtime\env.ps1" | Out-Null
$data  = $env:SCHOOLSTORE_DATA
$state = "$data\school_store"
New-Item -ItemType Directory -Force "$state\logs" | Out-Null
$logFile = "$state\logs\server-run.log"
function Log($m) { "$(Get-Date -Format s)  $m" | Add-Content $logFile -Encoding ascii }

function Read-KV($file) {
    $h = @{}
    Get-Content $file | Where-Object { $_ -match '^\s*[^#\s][^=]*=' } | ForEach-Object { $k, $v = $_ -split '=', 2; $h[$k.Trim()] = $v.Trim().Trim('"') }
    $h
}
function Set-EnvLine($file, $key, $value) {
    $found = $false
    $out = @(Get-Content $file | ForEach-Object { if ($_ -match "^\s*$key=") { $found = $true; "$key=$value" } else { $_ } })
    if (-not $found) { $out += "$key=$value" }
    Set-Content $file $out -Encoding ascii
}
function Test-Port($p) { [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) }
function Wait-Port($p, $sec) { for ($i = 0; $i -lt $sec -and -not (Test-Port $p); $i++) { Start-Sleep -Seconds 1 }; Test-Port $p }
# run a native exe through cmd so its stderr output can never become a PowerShell error; returns the exit code
function Run-Native($exe, $argLine, $logPath) { cmd /c "`"$exe`" $argLine > `"$logPath`" 2>&1"; $LASTEXITCODE }

try {
    Log "---- server-run starting (user: $(whoami))"
    $envFile = "$project\.env"
    if (-not (Test-Path $envFile)) { throw ".env missing at $envFile" }
    $pgPort = 5433
    Set-EnvLine $envFile 'POSTGRES_HOST' '127.0.0.1'
    Set-EnvLine $envFile 'POSTGRES_PORT' "$pgPort"
    $kv = Read-KV $envFile
    $pw = $kv['POSTGRES_PASSWORD']; $dbUser = $kv['POSTGRES_USER']; $dbName = $kv['POSTGRES_DB']
    if (-not $pw -or -not $dbUser -or -not $dbName) { throw ".env needs POSTGRES_PASSWORD, POSTGRES_USER, POSTGRES_DB" }
    if ($pw -notmatch '^[A-Za-z0-9]+$') { throw "POSTGRES_PASSWORD must be alphanumeric" }
    $pgbin = "$runtime\postgres\bin"; $pgdata = $env:PGDATA; $psql = "$pgbin\psql.exe"

    # 1. cluster (first run)
    if (-not (Test-Path "$pgdata\PG_VERSION")) {
        if (Test-Port $pgPort) { throw "port $pgPort is already used by something else" }
        Log "creating PostgreSQL cluster in $pgdata (port $pgPort)"
        $pwf = "$data\pgpw.tmp"; Set-Content $pwf $pw -NoNewline -Encoding ascii
        $code = Run-Native "$pgbin\initdb.exe" "-D `"$pgdata`" -U postgres -E UTF8 --locale=C -A scram-sha-256 --pwfile=`"$pwf`"" "$state\logs\initdb.log"
        Remove-Item $pwf -Force -ErrorAction SilentlyContinue
        if ($code -ne 0) { throw "initdb failed (exit $code) - see $state\logs\initdb.log" }
        Add-Content "$pgdata\postgresql.conf" "`nlisten_addresses = '127.0.0.1'`nport = $pgPort`nmax_connections = 100" -Encoding ascii
    }

    # 2. start PostgreSQL through pg_ctl (it drops administrator rights; postgres.exe refuses to run as admin)
    if (-not (Test-Port $pgPort)) {
        Log "starting PostgreSQL"
        Start-Process "$pgbin\pg_ctl.exe" -ArgumentList "start -D `"$pgdata`" -l `"$data\postgres.log`"" -WindowStyle Hidden | Out-Null
        if (-not (Wait-Port $pgPort 90)) { throw "PostgreSQL did not start - see $data\postgres.log" }
    }
    $env:PGPASSWORD = $pw
    function Scalar($sql, $db = 'postgres', $u = 'postgres') {
        $tmp = "$state\logs\psql.tmp"
        $null = Run-Native $psql "-h 127.0.0.1 -p $pgPort -U $u -d $db -tAc `"$sql`"" $tmp
        $t = Get-Content $tmp -Raw
        if ($t) { $t.Trim() } else { '' }
    }

    # 3. role + database + demo data (first run)
    if ((Scalar "SELECT 1 FROM pg_roles WHERE rolname='$dbUser'") -ne '1') {
        Log "creating role $dbUser"
        $null = Scalar "CREATE ROLE $dbUser LOGIN PASSWORD '$pw'"
    }
    if ((Scalar "SELECT 1 FROM pg_database WHERE datname='$dbName'") -ne '1') {
        Log "creating database $dbName"
        $null = Scalar "CREATE DATABASE $dbName OWNER $dbUser ENCODING 'UTF8' TEMPLATE template0"
    }
    $dump = "$PSScriptRoot\school_store.sql"
    $tables = [int](Scalar "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" $dbName $dbUser)
    if ($tables -eq 0 -and (Test-Path $dump)) {
        Log "restoring data from school_store.sql"
        $code = Run-Native $psql "-h 127.0.0.1 -p $pgPort -U $dbUser -d $dbName -v ON_ERROR_STOP=1 -f `"$dump`"" "$state\logs\restore.log"
        if ($code -ne 0) {
            $null = Scalar "DROP DATABASE $dbName"; $null = Scalar "CREATE DATABASE $dbName OWNER $dbUser ENCODING 'UTF8' TEMPLATE template0"
            throw "restore failed (exit $code) - see $state\logs\restore.log"
        }
        Rename-Item $dump "school_store.sql.done" -Force
        Log "restore done"
    }

    # 4. Redis
    if (-not (Test-Port 6379)) {
        Log "starting Redis"
        New-Item -ItemType Directory -Force "$data\redis" | Out-Null
        Start-Process "$runtime\redis\redis-server.exe" -ArgumentList '--port', 6379, '--bind', '127.0.0.1', '--dir', "$data\redis", '--appendonly', 'yes', '--maxmemory', '256mb', '--maxmemory-policy', 'allkeys-lru' -WindowStyle Hidden `
            -RedirectStandardOutput "$data\redis.out.log" -RedirectStandardError "$data\redis.err.log"
        if (-not (Wait-Port 6379 30)) { throw "Redis did not start - see $data\redis.err.log" }
    }

    Log "database + redis are up; handing over to publish.ps1"
    & "$PSScriptRoot\publish.ps1"
} catch {
    Log "FAILED: $($_.Exception.Message)"
    Start-Sleep -Seconds 20
    exit 1
}
