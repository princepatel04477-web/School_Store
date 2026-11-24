# Shared by the deploy scripts: how pg_dump / psql reach the store's database.
# Same rule as backend/config/settings.py: DATABASE_URL (for example self-hosted Supabase,
# see docs/self-hosted-supabase-guide.md) wins over the POSTGRES_* lines. server-run.ps1 rewrites
# POSTGRES_HOST/PORT to the old local database at every boot, so scripts must not read those alone.
#
# Usage:  . "$PSScriptRoot\db-connection.ps1"
#         $conn = Get-StoreDbConnection $kv      # $kv = the .env file as a hashtable
#         & pg_dump @($conn.Args) -Fc -f $path   # $conn.Label = host:port/db, safe to log (no password)
# For the POSTGRES_* case it sets $env:PGPASSWORD; remove it when done.
function Get-StoreDbConnection($kv) {
    $url = $kv['DATABASE_URL']
    if ($url) {
        $u = [System.Uri]$url
        $port = if ($u.Port -gt 0) { $u.Port } else { 5432 }
        return @{
            Args  = @('-d', $url)
            Label = '{0}:{1}/{2}' -f $u.Host, $port, $u.AbsolutePath.TrimStart('/')
        }
    }
    foreach ($k in 'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_DB') {
        if (-not $kv[$k]) { throw ".env needs DATABASE_URL or $k" }
    }
    $env:PGPASSWORD = $kv['POSTGRES_PASSWORD']
    @{
        Args  = @('-h', $kv['POSTGRES_HOST'], '-p', $kv['POSTGRES_PORT'], '-U', $kv['POSTGRES_USER'], '-d', $kv['POSTGRES_DB'])
        Label = '{0}:{1}/{2}' -f $kv['POSTGRES_HOST'], $kv['POSTGRES_PORT'], $kv['POSTGRES_DB']
    }
}
