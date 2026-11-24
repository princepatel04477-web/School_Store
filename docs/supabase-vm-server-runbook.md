# Supabase VM on the store server: runbook for the agent doing the work

**Who this is for:** the Claude session (or person) that will build the Supabase virtual machine on the store server. Read this whole file before running anything. It sets out what to create, the exact order to do it in, and what must never be touched.

**Goal:**
1. Create a Hyper-V virtual machine in the folder `E:\VMs` on the owner's 1 TB partition `E:` (on the 8 TB HDD). **No partition is created or changed.** The owner chose `E:` over the SSD.
2. Keep the existing E: content (the store) untouched.
3. Install Ubuntu, Coolify and Supabase inside the VM, following `docs/self-hosted-supabase-guide.md` steps 4 to 8.

**Not the goal:** moving the store's data, or changing the running store in any way. That is a separate job, done later with the owner's approval.

---

## 1. Server facts (checked 2026-11-24 15:02 IST)

| Item | Value |
|---|---|
| Server | `WIN-T7OPPO21U7R`, LAN IP 192.168.0.125, Windows Server 2016 Standard (10.0.14393) |
| CPU | Intel Xeon Silver 4210R, 10 cores / 20 threads |
| RAM | 32 GB (about 21 GB free) |
| **Virtualization in BIOS** | **OFF** (`VirtualizationFirmwareEnabled = False`). It must be turned on before Hyper-V can be installed. |
| Hyper-V | Available, not installed |
| VMware / VirtualBox / Docker | none installed |
| Active network adapter | `Ethernet 3` (Intel X722, 1 Gbps). `Tailscale` is also up. Ethernet 4, 5 and 6 are disconnected. |

**Disks:**

| Disk | Model | Type | Partitions |
|---|---|---|---|
| Disk 1 | Samsung SSD 860 EVO 1TB (932 GB) | **SSD**, boot + system | Recovery, System, Reserved, **C:** 931 GB (812 GB free) |
| Disk 0 | HGST HUS728T8TALE6L4 (7.45 TB) | HDD | Reserved, **D:** "SERVER" 6.3 TB (not the store's: treat as another app's data), **E:** "New Volume" 1.08 TB (School Store code, runtime, databases, backups) |

**Running services that must keep running:**

| Port | Process | What it is |
|---|---|---|
| 5432 (127.0.0.1 and ::1) | postgres | **Another application's database. Never touch.** |
| 5433 (127.0.0.1) | postgres | The live School Store database, data in `E:\runtime\data\pgdata` |
| 6379 (127.0.0.1) | redis-server | Store cache and queue |
| 8000 (0.0.0.0) | python (waitress) | Store API and site |
| n/a | cloudflared | Tunnel behind the public link https://school-store.aqualite.workers.dev |

Everything above runs from the scheduled task `SchoolStorePublic` (starts at boot as SYSTEM).

## 2. Hard rules

Break none of these. If a step seems to need one of them broken, stop and ask the owner.

1. **Do not touch** any of these: the Postgres on port 5432 and its files, anything on `D:`, the store's Postgres on 5433, `E:\runtime\data\pgdata`, `E:\Projects\School_Store` (code, `.env`, `deploy\backup.env`, `deploy\public.env`), the `SchoolStorePublic` task, waitress, Redis, cloudflared, Tailscale.
2. **Disks: no disk or partition changes at all.** Never run `Resize-Partition`, `New-Partition`, `Clear-Disk`, `Initialize-Disk`, `Remove-Partition`, `Format-Volume`, `diskpart` or Disk Management on any disk. On `E:`, create files only inside the new folders `E:\VMs` and `E:\ISO`.
3. **No reboot, shutdown, service restart or Windows Update** unless the owner says yes at that moment. This runbook needs two reboots (sections 4 and 6). Ask before each one.
4. **Network:** the only network change allowed is creating the virtual switch in section 7, after asking. Never change IP settings, firewall rules, Tailscale or the router.
5. **Software on Windows:** install nothing except the Hyper-V role. No Docker Desktop, VMware, VirtualBox or WSL. Everything Linux stays inside the VM.
6. **Store data:** do not copy, dump, restore or edit the store's database or `.env`. Step 9 of the setup guide (moving the data) is **out of scope**.
7. **Secrets:** never print, copy or log the contents of `.env`, `backup.env` or `public.env`. The owner types every password (Ubuntu user, Coolify admin) themselves. Never write passwords in the log or the chat.
8. **Stop and ask** when any check does not show the expected result, any command fails, free space is lower than expected, or a step would delete something.
9. **Keep a log:** after each step, append what you ran and the result (no secrets) to `E:\runtime\data\school_store\logs\supabase-vm-setup.log`.

