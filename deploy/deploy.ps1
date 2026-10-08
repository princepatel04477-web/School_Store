# Update and redeploy School Store ON THE SERVER (run from E:\Projects\School_Store):
#   powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1
# Pull latest code -> install deps -> migrate -> collect static -> restart.
param([string]$Branch = 'main')
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
. (Join-Path (Split-Path $project -Parent | Split-Path -Parent) 'runtime\env.ps1') | Out-Null
Set-Location $project

# load .env so migrate/collectstatic see DATABASE_URL etc.
if (Test-Path .env) {
    Get-Content .env | Where-Object { $_ -match '^\s*[^#\s][^=]*=' } | ForEach-Object {
        $k, $v = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), 'Process')
    }
}
$app = if (Test-Path "$project\backend\manage.py") { "$project\backend" } else { $project }

Write-Host "==> git pull ($Branch)";   git fetch origin; git checkout $Branch; git pull --ff-only origin $Branch
Write-Host "==> pip install";          python -m pip install --no-warn-script-location -r requirements.txt
Write-Host "==> migrate";              Push-Location $app; python manage.py migrate --noinput
Write-Host "==> collectstatic";        python manage.py collectstatic --noinput; Pop-Location
if (Test-Path "$project\package.json") { Write-Host "==> npm ci / build"; npm ci; npm run build --if-present }
Write-Host "==> restart";              & "$PSScriptRoot\run.ps1" restart
Write-Host "Deploy finished."
