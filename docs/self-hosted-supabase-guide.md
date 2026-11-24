# Self-hosted Supabase on the store server

Goal: run Supabase (with the Studio dashboard) on the store server 192.168.0.125 and move the School Store database into it.

**Setup:** Windows Server 2016 (Xeon Silver, 32 GB RAM, 8 TB HDD) runs Hyper-V. Inside it, an Ubuntu 24.04 VM runs Coolify, and Coolify runs Supabase. The store (Django) keeps running on Windows and connects to Supabase's Postgres over the LAN.

| Thing | Value used in this guide | Change if needed |
|---|---|---|
| Store server | 192.168.0.125 | |
| VM name | `supabase` | |
| VM IP | 192.168.0.130 | pick any free IP on your LAN (`ping 192.168.0.130` must fail first) |
| VM size | 6 cores, 8 GB RAM, 200 GB fixed disk | raise RAM later if needed (step 12) |
| Supabase Postgres port for the store | 54322 | |
| Current store database | Postgres 17.11 on 127.0.0.1:5433 | do not touch port 5432 (another app) |

Planned downtime: about 10 minutes for the Hyper-V reboot (step 1), a few seconds for the network switch (step 2), and 10 to 15 minutes for the move (step 9). Do steps 1, 2 and 9 late at night.

---

## 0. Before you start

1. Take a backup of the current database (run on the server, in PowerShell as administrator):
   ```powershell
   cd E:\Projects\School_Store
   powershell -ExecutionPolicy Bypass -File .\deploy\backup-to-cloudflare.ps1
   ```
   If `deploy\backup.env` is not set up, use a plain dump instead (step 9.2 shows the command).
2. Download the Ubuntu Server 24.04 LTS ISO from ubuntu.com to `E:\ISO\`.

## 1. Turn on Hyper-V (one reboot)

PowerShell as administrator on the server:

```powershell
Get-WindowsFeature Hyper-V
systeminfo | findstr /i "Hyper-V Virtualization"
```

- `Get-WindowsFeature` must list Hyper-V as available.
- `systeminfo` must say virtualization is enabled in firmware. If it says "No", turn on Intel VT-x in the server BIOS first.

Then install (the server restarts by itself):

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
```

After the restart, check the store comes back on its own (the `SchoolStorePublic` task starts at boot). Open the live link and log in once.

## 2. Create the network switch (a few seconds offline)

```powershell
Get-NetAdapter
New-VMSwitch -Name "LAN" -NetAdapterName "Ethernet" -AllowManagementOS $true
```

Replace `Ethernet` with the name of the adapter that is "Up" in `Get-NetAdapter`. The server's network drops for a few seconds. Afterwards run `ipconfig` and check the server still has 192.168.0.125 (it moves to an adapter called `vEthernet (LAN)`).

## 3. Create the VM

```powershell
New-Item -ItemType Directory -Force E:\VMs\supabase
New-VHD -Path E:\VMs\supabase\disk.vhdx -SizeBytes 200GB -Fixed
New-VM -Name supabase -Generation 2 -MemoryStartupBytes 8GB -VHDPath E:\VMs\supabase\disk.vhdx -SwitchName LAN
Set-VMMemory supabase -DynamicMemoryEnabled $false
Set-VMProcessor supabase -Count 6
Set-VMFirmware supabase -SecureBootTemplate MicrosoftUEFICertificateAuthority
Add-VMDvdDrive supabase -Path E:\ISO\ubuntu-24.04-live-server-amd64.iso
Set-VMFirmware supabase -FirstBootDevice (Get-VMDvdDrive supabase)
Set-VM supabase -AutomaticStartAction Start -AutomaticStartDelay 60 -AutomaticStopAction ShutDown
Start-VM supabase
vmconnect localhost supabase
```