## 3. Read-only checks (change nothing yet)

Open **PowerShell as administrator** on the server and run:

```powershell
Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, MediaType, @{n='SizeGB';e={[math]::Round($_.Size/1GB)}}
Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter, FileSystemLabel, @{n='SizeGB';e={[math]::Round($_.Size/1GB)}}, @{n='FreeGB';e={[math]::Round($_.SizeRemaining/1GB)}}
(Get-CimInstance Win32_Processor).VirtualizationFirmwareEnabled
Get-WindowsFeature Hyper-V | Select-Object Name, InstallState
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 5432,5433,6379,8000 | Select-Object LocalAddress, LocalPort
Invoke-WebRequest https://school-store.aqualite.workers.dev -UseBasicParsing | Select-Object StatusCode, @{n='servedBy';e={$_.Headers['x-served-by']}}
```

Expected:
- `E:` ("New Volume", about 1,085 GB) has at least 1,000 GB free.
- Virtualization shows `False` until section 4 is done.
- Hyper-V shows `Available`.
- Ports 5432, 5433, 6379 and 8000 are listening.
- The live link returns `200` with `servedBy = local`.

Report these results to the owner before going on. Write down the live link result, because you will compare against it after every reboot (sections 4 and 6).

## 4. Owner, at the server: turn on virtualization in the BIOS

The agent cannot do this. It needs someone at the server's screen and keyboard, or its remote management console (iDRAC, iLO or IPMI).

1. Plan about 10 minutes of downtime, for example late at night. The store goes offline while the server restarts.
2. Restart the server and open the BIOS setup (usually **F2**, **Del** or **F11** at the boot logo).
3. Find **Intel Virtualization Technology** (often under Processor or CPU Configuration) and set it to **Enabled**. If there is **Intel VT-d**, enable that too.
4. Save and exit. Windows starts again.

After boot, the agent checks:

```powershell
(Get-CimInstance Win32_Processor).VirtualizationFirmwareEnabled   # must be True
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 5432,5433,6379,8000 | Select-Object LocalPort
```

All four ports must be listening and the live link must return `200 / local` again. `SchoolStorePublic` can take a few minutes after boot. If the store is not back after 10 minutes, stop and tell the owner.

## 5. Prepare the folders on `E:` (no reboot)

The VM lives in `E:\VMs`, on the owner's 1 TB partition. Nothing is partitioned or formatted. `E:` already holds the store under `E:\Projects` and `E:\runtime`, so leave those folders alone.

**Why Hyper-V and not VMware:** Hyper-V is built into Windows Server 2016 Standard, and that licence already covers two VMs. Its VMs start at boot without anyone logging in, and nothing else has to be installed. VMware Workstation runs as a desktop app, so its VMs stop when the user logs off.

1. Check the space:
   ```powershell
   Get-Volume -DriveLetter E | Select-Object DriveLetter, FileSystemLabel, @{n='SizeGB';e={[math]::Round($_.Size/1GB)}}, @{n='FreeGB';e={[math]::Round($_.SizeRemaining/1GB)}}
   ```
   It must show at least 300 GB free (it had 1,078 GB on 2026-11-24).
2. Make sure the folder names are not already in use, then create them:
   ```powershell
   Test-Path E:\VMs, E:\ISO      # both must be False. If either is True, stop and ask.
   New-Item -ItemType Directory -Force E:\VMs\supabase, E:\ISO | Out-Null
   ```

The VM, the store's current database (`E:\runtime\data\pgdata`) and `D:` all share the one 8 TB hard drive. That is fine at the store's current traffic.

## 6. Install Hyper-V (one reboot, ask first)

Ask the owner: "Hyper-V needs a restart. The store will be offline for about 10 minutes. OK to restart now?" Go ahead only on a yes.

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
```

After boot, repeat the checks from section 4 (four ports listening, live link `200 / local`). Then:

```powershell
Get-WindowsFeature Hyper-V | Select-Object InstallState   # Installed
Set-VMHost -VirtualHardDiskPath E:\VMs -VirtualMachinePath E:\VMs
```

## 7. Virtual network switch (a few seconds offline, ask first)

This briefly drops the server's network, including Tailscale and the store tunnel. If you are connected remotely, you may lose the session for up to a minute. It is safest to do this at the server's own screen.

```powershell
New-VMSwitch -Name "LAN" -NetAdapterName "Ethernet 3" -AllowManagementOS $true
```

Check:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq '192.168.0.125' | Select-Object InterfaceAlias, IPAddress
```

