#!/bin/sh
# Tells the School Store Worker where the Supabase catalogue tunnel is (KV "sb_origin").
# Registers when the quick-tunnel address changes, and once an hour anyway (KV writes are limited).
D=/opt/supabase-setup/store-api
STATE=/var/lib/store-api-register
mkdir -p "$STATE"
host=$(curl -s --max-time 5 http://127.0.0.1:20241/quicktunnel | grep -oE '[a-z0-9-]+\.trycloudflare\.com' | head -1)
[ -n "$host" ] || { echo "no tunnel address yet"; exit 0; }
origin="https://$host"
last=$(cat "$STATE/last" 2>/dev/null || true)
if [ "$origin" = "$last" ] && [ -n "$(find "$STATE/last" -mmin -60 2>/dev/null)" ]; then exit 0; fi
# The tunnel must answer before the Worker is pointed at it.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "x-store-edge: $(cat $D/edge.secret)" "$origin/rpc/grades")
[ "$code" = 200 ] || { echo "tunnel $origin not answering yet ($code)"; exit 0; }
res=$(curl -s --max-time 30 -X POST https://school-store.aqualite.workers.dev/__origin \
  -H "x-register-secret: $(cat $D/register.secret)" -H 'content-type: application/json' \
  -d "{\"origin\":\"$origin\",\"target\":\"supabase\"}")
case "$res" in
  *'"target":"supabase"'*) echo "$origin" > "$STATE/last"; echo "registered $origin";;
  *) echo "register refused: $res";;
esac
