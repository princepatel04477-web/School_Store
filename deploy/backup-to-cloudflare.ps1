# Back up the store's database to Cloudflare R2. Runs ON THE SERVER (E:\Projects\School_Store\deploy).
#   powershell -ExecutionPolicy Bypass -File .\deploy\backup-to-cloudflare.ps1            # back up now
#   powershell -ExecutionPolicy Bypass -File .\deploy\backup-to-cloudflare.ps1 -Install   # every night at 02:30
#     (-Install also creates the bucket and a rule that deletes each backup after 30 days, as the Privacy page says)
# 1. pg_dump (compressed custom format) into <data>\school_store\backups, checked with pg_restore -l
# 2. uploads it to the R2 bucket as db/<file>; keeps the last 14 dumps on the server
# Needs deploy\backup.env (not in git):
#   CLOUDFLARE_ACCOUNT_ID=...
#   CLOUDFLARE_API_TOKEN=...   (an API token with "Workers R2 Storage: Edit")
#   R2_BUCKET=school-store-backups
# Restore: download the file from the bucket, then  pg_restore --clean --if-exists -d <db> <file>
param([switch]$Install, [int]$Keep = 14)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path (Split-Path $project -Parent | Split-Path -Parent) 'runtime'
. "$runtime\env.ps1" | Out-Null

function Read-KV($file) {
    $h = @{}
    Get-Content $file | Where-Object { $_ -match '^\s*[^#\s][^=]*=' } | ForEach-Object { $k, $v = $_ -split '=', 2; $h[$k.Trim()] = $v.Trim().Trim('"') }
    $h
}
$state = "$env:SCHOOLSTORE_DATA\school_store"
$backups = "$state\backups"
New-Item -ItemType Directory -Force $backups, "$state\logs" | Out-Null
$logFile = "$state\logs\backup.log"
function Log($m) { "$(Get-Date -Format s)  $m" | Tee-Object -FilePath $logFile -Append }

$cfgFile = "$PSScriptRoot\backup.env"
if (-not (Test-Path $cfgFile)) { throw "Missing $cfgFile - see the top of this script" }
$cfg = Read-KV $cfgFile
foreach ($k in 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'R2_BUCKET') {
    if (-not $cfg[$k]) { throw "$cfgFile needs $k" }
}
if ($Install) {
    $env:CLOUDFLARE_ACCOUNT_ID = $cfg['CLOUDFLARE_ACCOUNT_ID']
    $env:CLOUDFLARE_API_TOKEN = $cfg['CLOUDFLARE_API_TOKEN']
    & npx --yes wrangler@4 r2 bucket create $cfg['R2_BUCKET']                  # fails harmlessly if it already exists
    & npx --yes wrangler@4 r2 bucket lifecycle add $cfg['R2_BUCKET'] expire-db-30d db/ --expire-days 30 --force
    if ($LASTEXITCODE -ne 0) { throw 'could not set the 30-day expiry rule on the bucket' }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $trigger = New-ScheduledTaskTrigger -Daily -At '02:30'
    Register-ScheduledTask -TaskName 'SchoolStore database backup' -Action $action -Trigger $trigger `
        -Description 'Nightly School Store database backup to Cloudflare R2' -Force | Out-Null
    Write-Host 'Scheduled: every night at 02:30 (Task Scheduler > "SchoolStore database backup").'
    return
}

$db = Read-KV "$project\.env"

# ---- 1. dump + check ----
$file = "school_store_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
$path = Join-Path $backups $file
Log "dumping $($db['POSTGRES_DB']) to $path"
$env:PGPASSWORD = $db['POSTGRES_PASSWORD']
& pg_dump -h $db['POSTGRES_HOST'] -p $db['POSTGRES_PORT'] -U $db['POSTGRES_USER'] -d $db['POSTGRES_DB'] -Fc -f $path
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
& pg_restore -l $path | Out-Null
if ($LASTEXITCODE -ne 0) { throw "backup file $path is not readable" }
Remove-Item Env:PGPASSWORD
Log ("dump ok: {0:N1} MB" -f ((Get-Item $path).Length / 1MB))

# ---- 2. upload to R2 ----
$env:CLOUDFLARE_ACCOUNT_ID = $cfg['CLOUDFLARE_ACCOUNT_ID']
$env:CLOUDFLARE_API_TOKEN = $cfg['CLOUDFLARE_API_TOKEN']
& npx --yes wrangler@4 r2 object put "$($cfg['R2_BUCKET'])/db/$file" --file $path --remote
if ($LASTEXITCODE -ne 0) { throw 'upload to Cloudflare R2 failed (the dump is still on this server)' }
Log "uploaded to r2://$($cfg['R2_BUCKET'])/db/$file"

# ---- 3. keep the newest dumps on this server ----
Get-ChildItem $backups -Filter 'school_store_*.dump' | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item
Log 'backup finished'