It must show `vEthernet (LAN)` with 192.168.0.125. If the server no longer has 192.168.0.125, stop and tell the owner. The fix is `Remove-VMSwitch LAN -Force`, done at the server's screen.

Also check that the live link returns `200 / local` again. The tunnel reconnects by itself within about a minute.

## 8. Create the VM on `E:`

The owner downloads the Ubuntu Server 24.04 LTS ISO to `E:\ISO\`. Use the exact file name in place of `ubuntu-24.04-live-server-amd64.iso` below.

```powershell
New-VHD -Path E:\VMs\supabase\disk.vhdx -SizeBytes 200GB -Fixed
New-VM -Name supabase -Generation 2 -MemoryStartupBytes 8GB -VHDPath E:\VMs\supabase\disk.vhdx -SwitchName LAN -Path E:\VMs
Set-VMMemory supabase -DynamicMemoryEnabled $false
Set-VMProcessor supabase -Count 6
Set-VMFirmware supabase -SecureBootTemplate MicrosoftUEFICertificateAuthority
Add-VMDvdDrive supabase -Path E:\ISO\ubuntu-24.04-live-server-amd64.iso
Set-VMFirmware supabase -FirstBootDevice (Get-VMDvdDrive supabase)
Set-VM supabase -AutomaticStartAction Start -AutomaticStartDelay 60 -AutomaticStopAction ShutDown
Start-VM supabase
vmconnect localhost supabase
```

`New-VHD -Fixed` writes the whole 200 GB to the hard drive, which takes about 20 to 30 minutes. That is expected. A fixed disk stays in one piece on the drive, which matters on an HDD. The store keeps running meanwhile, but may be a little slower.

## 9. Ubuntu, Coolify, Supabase

Follow `docs/self-hosted-supabase-guide.md` **steps 4 to 8 only**, with these changes:
- **VM IP:** 192.168.0.130. First check from the server that `ping 192.168.0.130` gets no reply.
- **Passwords:** the owner types the Ubuntu user password and creates the Coolify admin account (`http://192.168.0.130:8000`) themselves.
- **Postgres tuning (guide step 8):** use the hard-drive values given there.
- **Stop after guide step 8.** Do not do guide step 9 (moving the data) or anything after it.

## 10. Final checks and report

Run and report:

```powershell
Get-VM supabase | Select-Object Name, State, CPUUsage, @{n='MemGB';e={$_.MemoryAssigned/1GB}}, AutomaticStartAction
Get-Volume -DriveLetter C, D, E | Select-Object DriveLetter, @{n='SizeGB';e={[math]::Round($_.Size/1GB)}}, @{n='FreeGB';e={[math]::Round($_.SizeRemaining/1GB)}}
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 5432,5433,6379,8000 | Select-Object LocalPort
Invoke-WebRequest https://school-store.aqualite.workers.dev -UseBasicParsing | Select-Object StatusCode, @{n='servedBy';e={$_.Headers['x-served-by']}}
& E:\runtime\postgres\bin\psql.exe "postgresql://postgres:<SUPABASE_DB_PASSWORD>@192.168.0.130:54322/postgres?sslmode=prefer" -c "select version();"
```

The owner types the Supabase database password into the last command. Don't save it anywhere.

**Report to the owner:**
- the result of each step (done, skipped, or failed and why)
- the free space on `E:` (about 200 GB less than before), and that `C:` and `D:` are unchanged
- the VM state and its IP
- the Studio address (no passwords)
- that ports 5432, 5433, 6379 and 8000 are still listening and the live link returns `200 / local`
- anything unexpected

## 11. Undo, step by step (only with the owner's yes)

| To undo | Command |
|---|---|
| The VM | `Stop-VM supabase -Force; Remove-VM supabase -Force`, then delete `E:\VMs\supabase` (only that folder) |
| The switch | `Remove-VMSwitch LAN -Force`. The network drops for a few seconds. Do it at the server's screen. |
| Hyper-V | `Uninstall-WindowsFeature Hyper-V -Restart` (reboot) |
| BIOS virtualization | can stay on. It does no harm. |
