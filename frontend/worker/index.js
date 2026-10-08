// Cloudflare Worker = the permanent public address of School Store.
//
//   visitor -> this Worker -> tunnel -> the store running on OUR OWN SERVER (E: drive machine)
//
// The server's current tunnel address lives in KV key "origin". The server (deploy/publish.ps1)
// refreshes it by POSTing to /__origin with the shared secret every time its tunnel (re)starts.
// If the server or its tunnel is down, visitors get a clear "offline" page (never a different copy of the store).

const TUNNEL_DOWN = new Set([502, 503, 504, 521, 522, 523, 524, 530]);

// Only accept tunnel addresses (quick tunnels now; add your own domain here later).
const ORIGIN_OK = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SchoolStore is offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f3ee;color:#1f2a24;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
h1{font-size:28px;margin:0 0 8px}p{margin:0;color:#55695d}</style></head>
<body><main><h1>SchoolStore is offline</h1><p>The store server is not reachable right now. Please try again in a minute.</p></main></body></html>`;

function offline() {
  return new Response(OFFLINE_PAGE, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '60', 'cache-control': 'no-store', 'x-served-by': 'none' },
  });
}

async function register(request, env) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const enc = new TextEncoder();
  const given = enc.encode(request.headers.get('x-register-secret') || '');
  const want = enc.encode(env.REGISTER_SECRET || '');
  if (!want.length || given.length !== want.length || !crypto.subtle.timingSafeEqual(given, want)) {
    return new Response('forbidden', { status: 403 });
  }
  const { origin } = await request.json().catch(() => ({}));
  if (!ORIGIN_OK.test(origin || '')) return new Response('bad origin', { status: 400 });
  await env.CONFIG.put('origin', origin);
  return Response.json({ ok: true, origin });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/__origin') return register(request, env);

    const origin = await env.CONFIG.get('origin', { cacheTtl: 60 });
    if (!origin) return offline();
    try {
      const upstream = new Request(new URL(url.pathname + url.search, origin), request);
      upstream.headers.set('X-Forwarded-Host', url.host);
      const res = await fetch(upstream);
      if (TUNNEL_DOWN.has(res.status)) return offline();
      const out = new Response(res.body, res);
      out.headers.set('x-served-by', 'local');
      return out;
    } catch (_) {
      return offline();
    }
  },
};
