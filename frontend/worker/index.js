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

// Only the Android app shell, local dev and our own Workers may read API replies cross-origin.
// Anyone can create a *.workers.dev or *.trycloudflare.com site, so those suffixes are not trusted.
const CORS_ORIGINS = new Set(['https://localhost', 'capacitor://localhost', 'http://localhost:5173']);
const OWN_WORKER_ORIGIN = /^https:\/\/[a-z0-9-]+\.aqualite\.workers\.dev$/;

/** CORS headers for an allowed Origin, or null (then no CORS headers are added). */
function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  if (!CORS_ORIGINS.has(origin) && !OWN_WORKER_ORIGIN.test(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      request.headers.get('Access-Control-Request-Headers') ||
      'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

function offline(request) {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'retry-after': '60',
    'cache-control': 'no-store',
    'x-served-by': 'none',
  };
  const cors = request ? getCorsHeaders(request) : null;
  if (cors) Object.assign(headers, cors);
  return new Response(OFFLINE_PAGE, {
    status: 503,
    headers,
  });
}

// KV keys: "origin" = Django on the store server, "sb_origin" = the Supabase catalogue API on the database server.
const ORIGIN_KEYS = { django: 'origin', supabase: 'sb_origin' };

async function register(request, env) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const enc = new TextEncoder();
  const given = enc.encode(request.headers.get('x-register-secret') || '');
  const want = enc.encode(env.REGISTER_SECRET || '');
  if (!want.length || given.length !== want.length || !crypto.subtle.timingSafeEqual(given, want)) {
    return new Response('forbidden', { status: 403 });
  }
  const { origin, target = 'django' } = await request.json().catch(() => ({}));
  if (!ORIGIN_OK.test(origin || '')) return new Response('bad origin', { status: 400 });
  const key = ORIGIN_KEYS[target];
  if (!key) return new Response('bad target', { status: 400 });
  await env.CONFIG.put(key, origin);
  return Response.json({ ok: true, origin, target });
}

// ---- Phase 1 of the Supabase move: the public catalogue is answered by Supabase ----
//
// GET requests for schools, cities, branches, classes and products go to the store_api functions
// (supabase/store_api.sql) through the database server's tunnel. Only well-formed requests are sent there,
// and only a 200 answer is used: anything else (odd parameters, errors, Supabase down or slow)
// goes to Django exactly as before. Set KV "sb_catalogue" to "off" to send everything to Django.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENDER_WORDS = new Set(['boy', 'girl', 'male', 'female', 'm', 'f']);
const SUPABASE_TIMEOUT_MS = 4000;

function onlyKeys(params, allowed) {
  for (const key of params.keys()) if (!allowed.includes(key)) return false;
  return true;
}

/** Optional ?school=: absent or blank means every school; anything but a UUID goes to Django. */
function schoolArg(params, args) {
  const school = (params.get('school') || '').trim();
  if (!school) return true;
  if (!UUID_RE.test(school)) return false;
  args.school = school;
  return true;
}

/** Map one public catalogue request to {fn, args}, or null when Django should answer it. */
function catalogueCall(url) {
  const p = url.searchParams;
  const path = url.pathname;
  let m;
  if (path === '/api/public/schools/') {
    if (!onlyKeys(p, ['search'])) return null;
    const search = (p.get('search') || '').trim();
    return { fn: 'schools', args: search ? { search } : {} };
  }
  if (path === '/api/public/schools/delivered/' || path === '/api/public/schools/logos/') {
    return p.toString() ? null : { fn: 'schools_delivered', args: {} };
  }
  if ((m = path.match(/^\/api\/public\/schools\/([^/]+)\/cities\/$/))) {
    if (!UUID_RE.test(m[1]) || p.toString()) return null;
    return { fn: 'school_cities', args: { school_id: m[1] } };
  }
  if (path === '/api/public/states/') {
    const args = {};
    if (!onlyKeys(p, ['school']) || !schoolArg(p, args)) return null;
    return { fn: 'states', args };
  }
  if (path === '/api/public/cities/') {
    const state = (p.get('state') || '').trim();
    const args = { state };
    if (!state || !onlyKeys(p, ['state', 'school']) || !schoolArg(p, args)) return null;
    return { fn: 'cities', args };
  }
  if ((m = path.match(/^\/api\/public\/cities\/([^/]+)\/branches\/$/))) {
    const args = { city_id: m[1], media_base: url.origin };
    if (!UUID_RE.test(m[1]) || !onlyKeys(p, ['search', 'school']) || !schoolArg(p, args)) return null;
    const search = (p.get('search') || '').trim();
    if (search) args.search = search;
    return { fn: 'city_branches', args };
  }
  if (path === '/api/public/grades/') {
    return p.toString() ? null : { fn: 'grades', args: {} };
  }
  if (path === '/api/public/products/') {
    // Later pages (?cursor=) stay on Django, which made the cursor.
    if (!onlyKeys(p, ['school', 'class', 'grade', 'gender', 'city', 'category', 'product_type', 'page_size'])) return null;
    const school = p.get('school') || '';
    const grade = p.get('class') || p.get('grade') || '';
    const gender = p.get('gender') || '';
    const city = p.get('city') || '';
    if (!UUID_RE.test(school) || !grade || !GENDER_WORDS.has(gender.trim().toLowerCase())) return null;
    if (city && !UUID_RE.test(city)) return null;
    const args = { school, grade, gender };
    if (city) args.city = city;
    if (p.get('category')) args.category = p.get('category');
    if (p.get('product_type')) args.product_type = p.get('product_type');
    if (p.has('page_size')) {
      // DRF: a positive whole number, capped at 50; anything else means the default 25.
      const raw = p.get('page_size');
      const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : 0;
      args.page_size = String(n > 0 ? Math.min(n, 50) : 25);
    }
    return { fn: 'products', args };
  }
  return null;
}

