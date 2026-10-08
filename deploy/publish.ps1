# Publish School Store from THIS server to the permanent link. Runs ON THE SERVER (E:\Projects\School_Store\deploy).
#   powershell -ExecutionPolicy Bypass -File .\deploy\publish.ps1
# 1. builds the React app (relative /api) and tells Django to serve it (single origin on :8000)
# 2. (re)starts web + worker via run.ps1
# 3. opens a Cloudflare quick tunnel to :8000 and registers its address with the Worker at PUBLIC_URL,
#    so https://school-store.aqualite.workers.dev is answered by THIS server (header x-served-by: local).
#    If this server or the tunnel is down the Worker serves the cloud copy instead, so the link never dies.
# Needs deploy\public.env (PUBLIC_URL, REGISTER_SECRET). Restarts the tunnel automatically if it drops.
# -LocalOnly: build + start the store on this machine (http://localhost:8000), no tunnel / permanent link.
param([int]$Port = 8000, [switch]$LocalOnly)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path (Split-Path $project -Parent | Split-Path -Parent) 'runtime'
. "$runtime\env.ps1" | Out-Null
$state = "$env:SCHOOLSTORE_DATA\school_store"
New-Item -ItemType Directory -Force "$state\logs" | Out-Null
$logFile = "$state\logs\publish.log"
function Log($m) { "$(Get-Date -Format s)  $m" | Tee-Object -FilePath $logFile -Append }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

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

$public = ''
$cf = "$runtime\cloudflared\cloudflared.exe"
if (-not $LocalOnly) {
    $cfg = Read-KV "$PSScriptRoot\public.env"
    if (-not $cfg['PUBLIC_URL'] -or -not $cfg['REGISTER_SECRET']) { throw "deploy\public.env needs PUBLIC_URL and REGISTER_SECRET" }
    $public = $cfg['PUBLIC_URL'].TrimEnd('/')
    if (-not (Test-Path $cf)) { throw "Missing $cf" }
}
$envFile = "$project\.env"
if (-not (Test-Path $envFile)) { throw "Missing $envFile - run deploy\install-on-server.cmd first" }
$app = if (Test-Path "$project\backend\manage.py") { "$project\backend" } else { $project }

# ---- 1. frontend build + Django settings ----
Log "building frontend (relative /api)"
Push-Location "$project\frontend"
$env:VITE_API_URL = '/api'      # overrides .env.production, which points at the Render API
& "$runtime\node\node.exe" node_modules\vite\bin\vite.js build --outDir dist-local --emptyOutDir
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "frontend build failed" }
Pop-Location

Set-EnvLine $envFile 'FRONTEND_DIST' "$project\frontend\dist-local"
$csrf = (@("https://*.trycloudflare.com", $public, "http://localhost:$Port", "http://127.0.0.1:$Port") | Where-Object { $_ }) -join ','
Set-EnvLine $envFile 'DJANGO_CSRF_TRUSTED_ORIGINS' $csrf

Set-EnvLine $envFile 'DJANGO_DEBUG' '0'
Set-EnvLine $envFile 'SECURE_SSL_REDIRECT' '0'
Set-EnvLine $envFile 'SECURE_HSTS_SECONDS' '0'

(Read-KV $envFile).GetEnumerator() | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Key, $_.Value, 'Process') }
& "$runtime\services.ps1" start | Out-Null     # database + redis must be up before migrating
Push-Location $app
python manage.py migrate --noinput
python manage.py collectstatic --noinput | Out-Null
Pop-Location

# ---- 2. (re)start web + worker ----
Log "restarting web + worker"
& "$PSScriptRoot\run.ps1" restart -NoFrontend | Out-Null
function Test-Server { try { (Invoke-WebRequest "http://127.0.0.1:$Port/api/health/" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $false } }
for ($i = 0; $i -lt 60 -and -not (Test-Server); $i++) { Start-Sleep -Seconds 2 }
if (-not (Test-Server)) { throw "API did not come up on :$Port - see $state\logs\web.err.log" }
$page = try { (Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 10).Content } catch { '' }
Log ("server up on :$Port; site served by Django: " + ($page -match 'id="root"'))
if ($LocalOnly) { Log "local only: store is running at http://localhost:$Port"; return }

function Register($url) {
    for ($i = 1; $i -le 5; $i++) {
        try {
            Invoke-RestMethod -Method Post -Uri "$public/__origin" -Headers @{ 'x-register-secret' = $cfg['REGISTER_SECRET'] } `
                -ContentType 'application/json' -Body (@{ origin = $url } | ConvertTo-Json) -TimeoutSec 30 | Out-Null
            return $true
        } catch { Log "register attempt $i failed: $($_.Exception.Message)"; Start-Sleep -Seconds 5 }
    }
    $false
}

# ---- 3. tunnel + registration loop ----
while ($true) {
    $tlog = "$state\logs\tunnel.log"
    Remove-Item $tlog -ErrorAction SilentlyContinue
    $tunnel = Start-Process $cf -ArgumentList 'tunnel', '--url', "http://127.0.0.1:$Port", '--no-autoupdate' -WindowStyle Hidden -PassThru `
        -RedirectStandardError $tlog -RedirectStandardOutput "$state\logs\tunnel.out.log"
    $url = $null
    for ($i = 0; $i -lt 60 -and -not $url -and -not $tunnel.HasExited; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Path $tlog) { $m = Select-String -Path $tlog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $url = $m.Matches[0].Value } }
    }
    if ($url -and (Register $url)) {
        Log "registered $url -> $public"
        $served = $null
        for ($i = 0; $i -lt 18 -and $served -ne 'local'; $i++) {      # Worker caches the address for up to 60s
            Start-Sleep -Seconds 5
            try { $served = (Invoke-WebRequest "$public/api/health/" -UseBasicParsing -TimeoutSec 30).Headers['x-served-by'] } catch { $served = 'error' }
        }
        Log "permanent link $public is served by: $served"
        while (-not $tunnel.HasExited) {                              # keep alive; refresh registration every 5 min
            if ($tunnel.WaitForExit(300000)) { break }
            if (-not (Test-Server)) { & "$PSScriptRoot\run.ps1" start | Out-Null }
            Register $url | Out-Null
        }
    } else {
        Log "tunnel/registration failed; retrying"
        if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
    }
    Log "tunnel stopped; restarting in 5s"
    Start-Sleep -Seconds 5
}
