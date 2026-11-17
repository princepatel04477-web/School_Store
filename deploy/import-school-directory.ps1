# On the store server: back up the database, then load the North India school
# directory (backend/schools/data/north_india_schools.json) with
# `manage.py import_school_directory`. Safe to run again: branches are matched
# on their Google Maps place id and updated.
#
# Run once, as SYSTEM, from any PC that can reach the server:
#   schtasks /create /s 192.168.0.125 /ru SYSTEM /sc once /st 00:00 /tn SchoolStoreImportDirectory /f ^
#     /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\Projects\School_Store\deploy\import-school-directory.ps1"
#   schtasks /run /s 192.168.0.125 /tn SchoolStoreImportDirectory
# Log: E:\runtime\data\school_store\logs\import-school-directory.log
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$root = Split-Path $project -Parent | Split-Path -Parent
. (Join-Path $root 'runtime\env.ps1') | Out-Null
$state = Join-Path $root 'runtime\data\school_store'
$log = Join-Path $state 'logs\import-school-directory.log'
function Log($m) { "$(Get-Date -Format s)  $m" | Add-Content -Path $log -Encoding utf8 }

$cfg = @{}
Get-Content (Join-Path $project '.env') | Where-Object { $_ -match '^\s*[^#\s][^=]*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2; $cfg[$k.Trim()] = $v.Trim().Trim('"')
    [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), 'Process')
}

Log "---- import-school-directory starting"
$code = 1
try {
    # 1. backup (plain SQL, restorable with psql -f)
    $dump = Join-Path $state ("backup-before-directory-{0}.sql" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $env:PGPASSWORD = $cfg['POSTGRES_PASSWORD']
    & (Join-Path $root 'runtime\postgres\bin\pg_dump.exe') -h 127.0.0.1 -p $cfg['POSTGRES_PORT'] -U $cfg['POSTGRES_USER'] -d $cfg['POSTGRES_DB'] -f $dump
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }
    Log "backup written: $dump"

    # 2. import
    Push-Location (Join-Path $project 'backend')
    try {
        $out = & python manage.py import_school_directory --deactivate-missing 2>&1
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    $out | ForEach-Object { Log $_ }
    if ($code -ne 0) { Log "FAILED (exit $code)" } else { Log "done" }
} catch {
    Log "FAILED: $_"
    $code = 1
}
exit $code
