// Retail shops on the showcase store: the same API as backend/retail on the Django store, kept in
// Cloudflare D1 (env.DB, schema in migrations/) with logo pictures in KV (env.ORDERS, "logo:" keys).
//
//   Boss       signs in with the BOSS_USERNAME / BOSS_PASSWORD Worker secrets, adds retailers,
//              approves or rejects their school requests.
//   Retailer   signs in with the username and password the Boss gave them, asks for schools.

const BOARDS = { CBSE: 'CBSE', ICSE: 'ICSE', GSEB: 'GSEB (Gujarat Board)', OTHER: 'Other' };
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const PBKDF2_ROUNDS = 100000;
const LOGIN_TRIES = 10; // per username per 10 minutes

const enc = new TextEncoder();
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fields = (errors) => json(errors, 400);
const page = (results) => json({ count: results.length, next: null, previous: null, results });
const now = () => new Date().toISOString();
const clean = (v) => String(v ?? '').trim();

// ---- passwords --------------------------------------------------------------------------------

const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function pbkdf2(password, salt, rounds) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ROUNDS}$${toHex(salt)}$${toHex(await pbkdf2(password, salt, PBKDF2_ROUNDS))}`;
}

export async function checkPassword(password, stored) {
  const [kind, rounds, salt, hash] = String(stored).split('$');
  if (kind !== 'pbkdf2' || !hash) return false;
  return sameText(toHex(await pbkdf2(password, fromHex(salt), Number(rounds))), hash);
}

function sameText(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y);
}

// ---- checks -----------------------------------------------------------------------------------

export const isUdise = (v) => /^\d{11}$/.test(v);
export const isPincode = (v) => /^[1-9]\d{5}$/.test(v);
export const isGst = (v) => /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v);

/** The picture type from its first bytes (PNG, JPEG or WebP), or null. SVG and anything else is refused. */
export function logoType(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const text = String.fromCharCode(...b);
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// ---- the store's cities and showcase schools -------------------------------------------------

export function showcaseCities(data) {
  const byId = new Map();
  for (const list of Object.values(data.cities)) for (const c of list) byId.set(c.id, c);
  for (const s of data.schools) if (s.city && !byId.has(s.city)) byId.set(s.city, { id: s.city, name: s.city_name });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---- who is signed in -------------------------------------------------------------------------

export function bossUser(env) {
  return { id: 'boss', username: env.BOSS_USERNAME || 'boss', role: 'BOSS', first_name: 'Boss', last_name: '', phone: '', email: '' };
}

const staffUser = (row) => ({
  id: row.id,
  username: row.username,
  role: row.role,
  city: row.city,
  first_name: row.first_name,
  last_name: row.last_name,
  phone: row.phone,
  email: row.email,
});

/** Username + password sign-in for the Boss and retailers. Returns the user, or an error response. */
export async function staffSignIn(env, username, password) {
  const name = clean(username).toLowerCase();
  if (!name || !password) return { error: json({ detail: 'Enter your username and password.' }, 400) };
  const triesKey = `login-fail:${name}`;
  const tries = Number((await env.ORDERS.get(triesKey)) || 0);
  if (tries >= LOGIN_TRIES) return { error: json({ detail: 'Too many tries. Wait 10 minutes and try again.' }, 429) };

  let user = null;
  if (env.BOSS_PASSWORD && sameText(name, (env.BOSS_USERNAME || 'boss').toLowerCase())) {
    if (sameText(password, env.BOSS_PASSWORD)) user = bossUser(env);
  } else {
    const row = await env.DB.prepare('SELECT * FROM staff WHERE username = ?').bind(name).first();
    if (row && (await checkPassword(password, row.password_hash))) user = staffUser(row);
  }
  if (!user) {
    await env.ORDERS.put(triesKey, String(tries + 1), { expirationTtl: 600 });
    return { error: json({ detail: 'Wrong username or password.' }, 401) };
  }
  return { user };
}

/** The signed-in staff member for a token payload ({ sid, role }), or null. */
export async function staffFromSession(env, session) {
  if (!session?.sid) return null;
  if (session.role === 'BOSS') return session.sid === 'boss' ? bossUser(env) : null;
  const row = await env.DB.prepare('SELECT * FROM staff WHERE id = ?').bind(session.sid).first();
  return row ? staffUser(row) : null;
}

// ---- rows to API shapes (the same fields as the Django serializers) ---------------------------

async function storeOut(env, row) {
  const owner = await env.DB.prepare('SELECT username, first_name, last_name FROM staff WHERE id = ?').bind(row.owner_id).first();
  const { results: schools } = await env.DB.prepare(
    'SELECT ss.school_id AS id, s.name, s.udise_code, s.active FROM store_schools ss LEFT JOIN schools s ON s.id = ss.school_id WHERE ss.store_id = ? ORDER BY s.name'
  )
    .bind(row.id)
    .all();
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    gst_number: row.gst_number,
    city: row.city,
    city_name: row.city_name,
    username: owner?.username ?? '',
    owner_name: [owner?.first_name, owner?.last_name].filter(Boolean).join(' '),
    schools: schools.map((s) => ({ id: s.id, name: s.name, udise_code: s.udise_code, active: Boolean(s.active) })),
    active: Boolean(row.active),
    created_at: row.created_at,
  };
}

function requestOut(row, existingByUdise = {}) {
  const existing = row.status === 'PENDING' ? existingByUdise[row.udise_code] : null;
  return {
    id: row.id,
    store: row.store_id,
    store_name: row.store_name,
    name: row.name,
    udise_code: row.udise_code,
    address: row.address,
    city: row.city,
    city_name: row.city_name,
    board: row.board,
    board_label: BOARDS[row.board] ?? row.board,
    pincode: row.pincode,
    status: row.status,
    school: row.school_id,
    school_name: row.school_name ?? null,
    reviewed_by_name: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    reject_reason: row.reject_reason,
    existing_school: existing ? { id: existing.id, name: existing.name, has_logo: Boolean(existing.logo_key) } : null,
    created_at: row.created_at,
  };
}

const REQUEST_SELECT =
  'SELECT r.*, st.name AS store_name, sc.name AS school_name FROM school_requests r JOIN stores st ON st.id = r.store_id LEFT JOIN schools sc ON sc.id = r.school_id';

async function existingSchools(env, codes) {
  if (!codes.length) return {};
  const marks = codes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT id, name, udise_code, logo_key FROM schools WHERE udise_code IN (${marks})`)
    .bind(...codes)
    .all();
  return Object.fromEntries(results.map((s) => [s.udise_code, s]));
}

