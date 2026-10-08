# ONE-TIME, ON THE SERVER (needs Administrator; use install-public-link.cmd to launch it elevated).
#   1. runs install-on-server.ps1 (database, migrations, demo data, firewall, auto-start of web+worker)
#   2. registers a startup task "SchoolStorePublic" that runs publish.ps1 (frontend build, tunnel, permanent link)
#   3. starts it now and writes the outcome to deploy\public-link-result.txt
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$result  = "$PSScriptRoot\public-link-result.txt"
try {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrator')
    if (-not $isAdmin) { throw "Run as Administrator." }
    $drive = Split-Path $project -Qualifier
    if ((Get-PSDrive -Name $drive.TrimEnd(':') -ErrorAction SilentlyContinue).DisplayRoot) { throw "This is a network drive ($drive). Run this ON the server (E:\Projects\School_Store\deploy)." }
    if (-not (Test-Path "$PSScriptRoot\public.env")) { throw "deploy\public.env is missing." }

    Write-Host "==> base install (database, demo data, firewall, auto-start)"
    & "$PSScriptRoot\install-on-server.ps1"
    if (-not ((Get-Content "$PSScriptRoot\install-result.txt" -ErrorAction SilentlyContinue | Select-Object -First 1) -like 'OK*')) {
        throw "Base install failed - see deploy\install-log.txt and deploy\install-result.txt"
    }

    Write-Host "==> startup task SchoolStorePublic"
    $action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\publish.ps1`""
    $trigger   = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
    Register-ScheduledTask -TaskName 'SchoolStorePublic' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Stop-ScheduledTask -TaskName 'SchoolStorePublic' -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName 'SchoolStorePublic'

    Write-Host "==> waiting for the permanent link to switch to this server (up to ~4 min)"
    $rt = Join-Path (Split-Path $project -Parent | Split-Path -Parent) 'runtime'
    $log = "$rt\data\school_store\logs\publish.log"
    $ok = $false
    for ($i = 0; $i -lt 48 -and -not $ok; $i++) {
        Start-Sleep -Seconds 5
        if (Test-Path $log) { $ok = [bool](Select-String -Path $log -Pattern 'is served by: local' -Quiet) }
    }
    $pub = ((Get-Content "$PSScriptRoot\public.env" | Where-Object { $_ -like 'PUBLIC_URL=*' }) -split '=', 2)[1]
    if ($ok) { "OK $(Get-Date)`nPermanent link (served by this server): $pub" | Set-Content $result; Write-Host "`nDONE. $pub is now served by this server." }
    else { "STARTED $(Get-Date)`nStill starting - check $log . Link: $pub" | Set-Content $result; Write-Host "`nStarted; not confirmed yet. See $log" }
} catch {
    "FAILED $(Get-Date)`n$($_.Exception.Message)" | Set-Content $result
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
