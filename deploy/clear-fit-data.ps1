# Daily on the store server: clear children's height, weight and shoulder width
# from order lines FIT_DATA_RETENTION_DAYS (default 90) after the order ended,
# keeping only an unlinked SizingSample (see backend/orders/fit_retention.py).
#
# Scheduled once, as SYSTEM, from any PC that can reach the server:
#   schtasks /create /s 192.168.0.125 /ru SYSTEM /sc daily /st 03:30 /tn SchoolStoreClearFitData /f ^
#     /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\Projects\School_Store\deploy\clear-fit-data.ps1"
# Log: E:\runtime\data\school_store\logs\clear-fit-data.log
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$root = Split-Path $project -Parent | Split-Path -Parent
. (Join-Path $root 'runtime\env.ps1') | Out-Null
$log = Join-Path $root 'runtime\data\school_store\logs\clear-fit-data.log'

Get-Content (Join-Path $project '.env') | Where-Object { $_ -match '^\s*[^#\s][^=]*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), 'Process')
}

Push-Location (Join-Path $project 'backend')
try {
    $out = & python manage.py clear_fit_data 2>&1
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
$out | ForEach-Object { "$(Get-Date -Format s)  $_" } | Add-Content -Path $log -Encoding utf8
if ($code -ne 0) { "$(Get-Date -Format s)  FAILED (exit $code)" | Add-Content -Path $log -Encoding utf8 }
exit $code