- Use the exact ISO file name you downloaded.
- `New-VHD -Fixed` writes the whole 200 GB, which takes 20 to 30 minutes on a hard drive. That is expected. A fixed disk stays in one piece on the drive, which matters on an HDD.
- If the server has more than one physical drive, put `E:\VMs` on a drive that the other app's database does not use.
- The `SecureBootTemplate` line is required, or Ubuntu will not boot.

## 4. Install Ubuntu

In the `vmconnect` window:

1. Choose **Ubuntu Server** (not minimized).
2. Network: set a **static IP**. Subnet `192.168.0.0/24`, address `192.168.0.130`, gateway = your router (usually `192.168.0.1`), name servers `1.1.1.1,8.8.8.8`.
3. Use the entire disk.
4. Tick **Install OpenSSH server**. Skip the extra snaps.
5. When it asks to remove the install media, close the window and run `Set-VMFirmware supabase -FirstBootDevice (Get-VMHardDiskDrive supabase)` on the server, then `Start-VM supabase`.

Log in (from the server with `ssh youruser@192.168.0.130`, or in `vmconnect`) and run:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y linux-tools-virtual linux-cloud-tools-virtual sysstat
sudo timedatectl set-timezone Asia/Kolkata
sudo reboot
```

## 5. Install Coolify

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

Open `http://192.168.0.130:8000` in a browser on the LAN and create the Coolify admin account with a strong password. (Port 8000 here is the VM's, so it does not clash with the store's waitress on the Windows side.) Coolify sets up "localhost" as its server automatically.

## 6. Install Supabase

In Coolify:

1. **Projects > + Add**, name it `School Store`, open the `production` environment.
2. **+ New > Services**, search **Supabase**, pick it.
3. Before deploying, open **Environment Variables**:
   - Note the Studio login (`SERVICE_USER_ADMIN` / `SERVICE_PASSWORD_ADMIN`) and the database password (`SERVICE_PASSWORD_POSTGRES`). The names can differ slightly between Coolify versions. Look for "ADMIN" and "POSTGRES".
   - If there is a `PGRST_DB_SCHEMAS` variable, set it to `storage,graphql_public`. This stops Supabase's public REST API from serving the store's tables (see step 9.4 for why).
4. Click **Deploy**. On a hard drive, the first start takes 5 to 10 minutes. Wait until every part shows healthy.
5. Open the Studio link Coolify shows for the service (the `supabasekong` address, something like `http://supabasekong-xxxx.192.168.0.130.sslip.io`) and log in.
6. In Studio's SQL editor, run `select version();` and note whether it says 15 or 17.

## 7. Let the store server reach Supabase's Postgres

In Coolify, open the Supabase service, **Edit Compose File**, find the `supabase-db` service and add:

```yaml
    ports:
      - "54322:5432"
```

Save and **Restart** the service. Then test from the Windows server (PowerShell):

```powershell
E:\runtime\postgres\bin\psql.exe "postgresql://postgres:<SUPABASE_DB_PASSWORD>@192.168.0.130:54322/postgres?sslmode=prefer" -c "select version();"
```

It must print the Postgres version.

**Security:**
- Never forward ports 8000, 54322 or the Studio port on your router. Studio and the database are for the LAN only.
- Docker opens published ports past Ubuntu's `ufw` firewall, so `ufw` alone does not protect port 54322. Optional, to allow only the store server:
  ```bash
  sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 54322 ! -s 192.168.0.125 -j DROP
  ```
  This rule is lost on reboot. To keep it, add it to a startup script, or leave it out and rely on the long password and LAN-only access.

## 8. Tune Postgres for the hard drive

The store connects as `postgres`, which in Supabase is not a superuser, so run this as `supabase_admin` inside the VM:

```bash
DB=$(sudo docker ps --filter name=supabase-db --format '{{.Names}}')
sudo docker exec -it "$DB" psql -U supabase_admin -d postgres
```

