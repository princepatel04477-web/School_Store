# Run the School Store processes using the shared runtime (Z:\runtime on a workstation, E:\runtime on the server).
#   powershell -ExecutionPolicy Bypass -File .\deploy\run.ps1 start|stop|restart|status
# Settings come from <project>\.env (KEY=VALUE per line); deploy\setup.ps1 creates it.
param([Parameter(Mandatory)][ValidateSet('start','stop','restart','status')][string]$Action,
      [int]$Port = 8000,
      [switch]$NoFrontend)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path (Split-Path $project -Parent | Split-Path -Parent) 'runtime'
. "$runtime\env.ps1" | Out-Null

# manage.py may sit in the project root or in backend/
$app = if (Test-Path "$project\backend\manage.py") { "$project\backend" } else { $project }
$state = "$env:SCHOOLSTORE_DATA\school_store"            # pid files + logs live on local disk
New-Item -ItemType Directory -Force "$state\run", "$state\logs" | Out-Null

function Load-Env {
    $f = "$project\.env"
    if (-not (Test-Path $f)) { Write-Warning ".env not found at $f - run deploy\setup.ps1 first"; return }
    Get-Content $f | Where-Object { $_ -match '^\s*[^#\s][^=]*=' } | ForEach-Object {
        $k, $v = $_ -split '=', 2
        [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), 'Process')
    }
}
function Is-Running($name) {
    $pidFile = "$state\run\$name.pid"
    (Test-Path $pidFile) -and [bool](Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue)
}
function Start-One($name, $exe, $argList, $dir) {
    if (Is-Running $name) { "${name}: already running"; return }
    $p = Start-Process $exe -ArgumentList $argList -WorkingDirectory $dir -WindowStyle Hidden -PassThru `
         -RedirectStandardOutput "$state\logs\$name.out.log" -RedirectStandardError "$state\logs\$name.err.log"
    $p.Id | Set-Content "$state\run\$name.pid"; "${name}: started (pid $($p.Id))"
}
function Stop-One($name) {
    if (Is-Running $name) { Stop-Process -Id (Get-Content "$state\run\$name.pid") -Force -ErrorAction SilentlyContinue; "${name}: stopped" }
    Remove-Item "$state\run\$name.pid" -Force -ErrorAction SilentlyContinue
}
$all = 'web','worker','frontend'

switch ($Action) {
    { $_ -in 'start','restart' } {
        if ($_ -eq 'restart') { $all | ForEach-Object { Stop-One $_ } }
        & "$runtime\services.ps1" start
        Load-Env
        Start-One 'web'    python @('-m','waitress',"--listen=0.0.0.0:$Port",'--threads=8','config.wsgi:application') $app
        Start-One 'worker' python @('-m','celery','-A','config','worker','--pool=solo','-l','info') $app
        if (-not $NoFrontend -and (Test-Path "$project\frontend\node_modules\vite\bin\vite.js")) {
            if ($env:SCHOOLSTORE_ON_NETWORK -eq '1') { $env:CHOKIDAR_USEPOLLING = 'true'; $env:CHOKIDAR_INTERVAL = '2000' }  # file watching fails on SMB
            # production (DJANGO_DEBUG=0 + built dist): serve the build with `vite preview`; otherwise the dev server
            $mode = if ($env:DJANGO_DEBUG -eq '0' -and (Test-Path "$project\frontend\dist\index.html")) { 'preview' } else { $null }
            $viteArgs = @('node_modules\vite\bin\vite.js') + @($mode | Where-Object { $_ }) + @('--host','0.0.0.0','--port','5173')
            Start-One 'frontend' "$runtime\node\node.exe" $viteArgs "$project\frontend"
        }
        Write-Host "`nAPI: http://localhost:$Port/api/health/   Site: http://localhost:5173   Logs: $state\logs"
    }
    'stop'   { $all | ForEach-Object { Stop-One $_ } }
    'status' { $all | ForEach-Object { "${_}: " + $(if (Is-Running $_) { "running (pid $(Get-Content "$state\run\$_.pid"))" } else { 'stopped' }) }; & "$runtime\services.ps1" status }
}
