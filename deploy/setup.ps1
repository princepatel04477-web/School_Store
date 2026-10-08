# One-shot setup + start for School Store (safe to re-run):
#   powershell -ExecutionPolicy Bypass -File .\deploy\setup.ps1
# Creates the PostgreSQL cluster (first run only), writes .env, migrates, loads demo data, starts everything.
param([switch]$NoSeed, [int]$PgPort = 5432)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path (Split-Path $project -Parent | Split-Path -Parent) 'runtime'
. "$runtime\env.ps1" | Out-Null
$envFile = "$project\.env"
$app = if (Test-Path "$project\backend\manage.py") { "$project\backend" } else { $project }

function New-Secret($n) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }

if (-not (Test-Path "$env:PGDATA\PG_VERSION")) {
    if (Test-Path $envFile) {
        # .env came with the project folder (e.g. created on a workstation) but this machine has no database yet:
        # create a fresh cluster using the password already in .env so the file stays valid.
        $kv = @{}; Get-Content $envFile | Where-Object { $_ -match '^\s*[^#\s][^=]*=' } | ForEach-Object { $k,$v = $_ -split '=',2; $kv[$k.Trim()] = $v.Trim() }
        if (-not $kv['POSTGRES_PASSWORD']) { throw ".env has no POSTGRES_PASSWORD; delete .env and re-run setup." }
        Write-Host "==> creating PostgreSQL cluster in $env:PGDATA (using password from existing .env)"
        & "$runtime\init-postgres.ps1" -AppPassword $kv['POSTGRES_PASSWORD'] -Port ([int]$(if ($kv['POSTGRES_PORT']) { $kv['POSTGRES_PORT'] } else { $PgPort }))
    } else {
    $dbPw = New-Secret 24
    Write-Host "==> creating PostgreSQL cluster in $env:PGDATA"
    & "$runtime\init-postgres.ps1" -AppPassword $dbPw -Port $PgPort
    @"
DJANGO_DEBUG=1
DJANGO_SECRET_KEY=$(New-Secret 50)
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=$PgPort
POSTGRES_DB=school_store
POSTGRES_USER=school_user
POSTGRES_PASSWORD=$dbPw
USE_DB_POOL=0
REDIS_URL=redis://127.0.0.1:6379
"@ | Set-Content $envFile -Encoding ascii
    Write-Host "==> wrote $envFile (keep it private; it is git-ignored)"
    }
} elseif (-not (Test-Path $envFile)) { throw "Cluster exists but $envFile is missing - recreate .env with the database password." }

Write-Host "==> starting PostgreSQL + Redis"
& "$runtime\services.ps1" start

Get-Content $envFile | Where-Object { $_ -match '^\s*[^#\s][^=]*=' } | ForEach-Object { $k,$v = $_ -split '=',2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim(), 'Process') }
$env:PYTHONIOENCODING = 'utf-8'
Push-Location $app
Write-Host "==> migrate";  python manage.py migrate --noinput
if (-not $NoSeed) { Write-Host "==> seed demo data"; python manage.py seed_data }
Pop-Location

Write-Host "==> starting app"
& "$PSScriptRoot\run.ps1" restart