```sql
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET effective_cache_size = '5GB';
ALTER SYSTEM SET wal_compression = 'on';
ALTER SYSTEM SET checkpoint_timeout = '15min';
ALTER SYSTEM SET max_wal_size = '4GB';
\q
```

```bash
sudo docker restart "$DB"
```

Leave `random_page_cost` at its default of 4, which is correct for a hard drive.

These values suit an 8 GB VM. If you raise the VM to 16 GB later, change them to `4GB` and `10GB`.

## 9. Move the store's data (10 to 15 minutes offline)

All commands run on the Windows server in PowerShell as administrator. The old database's user, database name and password are in `E:\Projects\School_Store\.env` (`POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`).

### 9.1 Stop the store

```powershell
schtasks /end /tn SchoolStorePublic
Get-NetTCPConnection -LocalPort 5433 -State Listen
```

The live link now shows the "offline" page. The old Postgres on 5433 must still be listening. If `Get-NetTCPConnection` shows nothing, start it:

```powershell
E:\runtime\postgres\bin\pg_ctl.exe start -D E:\runtime\data\pgdata
```

### 9.2 Dump the old database

```powershell
$env:PGPASSWORD = "<OLD_POSTGRES_PASSWORD>"
E:\runtime\postgres\bin\pg_dump.exe -h 127.0.0.1 -p 5433 -U <POSTGRES_USER> -d <POSTGRES_DB> -Fc -f E:\runtime\data\school_store\move-to-supabase.dump
```

### 9.3 Restore into Supabase

Use the server's own `pg_restore` (version 17.11). It can restore into Supabase whether Supabase runs Postgres 15 or 17.

```powershell
$env:PGPASSWORD = "<SUPABASE_DB_PASSWORD>"
E:\runtime\postgres\bin\pg_restore.exe --no-owner --no-privileges -h 192.168.0.130 -p 54322 -U postgres -d postgres E:\runtime\data\school_store\move-to-supabase.dump
Remove-Item Env:PGPASSWORD
```

At the end, `pg_restore` may report some errors. These are harmless:
- `schema "public" already exists`
- `unrecognized configuration parameter "transaction_timeout"` (only when Supabase runs Postgres 15)
- `must be owner of extension ...`

Any error that mentions a table, `COPY` or an index is **not** harmless. In that case stop here and keep using the old database (skip to step 11).

### 9.4 Lock the tables away from Supabase's public API

Supabase normally lets its public REST API read tables in the `public` schema. That is where the store's tables now are, including users and orders. The store does not use that API, so close it off. Run in Studio's SQL editor:

```sql
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
```

Django connects as `postgres`, which owns the tables, so row level security does not block the store. It only blocks Supabase's API roles, and it also clears Studio's "RLS disabled" warnings.

Together with `PGRST_DB_SCHEMAS` from step 6, this means two separate locks.

### 9.5 Check nothing is missing

Run this against both databases and compare the numbers. They must match.

```powershell
$q = "select (select count(*) from accounts_user) users, (select count(*) from orders_order) orders, (select count(*) from catalog_product) products, (select count(*) from django_migrations) migrations;"
$env:PGPASSWORD = "<OLD_POSTGRES_PASSWORD>"
E:\runtime\postgres\bin\psql.exe -h 127.0.0.1 -p 5433 -U <POSTGRES_USER> -d <POSTGRES_DB> -c $q
$env:PGPASSWORD = "<SUPABASE_DB_PASSWORD>"
E:\runtime\postgres\bin\psql.exe -h 192.168.0.130 -p 54322 -U postgres -d postgres -c $q
Remove-Item Env:PGPASSWORD
```

### 9.6 Point the store at Supabase

Add this line to `E:\Projects\School_Store\.env` (leave the `POSTGRES_*` lines as they are):

```
DATABASE_URL=postgresql://postgres:<SUPABASE_DB_PASSWORD>@192.168.0.130:54322/postgres?sslmode=prefer
```