/** DRF CursorPagination link for the page after `afterId` (same as Django's own next link). */
function nextPageLink(url, afterId) {
  const next = new URL(url.toString());
  next.searchParams.set('cursor', btoa(`p=${afterId}`));
  next.searchParams.sort();
  return next.toString();
}

async function fromSupabase(request, env, url) {
  if (request.method !== 'GET' || !env.STORE_EDGE_SECRET) return null;
  const call = catalogueCall(url);
  if (!call) return null;
  const [origin, switchValue] = await Promise.all([
    env.CONFIG.get('sb_origin', { cacheTtl: 60 }),
    env.CONFIG.get('sb_catalogue', { cacheTtl: 60 }),
  ]);
  if (!origin || switchValue === 'off') return null;
  try {
    const rpc = new URL(`/rpc/${call.fn}`, origin);
    for (const [k, v] of Object.entries(call.args)) rpc.searchParams.set(k, v);
    const res = await fetch(rpc.toString(), {
      headers: { 'x-store-edge': env.STORE_EDGE_SECRET, accept: 'application/json' },
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    const answer = await res.json();
    if (!answer || answer.status !== 200) return null;   // errors: let Django word them
    let body = answer.body;
    const headers = { 'content-type': 'application/json', 'x-served-by': 'supabase' };
    if (call.fn === 'products') {
      body = {
        next: body.next_after ? nextPageLink(url, body.next_after) : null,
        previous: null,
        results: body.results,
      };
      headers['cache-control'] = 'no-store';
    }
    return attachCors(new Response(JSON.stringify(body), { status: 200, headers }), request);
  } catch (_) {
    return null;
  }
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

function attachCors(res, request) {
  const cors = getCorsHeaders(request);
  if (!cors) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) {
    out.headers.set(k, v);
  }
  return out;
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

    // Answer CORS preflight for the app's own origins here; anything else goes on to Django as before.
    const preflightCors = request.method === 'OPTIONS' ? getCorsHeaders(request) : null;
    if (preflightCors) {
      return new Response(null, { status: 204, headers: preflightCors });
    }

    // Retailer endpoints (/api/retail/...) live on Cloudflare Showcase (D1 + KV).
    const isRetail = url.pathname.startsWith('/api/retail/');
    const isAuth = url.pathname === '/api/auth/token/' || url.pathname === '/api/auth/token/refresh/' || url.pathname === '/api/auth/me/';
    const isStoreTransaction = /^\/api\/(auth\/otp|orders|payments)(\/|$)/.test(url.pathname);
    const isPublicRetail = url.pathname.startsWith('/api/public/schools/') || url.pathname.startsWith('/api/public/mockups/');

    if (url.pathname.startsWith('/api/public/')) {
      const sb = await fromSupabase(request, env, url);
      if (sb) return sb;
    }

    const bodyBytes = ['POST', 'PUT', 'PATCH'].includes(request.method)
      ? await request.arrayBuffer()
      : null;

    if (isRetail && env.SHOWCASE) {
      try {
        const scRes = await forwardToShowcase(env, request, bodyBytes);
        if (scRes) {
          const out = attachCors(new Response(scRes.body, scRes), request);
          out.headers.set('x-served-by', 'showcase');
          return out;
        }
      } catch (_) {}
    }

    const origin = await env.CONFIG.get('origin', { cacheTtl: 60 });
    if (!origin) {
      if ((isAuth || isRetail || isPublicRetail) && env.SHOWCASE) {
        const scRes = await forwardToShowcase(env, request, bodyBytes);
        if (scRes) return attachCors(scRes, request);
      }
      return offline(request);
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

      // Keep live sign-in, orders and payments on the same backend.
      // Preserve structured application errors when Django is reachable.
      if (isStoreTransaction) {
        if (TUNNEL_DOWN.has(res.status) && !res.headers.get('content-type')?.includes('application/json')) {
          return attachCors(offline(), request);
        }
        const out = attachCors(new Response(res.body, res), request);
        out.headers.set('x-served-by', 'local');
        return out;
      }

      // If Django returns 401 on auth (e.g. retailer account in D1) or 404 on retail/public assets, fall back to showcase
      if (
        ((isAuth && res.status === 401) ||
          ((isRetail || isPublicRetail) && res.status === 404) ||
          TUNNEL_DOWN.has(res.status)) &&
        env.SHOWCASE
      ) {
        try {
          const scRes = await forwardToShowcase(env, request, bodyBytes);
          if (scRes && (scRes.ok || (TUNNEL_DOWN.has(res.status) && scRes.status !== 404))) {
            const out = attachCors(new Response(scRes.body, scRes), request);
            out.headers.set('x-served-by', 'showcase-fallback');
            return out;
          }
        } catch (_) {}
      }

      if (TUNNEL_DOWN.has(res.status)) return offline(request);
      const out = attachCors(new Response(res.body, res), request);
      out.headers.set('x-served-by', 'local');
      return out;
    } catch (_) {
      if ((isAuth || isRetail || isPublicRetail) && env.SHOWCASE) {
        try {
          const scRes = await forwardToShowcase(env, request, bodyBytes);
          if (scRes) return attachCors(scRes, request);
        } catch (_) {}
      }
      return offline(request);
    }
  },
};
