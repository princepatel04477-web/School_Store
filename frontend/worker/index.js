// Cloudflare Worker = the permanent public address of School Store.
//
//   visitor -> this Worker -> React app (bundled assets, frontend/dist)
//                          -> /api /admin /static /media -> tunnel -> Django on OUR OWN SERVER (E: drive machine)
//
// The server's current tunnel address lives in KV key "origin". The server (deploy/publish.ps1)
// refreshes it by POSTing to /__origin with the shared secret every time its tunnel (re)starts.
// If the server or its tunnel is down, server paths get a clear "offline" page (never a different copy of the store).

// Paths Django answers on the server; everything else is the React app.
const SERVER_PATH = /^\/(api|admin|static|media)(\/|$)/;

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

async function forwardToShowcase(env, request, bodyBytes) {
  if (!env.SHOWCASE) return null;
  const init = {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
  };
  if (bodyBytes && !['GET', 'HEAD'].includes(request.method)) {
    init.body = bodyBytes;
  }
  return env.SHOWCASE.fetch(request.url, init);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/__origin') return register(request, env);

    // The React app is served from the assets bundled with this Worker (frontend/dist), so a frontend
    // change goes live with `wrangler deploy` alone. Only the server's own paths go through the tunnel.
    if (!SERVER_PATH.test(url.pathname)) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('x-served-by', 'worker');
      if (!url.pathname.startsWith('/assets/')) out.headers.set('cache-control', 'no-cache');
      return out;
    }

    // Retailer endpoints (/api/retail/...) live on Cloudflare Showcase (D1 + KV).
    const isRetail = url.pathname.startsWith('/api/retail/');
    const isAuth = url.pathname === '/api/auth/token/' || url.pathname === '/api/auth/token/refresh/' || url.pathname === '/api/auth/me/';
    const isPublicRetail = url.pathname.startsWith('/api/public/schools/') || url.pathname.startsWith('/api/public/mockups/');

    const bodyBytes = ['POST', 'PUT', 'PATCH'].includes(request.method)
      ? await request.arrayBuffer()
      : null;

    if (isRetail && env.SHOWCASE) {
      try {
        const scRes = await forwardToShowcase(env, request, bodyBytes);
        if (scRes) {
          const out = new Response(scRes.body, scRes);
          out.headers.set('x-served-by', 'showcase');
          return out;
        }
      } catch (_) {}
    }

    const origin = await env.CONFIG.get('origin', { cacheTtl: 60 });
    if (!origin) {
      if ((isAuth || isRetail || isPublicRetail) && env.SHOWCASE) {
        const scRes = await forwardToShowcase(env, request, bodyBytes);
        if (scRes) return scRes;
      }
      return offline();
    }

    try {
      const headers = new Headers(request.headers);
      headers.set('X-Forwarded-Host', url.host);
      const init = {
        method: request.method,
        headers,
        redirect: request.redirect,
      };
      if (bodyBytes && !['GET', 'HEAD'].includes(request.method)) {
        init.body = bodyBytes;
      }
      const upstreamUrl = new URL(url.pathname + url.search, origin);
      const res = await fetch(upstreamUrl.toString(), init);

      // If Django returns 401 on auth (e.g. retailer account in D1) or 404 on retail/public assets, fall back to showcase
      if (((isAuth && res.status === 401) || ((isRetail || isPublicRetail) && res.status === 404) || TUNNEL_DOWN.has(res.status)) && env.SHOWCASE) {
        try {
          const scRes = await forwardToShowcase(env, request, bodyBytes);
          if (scRes && (scRes.ok || (TUNNEL_DOWN.has(res.status) && scRes.status !== 404))) {
            const out = new Response(scRes.body, scRes);
            out.headers.set('x-served-by', 'showcase-fallback');
            return out;
          }
        } catch (_) {}
      }

      if (TUNNEL_DOWN.has(res.status)) return offline();
      const out = new Response(res.body, res);
      out.headers.set('x-served-by', 'local');
      return out;
    } catch (_) {
      if ((isAuth || isRetail || isPublicRetail) && env.SHOWCASE) {
        try {
          const scRes = await forwardToShowcase(env, request, bodyBytes);
          if (scRes) return scRes;
        } catch (_) {}
      }
      return offline();
    }
  },
};
