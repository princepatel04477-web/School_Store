// SchoolStore showcase: the whole store on Cloudflare, no store server needed.
//
//   visitor -> this Worker -> React app (bundled assets, frontend/dist)
//                          -> /api/... answered here from showcase-data.json (catalogue exported
//                             from the real backend) and KV (orders)
//
// Parent sign-in works like the real store, but the one-time code is shown on screen instead of
// being sent by SMS. "My children" are example children, one boy and one girl per school.
// Orders are kept in KV under the parent's phone. Refresh the catalogue with the export in the PR.
// Staff (the Boss and retail shops) sign in with a username and password: see showcaseRetail.js.

import DATA from './showcase-data.json';
import PHOTOS from './showcase-photos.json';
import { publicLogo, showcaseCities, staffApi, staffFromSession, staffSignIn } from './showcaseRetail.js';

const PHOTO_SET = new Set(PHOTOS);
const SCHOOLS_BY_ID = Object.fromEntries(DATA.schools.map((s) => [s.id, s]));
const VARIANTS = {};
for (const p of Object.values(DATA.products)) for (const v of p.variants) VARIANTS[v.id] = p;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
const notHere = () => json({ detail: 'This is not available in the showcase store.' }, 404);

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

// ---- sign-in: a code per phone per 10 minutes, and signed tokens ----
async function otpFor(env, phone, windowOffset = 0) {
  const slot = Math.floor(Date.now() / 600000) - windowOffset;
  const mac = await hmac(env.SHOWCASE_SECRET, `otp:${phone}:${slot}`);
  const n = [...mac].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1000000, 7);
  return String(n).padStart(6, '0');
}

/** A signed token for a parent ({ phone }) or a staff member ({ sid, role }). */
async function makeToken(env, subject, days) {
  const body = b64url(enc.encode(JSON.stringify({ ...subject, exp: Date.now() + days * 86400000 })));
  return `${body}.${await hmac(env.SHOWCASE_SECRET, body)}`;
}

/** The token's subject ({ phone } or { sid, role }), or null when it is missing, forged or expired. */
async function readToken(env, request, raw) {
  const token = raw ?? (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [body, sig] = token.split('.');
  if (!body || !sig || sig !== (await hmac(env.SHOWCASE_SECRET, body))) return null;
  try {
    const data = JSON.parse(fromB64url(body));
    if (!(data.exp > Date.now())) return null;
    if (data.phone) return { phone: data.phone };
    return data.sid ? { sid: data.sid, role: data.role } : null;
  } catch {
    return null;
  }
}

async function tokensFor(env, subject) {
  return { access: await makeToken(env, subject, 1), refresh: await makeToken(env, subject, 7) };
}

const parentUser = (phone) => ({
  id: `parent-${phone}`,
  username: phone,
  role: 'PARENT',
  phone,
  first_name: 'Parent',
  last_name: '',
});

// ---- example children: a boy and a girl at every school ----
const PHOTO_PREFIX = { 'DPS-SUR': 'dps', 'FHS-SUR': 'fhs', 'UDG-AMD': 'udg' };
function exampleChildren() {
  return DATA.schools.flatMap((s) =>
    ['boy', 'girl'].map((g) => ({
      id: `demo-${s.code}-${g}`,
      name: g === 'boy' ? 'Aarav Sharma' : 'Ananya Sharma',
      gr_number: `${s.code}-2026-${g === 'boy' ? '014' : '027'}`,
      grade_name: 'Class 5',
      class_name: 'Class 5',
      section: 'B',
      gender: g === 'boy' ? 'MALE' : 'FEMALE',
      date_of_birth: g === 'boy' ? '2016-08-14' : '2016-03-02',
      school: s.id,
      school_name: s.name,
      school_code: s.code,
      active: true,
      parent_name: 'Rohit Sharma',
      photo_url: PHOTO_SET.has(`idphoto-${PHOTO_PREFIX[s.code] ?? 'dps'}-${g}.webp`)
        ? `/products/idphoto-${PHOTO_PREFIX[s.code] ?? 'dps'}-${g}.webp`
        : '',
    }))
  );
}

// ---- catalogue ----
function publicProduct(p) {
  return {
    ...p,
    photo: undefined,
    thumbnail: p.photo && PHOTO_SET.has(p.photo) ? `/products/${p.photo}` : null,
  };
}

async function readJson(request) {
  return request.json().catch(() => ({}));
}

async function placeOrder(env, phone, request) {
  const body = await readJson(request);
  const key = request.headers.get('idempotency-key') || body.idempotency_key;
  if (!key) return json({ detail: 'Missing idempotency key.' }, 400);
  const seen = await env.ORDERS.get(`idem:${phone}:${key}`);
  if (seen) return json(JSON.parse(seen), 200);

  const child = exampleChildren().find((c) => c.id === body.student) ?? null;
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ detail: 'The bag is empty.' }, 400);
  let total = 0;
  const lines = [];
  for (const item of items) {
    const product = VARIANTS[item.variant];
    const qty = Math.max(1, Math.min(20, Number(item.quantity) || 1));
    if (!product) return json({ detail: 'This item is not available.' }, 400);
    const size = product.variants.find((v) => v.id === item.variant)?.size;
    total += product.price * qty;
    lines.push({ name: product.name, size, quantity: qty, price: product.price });
  }
  const now = new Date();
  const order = {
    id: crypto.randomUUID(),
    order_number: `SS-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`,
    total: total.toFixed(2),
    student_name: child?.name ?? '',
    fulfillment_type: body.fulfillment_type || 'HOME_DELIVERY',
  };
  const record = {
    ...order,
    status: 'CONFIRMED',
    payment_status: 'PENDING',
    payment_method: 'COD',
    created_at: now.toISOString(),
    school_name: child?.school_name ?? '',
    phone,
    delivery_details: body.delivery_details ?? {},
    items: lines,
  };
  await env.ORDERS.put(`order:${phone}:${now.getTime()}:${order.id}`, JSON.stringify(record), {
    expirationTtl: 60 * 60 * 24 * 90,
  });
  await env.ORDERS.put(`idem:${phone}:${key}`, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 * 7 });
  return json(order, 201);
}