async function myStore(env, user) {
  return env.DB.prepare('SELECT * FROM stores WHERE owner_id = ?').bind(user.id).first();
}

// ---- logos ------------------------------------------------------------------------------------

async function logoResponse(env, key, cacheControl) {
  if (!key) return json({ detail: 'No logo.' }, 404);
  const { value, metadata } = await env.ORDERS.getWithMetadata(key, 'arrayBuffer');
  if (!value) return json({ detail: 'No logo.' }, 404);
  return new Response(value, {
    headers: { 'content-type': metadata?.type || 'application/octet-stream', 'cache-control': cacheControl, 'x-content-type-options': 'nosniff' },
  });
}

// ---- endpoints --------------------------------------------------------------------------------

async function createRetailer(env, request, data) {
  const body = await request.json().catch(() => ({}));
  const cities = showcaseCities(data);
  const errors = {};
  const username = clean(body.username).toLowerCase();
  const password = String(body.password ?? '');
  const gst = clean(body.gst_number).toUpperCase();
  const phone = clean(body.phone).replace(/[\s-]/g, '');
  const city = cities.find((c) => c.id === body.city);
  if (!/^[a-z0-9_.@+-]{3,150}$/.test(username)) errors.username = ['Use 3 or more letters, numbers or _ . @ + -'];
  else if (username === (env.BOSS_USERNAME || 'boss').toLowerCase() || (await env.DB.prepare('SELECT 1 FROM staff WHERE username = ?').bind(username).first()))
    errors.username = ['This username is taken.'];
  if (password.length < 8) errors.password = ['Use at least 8 characters.'];
  if (!clean(body.store_name)) errors.store_name = ['Enter the shop name.'];
  if (!clean(body.address)) errors.address = ['Enter the shop address.'];
  if (!/^\+?\d{10,13}$/.test(phone)) errors.phone = ['Enter a 10-digit phone number.'];
  if (gst && !isGst(gst)) errors.gst_number = ['Enter a valid 15-character GST number, or leave it empty.'];
  if (!city) errors.city = ['Choose the city.'];
  if (Object.keys(errors).length) return fields(errors);

  const staffId = crypto.randomUUID();
  const storeId = crypto.randomUUID();
  const at = now();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO staff (id, username, password_hash, role, first_name, last_name, email, phone, city, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(staffId, username, await hashPassword(password), 'RETAILER', clean(body.first_name), clean(body.last_name), clean(body.email), phone, city.id, at),
    env.DB.prepare('INSERT INTO stores (id, owner_id, name, address, phone, gst_number, city, city_name, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)').bind(
      storeId, staffId, clean(body.store_name), clean(body.address), phone, gst, city.id, city.name, at
    ),
  ]);
  return json(await storeOut(env, await env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(storeId).first()), 201);
}

