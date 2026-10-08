# ONE-TIME install ON THE SERVER (needs Administrator). Use install-on-server.cmd to launch it elevated.
#   1. runs setup.ps1 (database, migrations, demo data)
#   2. opens Windows Firewall for the site (5173) and API (8000) on private/domain networks
#   3. registers a startup task that starts the app at boot and restarts anything that crashed
#   4. writes the link to deploy\install-result.txt
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$result  = "$PSScriptRoot\install-result.txt"
Start-Transcript -Path "$PSScriptRoot\install-log.txt" -Force | Out-Null
try {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrator')
    if (-not $isAdmin) { throw "Run as Administrator." }
    $drive = (Split-Path $project -Qualifier)
    if ((Get-PSDrive -Name $drive.TrimEnd(':') -ErrorAction SilentlyContinue).DisplayRoot) { throw "This is a network drive ($drive). Run this ON the server, using its local drive path." }

    Write-Host "==> setup"
    & "$PSScriptRoot\setup.ps1"

    Write-Host "==> firewall"
    foreach ($port in 5173, 8000) {
        if (-not (Get-NetFirewallRule -DisplayName "SchoolStore $port" -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName "SchoolStore $port" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private,Domain | Out-Null
        }
    }

    Write-Host "==> startup task"
    $cmd = "& '$PSScriptRoot\run.ps1' start; while (`$true) { Start-Sleep 120; & '$PSScriptRoot\run.ps1' start | Out-Null }"
    $action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$cmd`""
    $trigger   = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
    Register-ScheduledTask -TaskName 'SchoolStore' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    # run.ps1 from this session already started the app; the task takes over from the next boot (start it now too, idempotent)
    Start-ScheduledTask -TaskName 'SchoolStore'

    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' } | Select-Object -First 1).IPAddress
    "OK $(Get-Date)`nSite: http://${ip}:5173`nAPI health: http://${ip}:8000/api/health/" | Set-Content $result
    Write-Host "`nDONE. Site: http://${ip}:5173"
} catch {
    "FAILED $(Get-Date)`n$($_.Exception.Message)" | Set-Content $result
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
} finally { Stop-Transcript | Out-Null }