async function listOrders(env, phone) {
  const list = await env.ORDERS.list({ prefix: `order:${phone}:` });
  const orders = await Promise.all(list.keys.map((k) => env.ORDERS.get(k.name, 'json')));
  const results = orders.filter(Boolean).reverse().map((o) => ({
    id: o.id,
    order_number: o.order_number,
    student_name: o.student_name,
    status: o.status,
    payment_status: o.payment_status,
    total: Number(o.total),
    created_at: o.created_at,
    status_events: [{ status: o.status, timestamp: o.created_at }],
  }));
  return json({ count: results.length, next: null, previous: null, results });
}

async function api(request, env, path) {
  const url = new URL(request.url);
  const method = request.method;

  if (path === '/health/') return json({ status: 'ok', store: 'showcase' });

  // Public catalogue
  if (path === '/public/schools/' && method === 'GET') {
    const q = (url.searchParams.get('search') || '').toLowerCase();
    return json(DATA.schools.filter((s) => !q || s.name.toLowerCase().includes(q)));
  }
  const citiesMatch = path.match(/^\/public\/schools\/([^/]+)\/cities\/$/);
  if (citiesMatch) return DATA.cities[citiesMatch[1]] ? json(DATA.cities[citiesMatch[1]]) : json({ detail: 'School not found.' }, 404);
  if (path === '/public/products/' && method === 'GET') {
    const school = url.searchParams.get('school');
    const cls = url.searchParams.get('class') || '';
    const gender = url.searchParams.get('gender');
    if (!SCHOOLS_BY_ID[school]) return json({ detail: 'School not found.' }, 404);
    const className = /^\d+$/.test(cls) ? `Class ${cls}` : cls;
    const ids = DATA.index[`${school}|${className}|${gender}`] ?? [];
    const results = ids.map((id) => publicProduct(DATA.products[id]));
    return json({ count: results.length, next: null, previous: null, results });
  }

  // Camera measuring settings: no tape checks behind the showcase, so the reading is used as is.
  if (path === '/public/measure-config/' && method === 'GET') return json({ shoulder_calibration_factor: 1 });

  // Parent sign-in (code shown on screen)
  // Size check: the showcase catalogue has no size charts, so there is nothing to suggest.
  if (path === '/public/size-fit/' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.products) ? body.products.slice(0, 60) : [];
    return json({ fit: null, products: Object.fromEntries(ids.map((id) => [id, { chart: [], recommendation: null }])) });
  }
  if (path === '/auth/otp/send/' && method === 'POST') {
    const { phone } = await readJson(request);
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) return json({ detail: 'Enter a valid 10-digit mobile number.' }, 400);
    return json({ detail: 'Code ready.', phone: digits, otp_debug: await otpFor(env, digits) });
  }
  if (path === '/auth/otp/verify/' && method === 'POST') {
    const { phone, otp } = await readJson(request);
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    const ok = [await otpFor(env, digits), await otpFor(env, digits, 1)].includes(String(otp));
    if (!ok) return json({ detail: 'Wrong code.' }, 400);
    return json({
      access: await makeToken(env, { phone: digits }, 7),
      refresh: await makeToken(env, { phone: digits }, 30),
      user: parentUser(digits),
      created: false,
      children_linked: DATA.schools.length * 2,
    });
  }
  if (path === '/auth/token/refresh/' && method === 'POST') {
    const { refresh } = await readJson(request);
    const subject = await readToken(env, request, refresh || '');
    if (!subject) return json({ detail: 'Session expired.' }, 401);
    return json({ access: await makeToken(env, subject, subject.phone ? 7 : 1) });
  }

  // Staff sign-in (Boss and retail shops): username and password
  if (path === '/auth/token/' && method === 'POST') {
    const { username, password } = await readJson(request);
    const { user, error } = await staffSignIn(env, username, password);
    if (error) return error;
    return json({ ...(await tokensFor(env, { sid: user.id, role: user.role })), user });
  }

  const logo = await publicLogo(env, path);
  if (logo) return logo;

  const session = await readToken(env, request);
  const staff = await staffFromSession(env, session);
  if (session?.sid && !staff) return json({ detail: 'Your account was removed.' }, 401);
  if (path === '/auth/me/' && staff) return json(staff);

  const staffAnswer = await staffApi(request, env, path, staff, DATA);
  if (staffAnswer) return staffAnswer;
  if (staff?.role === 'BOSS' && method === 'GET') {
    // Boss panel lists that have nothing behind them on the showcase.
    if (path === '/cities/') {
      const results = showcaseCities(DATA).map((c) => ({ ...c, state: 'Gujarat', active: true }));
      return json({ count: results.length, next: null, previous: null, results });
    }
    if (path === '/accounts/users/') return json({ count: 0, next: null, previous: null, results: [] });
  }

  // Everything below needs a signed-in parent
  const phone = session?.phone ?? null;
  if (path === '/auth/me/') return phone ? json(parentUser(phone)) : json({ detail: 'Not signed in.' }, 401);
  if (!phone) {
    return path.startsWith('/students/') || path.startsWith('/orders/') ? json({ detail: 'Not signed in.' }, 401) : notHere();
  }
  if (path === '/students/' && method === 'GET') {
    return json({ count: DATA.schools.length * 2, next: null, previous: null, results: exampleChildren() });
  }
  if (path === '/students/claim/' && method === 'POST') {
    const { school } = await readJson(request);
    const child = exampleChildren().find((c) => c.school === school);
    return child ? json(child) : json({ detail: 'No child found with these details.' }, 404);
  }
  if (path === '/orders/' && method === 'POST') return placeOrder(env, phone, request);
  if (path === '/orders/' && method === 'GET') return listOrders(env, phone);
  return notHere();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url.pathname.slice(4));
      } catch (error) {
        return json({ detail: 'Something went wrong.' }, 500);
      }
    }
    if (/^\/(admin|static|media)(\/|$)/.test(url.pathname)) return notHere();

    const res = await env.ASSETS.fetch(request);
    // A code or photo file that isn't there is a 404, not the app's page (an old page can then reload)
    if (/^\/(assets|products)\//.test(url.pathname) && (res.headers.get('content-type') || '').includes('text/html')) {
      return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    }
    const out = new Response(res.body, res);
    out.headers.set('x-served-by', 'showcase');
    if (!url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/products/')) {
      out.headers.set('cache-control', 'no-cache');
    }
    return out;
  },
};
