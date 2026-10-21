// SchoolStore preview: the newest React build in front of the live store.
//
//   visitor -> this Worker -> React app (bundled assets, frontend/dist)
//                          -> /api /admin /static /media -> ORIGIN (the live Worker, school-store) -> store server
//
// ORIGIN is a permanent workers.dev address, never a quick tunnel: tunnel addresses change on every restart,
// and the live Worker already keeps track of the current one.

const SERVER_PATH = /^\/(api|admin|static|media)(\/|$)/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!SERVER_PATH.test(url.pathname)) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('x-served-by', 'preview');
      if (!url.pathname.startsWith('/assets/')) out.headers.set('cache-control', 'no-cache');
      return out;
    }

    const origin = new URL(env.ORIGIN);
    const upstream = new Request(new URL(url.pathname + url.search, origin), request);
    // Django checks Origin/Referer on cookie-authenticated writes; present them as the live store's own.
    if (upstream.headers.has('origin')) upstream.headers.set('origin', origin.origin);
    const referer = upstream.headers.get('referer');
    if (referer) {
      const r = new URL(referer);
      upstream.headers.set('referer', origin.origin + r.pathname + r.search);
    }
    return fetch(upstream);
  },
};