async function sendRequest(env, request, user, data) {
  const store = await myStore(env, user);
  if (!store || !store.active) return json({ detail: "Your shop isn't set up or is switched off. Contact the store owner." }, 403);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ detail: 'Send the form with the logo.' }, 400);

  const name = clean(form.get('name')).replace(/\s+/g, ' ');
  const udise = clean(form.get('udise_code'));
  const address = clean(form.get('address'));
  const board = clean(form.get('board'));
  const pincode = clean(form.get('pincode'));
  const city = showcaseCities(data).find((c) => c.id === form.get('city'));
  const logo = form.get('logo');
  const errors = {};
  if (!name) errors.name = ['Enter the school name.'];
  if (!isUdise(udise)) errors.udise_code = ['The UDISE code is 11 digits, numbers only.'];
  if (!address) errors.address = ['Enter the school address.'];
  if (!city) errors.city = ['Choose the city.'];
  if (!BOARDS[board]) errors.board = ['Choose the board.'];
  if (!isPincode(pincode)) errors.pincode = ['Enter a 6-digit pincode.'];

  let logoBytes = null;
  let type = null;
  if (!logo || typeof logo === 'string') errors.logo = ['Upload the school logo.'];
  else if (logo.size > MAX_LOGO_BYTES) errors.logo = ['The logo must be 2 MB or smaller.'];
  else {
    logoBytes = await logo.arrayBuffer();
    type = logoType(logoBytes);
    if (!type) errors.logo = ['Upload the logo as a PNG, JPG or WebP picture.'];
  }

  if (!errors.udise_code) {
    const pending = await env.DB.prepare("SELECT 1 FROM school_requests WHERE store_id = ? AND udise_code = ? AND status = 'PENDING'").bind(store.id, udise).first();
    if (pending) errors.udise_code = ['You already sent a request for this school. Wait for the answer.'];
    const mine = await env.DB.prepare('SELECT 1 FROM store_schools ss JOIN schools s ON s.id = ss.school_id WHERE ss.store_id = ? AND s.udise_code = ?')
      .bind(store.id, udise)
      .first();
    if (mine) errors.udise_code = ['This school is already approved for your shop.'];
  }
  if (Object.keys(errors).length) return fields(errors);

  const id = crypto.randomUUID();
  const logoKey = `logo:request:${id}`;
  await env.ORDERS.put(logoKey, logoBytes, { metadata: { type } });
  await env.DB.prepare(
    'INSERT INTO school_requests (id, store_id, name, udise_code, address, city, city_name, board, pincode, logo_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, store.id, name, udise, address, city.id, city.name, board, pincode, logoKey, now())
    .run();
  const row = await env.DB.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).bind(id).first();
  return json(requestOut(row), 201);
}