- `DATABASE_URL` wins over the `POSTGRES_*` lines (`backend/config/settings.py:203`).
- `?sslmode=prefer` is required. Without it, the code asks for SSL (`settings.py:149`), and the self-hosted database may not offer it.
- If the password has characters other than letters and numbers, URL-encode them.

### 9.7 Start the store

```powershell
schtasks /run /tn SchoolStorePublic
```

Wait about a minute, then:
1. Open the live link on your phone and check the shop loads.
2. Log in as a staff user and open the panel.
3. Make a small change (for example a stock number) and check it appears in Studio's table editor.

Connection count: the store uses up to about 48 database connections and Supabase's own services use about 20 to 30, which fits under Postgres's default limit of 100. If you later see "too many connections", lower `DB_POOL_MAX_SIZE` in `.env`.

## 10. Backups (do this the same week)

Self-hosted Supabase does **not** back itself up.

**Important:** the server must have the updated deploy scripts (branch `fix/supabase-db-scripts`) before the move. Older copies of `deploy\backup-to-cloudflare.ps1` and `deploy\import-school-directory.ps1` read only `POSTGRES_HOST` and `POSTGRES_PORT`, which `server-run.ps1` resets to the old database (127.0.0.1:5433) at every boot. They would keep backing up the **old** database. The updated scripts use `DATABASE_URL` when it is set (via `deploy\db-connection.ps1`), the same rule Django uses. Check that `E:\Projects\School_Store\deploy\db-connection.ps1` exists before step 9.

After the move, check the `dumping ...` line in `E:\runtime\data\school_store\logs\backup.log`. It names the database that was backed up and must say `192.168.0.130:54322/postgres`.

Turn on the nightly backup:

```powershell
cd E:\Projects\School_Store
powershell -ExecutionPolicy Bypass -File .\deploy\backup-to-cloudflare.ps1 -Install
```

This runs every night at 02:30, keeps 14 dumps on the server's 8 TB drive, uploads each one to Cloudflare R2 and deletes R2 copies after 30 days (matching the Privacy page).

Before upgrading Coolify or Supabase, also take a Hyper-V checkpoint of the VM. It is a quick undo, not a backup:

```powershell
Checkpoint-VM -Name supabase -SnapshotName "before-upgrade"
```

## 11. Going back (rollback)

1. Remove the `DATABASE_URL` line from `E:\Projects\School_Store\.env`.
2. `schtasks /end /tn SchoolStorePublic` then `schtasks /run /tn SchoolStorePublic`.

The store uses the old database on 5433 again. Orders and changes made while it was on Supabase exist only in Supabase, so copy them back before switching if any came in. Keep the old database running for at least two weeks after the move before retiring it.

## 12. Keeping an eye on the hard drive

In the VM:

```bash
iostat -x 5
```

Also run `free -h`. If `available` memory stays under about 1 GB, or the `si`/`so` columns in `vmstat 5` are often above 0 (the VM is swapping), give it more RAM. Shut the VM down, then on the server:

```powershell
Set-VMMemory supabase -StartupBytes 12GB
Start-VM supabase
```

Watch the `%util` column for the VM's disk (`sda`). If it sits near 100% during busy hours, the hard drive is the limit:
- Add one SATA SSD to the server and move `E:\VMs\supabase\disk.vhdx` onto it (shut the VM down, copy the file, update the VM's disk path). This is the biggest upgrade.
- Or turn off Supabase's analytics and log containers in the Coolify compose file. This cuts constant disk writes, but Studio's Logs page stops working, and the Studio service's `depends_on` for analytics must be removed too.

## Things to check yourself

These depend on your Coolify version and could not be verified ahead of time:
- the exact names of the password variables (step 6)
- whether `PGRST_DB_SCHEMAS` is listed (step 6)
- the `supabase-db` service name in the compose file (step 7)
- whether Supabase runs Postgres 15 or 17 (step 6.6). Either works with step 9.3.