async function approve(env, request, user, row, data) {
  const body = await request.json().catch(() => ({}));
  const useNewLogo = body.use_new_logo !== false;
  const link = clean(body.school);
  let school = await env.DB.prepare('SELECT * FROM schools WHERE udise_code = ?').bind(row.udise_code).first();
  const statements = [];

  if (school && link && link !== school.id) return fields({ school: [`UDISE code ${row.udise_code} already belongs to ${school.name}.`] });
  if (!school && link) {
    // An older showcase school (no UDISE code yet): give it this code instead of making a duplicate.
    const linked = await env.DB.prepare('SELECT * FROM schools WHERE id = ?').bind(link).first();
    const base = data.schools.find((s) => s.id === link);
    if (linked?.udise_code) return fields({ school: [`${linked.name} already has UDISE code ${linked.udise_code}.`] });
    if (!linked && !base) return fields({ school: ['That school is not on the store.'] });
    school = { id: link, name: linked?.name ?? base.name };
    statements.push(
      env.DB.prepare(
        `INSERT INTO schools (id, name, code, udise_code, city, city_name, address, board, pincode, logo_key, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT (id) DO UPDATE SET udise_code = excluded.udise_code,
           board = CASE WHEN schools.board = '' THEN excluded.board ELSE schools.board END,
           pincode = CASE WHEN schools.pincode = '' THEN excluded.pincode ELSE schools.pincode END,
           logo_key = CASE WHEN ? OR schools.logo_key IS NULL THEN excluded.logo_key ELSE schools.logo_key END`
      ).bind(
        link, school.name, base?.code ?? `UDISE-${row.udise_code}`, row.udise_code, base?.city ?? row.city, base?.city_name ?? row.city_name,
        row.address, row.board, row.pincode, row.logo_key, now(), useNewLogo ? 1 : 0
      )
    );
  } else if (!school) {
    // A new school starts hidden from parents: it goes live once it has uniforms to sell.
    school = { id: crypto.randomUUID(), name: row.name };
    statements.push(
      env.DB.prepare(
        'INSERT INTO schools (id, name, code, udise_code, city, city_name, address, board, pincode, logo_key, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)'
      ).bind(school.id, row.name, `UDISE-${row.udise_code}`, row.udise_code, row.city, row.city_name, row.address, row.board, row.pincode, row.logo_key, now())
    );
  } else if (useNewLogo || !school.logo_key) {
    statements.push(env.DB.prepare('UPDATE schools SET logo_key = ? WHERE id = ?').bind(row.logo_key, school.id));
  }

  statements.push(
    env.DB.prepare('INSERT OR IGNORE INTO store_schools (store_id, school_id) VALUES (?, ?)').bind(row.store_id, school.id),
    env.DB.prepare("UPDATE school_requests SET status = 'APPROVED', school_id = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'PENDING'").bind(
      school.id, user.username, now(), row.id
    )
  );
  await env.DB.batch(statements);
  return json(requestOut(await env.DB.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).bind(row.id).first()));
}

async function reject(env, request, user, row) {
  const { reason } = await request.json().catch(() => ({}));
  if (!clean(reason)) return fields({ reason: ['Tell the retailer why the request is rejected.'] });
  await env.DB.prepare("UPDATE school_requests SET status = 'REJECTED', reject_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'PENDING'")
    .bind(clean(reason).slice(0, 1000), user.username, now(), row.id)
    .run();
  return json(requestOut(await env.DB.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).bind(row.id).first()));
}

/** Public: a school's logo, cached for a day. null when the path isn't a logo path. */
export async function publicLogo(env, path) {
  const m = path.match(/^\/public\/schools\/([^/]+)\/logo\/$/);
  if (!m) return null;
  const school = await env.DB.prepare('SELECT logo_key FROM schools WHERE id = ?').bind(m[1]).first();
  return logoResponse(env, school?.logo_key, 'public, max-age=86400');
}

/**
 * Signed-in staff endpoints: /retail/... for the Boss and retailers, plus the Boss panel's
 * option lists. null when the path isn't one of them.
 */
export async function staffApi(request, env, path, user, data) {
  const method = request.method;
  const isBoss = user?.role === 'BOSS';
  const isRetailer = user?.role === 'RETAILER';
  const forbidden = () => json({ detail: 'You do not have permission to do this.' }, 403);

  if (path.startsWith('/retail/') || path.startsWith('/panel/boss/')) {
    if (!user) return json({ detail: 'Not signed in.' }, 401);
  } else return null;

  // Boss panel lists the retail screens use. The sales charts have no data on the showcase.
  if (path === '/panel/boss/filters/') {
    if (!isBoss) return forbidden();
    const today = new Date().toISOString().slice(0, 10);
    return json({
      cities: showcaseCities(data).map((c) => ({ id: c.id, name: c.name, code: c.code ?? '' })),
      schools: data.schools.map((s) => ({ id: s.id, name: s.name, code: s.code, city_id: s.city })),
      categories: [],
      default_from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
      default_to: today,
    });
  }
  if (path === '/panel/boss/kpis/') {
    if (!isBoss) return forbidden();
    return json({ date_from: '', date_to: '', revenue: '0', cost: '0', gross_profit: '0', gross_margin_pct: '0', orders: 0, units_sold: 0, current_stock_value: '0' });
  }
  if (path.startsWith('/panel/boss/charts/')) return isBoss ? json([]) : forbidden();
  if (path.startsWith('/panel/boss/')) return null;

  if (path === '/retail/cities/' && method === 'GET') return json(showcaseCities(data).map((c) => ({ id: c.id, name: c.name })));

  if (path === '/retail/my-store/') {
    if (!isRetailer) return json({ detail: 'Only retailers have a shop.' }, 403);
    const store = await myStore(env, user);
    return store ? json(await storeOut(env, store)) : json({ detail: 'Not found.' }, 404);
  }

  if (path === '/retail/retailers/') {
    if (!isBoss) return forbidden();
    if (method === 'POST') return createRetailer(env, request, data);
    const { results } = await env.DB.prepare('SELECT * FROM stores ORDER BY name').all();
    return page(await Promise.all(results.map((row) => storeOut(env, row))));
  }

  if (path === '/retail/school-requests/') {
    if (!isBoss && !isRetailer) return forbidden();
    if (method === 'POST') return isRetailer ? sendRequest(env, request, user, data) : json({ detail: 'Only retailers send school requests.' }, 403);
    const status = new URL(request.url).searchParams.get('status');
    const where = [];
    const args = [];
    if (isRetailer) {
      const store = await myStore(env, user);
      if (!store) return page([]);
      where.push('r.store_id = ?');
      args.push(store.id);
    }
    if (STATUSES.includes(status)) {
      where.push('r.status = ?');
      args.push(status);
    }
    const sql = `${REQUEST_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC LIMIT 200`;
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const existing = await existingSchools(env, [...new Set(results.filter((r) => r.status === 'PENDING').map((r) => r.udise_code))]);
    return page(results.map((r) => requestOut(r, existing)));
  }

  const one = path.match(/^\/retail\/school-requests\/([0-9a-f-]{36})\/(?:(logo|approve|reject)\/)?$/);
  if (one) {
    if (!isBoss && !isRetailer) return forbidden();
    const row = await env.DB.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).bind(one[1]).first();
    const store = isRetailer ? await myStore(env, user) : null;
    if (!row || (isRetailer && row.store_id !== store?.id)) return json({ detail: 'Not found.' }, 404);
    const action = one[2];
    if (!action) return json(requestOut(row));
    if (action === 'logo') return logoResponse(env, row.logo_key, 'private, max-age=3600');
    if (method !== 'POST') return json({ detail: 'Method not allowed.' }, 405);
    if (!isBoss) return forbidden();
    if (row.status !== 'PENDING') return json({ detail: `This request was already ${row.status.toLowerCase()}.` }, 409);
    return action === 'approve' ? approve(env, request, user, row, data) : reject(env, request, user, row);
  }

  return json({ detail: 'Not found.' }, 404);
}
