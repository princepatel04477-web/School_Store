// Uniform sets and their mock-ups on the showcase store (Cloudflare D1 + KV).
//
// A retailer adds a set for one of their approved schools: shirt + pant (boys) or shirt + skirt
// (girls), a shirt photo, a close-up of the bottom's cloth, a class range, price and sizes. The
// mock-up engine runs in the retailer's browser (src/components/admin/retail/mockupEngine.ts): it
// fills the garment of the store's fixed model student for each class with that cloth and sends
// the picture here. Only clothes pixels change, so every school's Class 6 boy is the same boy in
// the same pose. The retailer checks the mock-ups and publishes the set; the Boss can hide any set.

import { logoType } from './showcaseRetail.js';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_MOCKUP_BYTES = 8 * 1024 * 1024;
const FIRST_MODEL_CLASS = 2; // no Class 1 model student yet
const GENDERS = { BOY: 'boy', GIRL: 'girl' };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fields = (errors) => json(errors, 400);
const now = () => new Date().toISOString();
const clean = (v) => String(v ?? '').trim();

// ---- rows to API shapes -------------------------------------------------------------------------

function uniformOut(row, mockups = []) {
  const done = mockups.filter((m) => m.status === 'DONE').length;
  return {
    id: row.id,
    store: row.store_id,
    store_name: row.store_name,
    school: row.school_id,
    school_name: row.school_name,
    gender: row.gender,
    class_from: row.class_from,
    class_to: row.class_to,
    name: row.name,
    price: row.price,
    sizes: JSON.parse(row.sizes || '[]'),
    status: row.status,
    mockups: mockups.map((m) => ({
      id: m.id,
      class_no: m.class_no,
      status: m.status,
      error: m.error,
      image: m.status === 'DONE' ? `/api/public/mockups/${m.id}/` : null,
    })),
    mockups_done: done,
    mockups_total: mockups.length,
    created_at: row.created_at,
  };
}

const UNIFORM_SELECT =
  'SELECT u.*, st.name AS store_name, COALESCE(sc.name, u.school_id) AS school_name FROM uniforms u JOIN stores st ON st.id = u.store_id LEFT JOIN schools sc ON sc.id = u.school_id';

async function loadUniform(env, id) {
  const row = await env.DB.prepare(`${UNIFORM_SELECT} WHERE u.id = ?`).bind(id).first();
  if (!row) return null;
  const { results } = await env.DB.prepare('SELECT * FROM mockups WHERE uniform_id = ? ORDER BY class_no').bind(id).all();
  return { row, mockups: results };
}

// ---- endpoints ----------------------------------------------------------------------------------

async function readPhoto(form, name, errors, label) {
  const file = form.get(name);
  if (!file || typeof file === 'string') {
    errors[name] = [`Add a photo of the ${label}.`];
    return null;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    errors[name] = ['The photo must be 8 MB or smaller.'];
    return null;
  }
  const bytes = await file.arrayBuffer();
  const type = logoType(bytes);
  if (!type) {
    errors[name] = ['Use a PNG, JPG or WebP photo.'];
    return null;
  }
  return { bytes, type };
}

async function createUniform(env, request, store) {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ detail: 'Send the form with both photos.' }, 400);
  const errors = {};
  const school = clean(form.get('school'));
  const gender = clean(form.get('gender'));
  const classFrom = Number(form.get('class_from'));
  const classTo = Number(form.get('class_to'));
  const name = clean(form.get('name')).replace(/\s+/g, ' ');
  const price = Number(form.get('price'));
  const sizes = clean(form.get('sizes'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);

  const approved = school && (await env.DB.prepare('SELECT 1 FROM store_schools WHERE store_id = ? AND school_id = ?').bind(store.id, school).first());
  if (!approved) errors.school = ['Choose one of your approved schools.'];
  if (!GENDERS[gender]) errors.gender = ['Choose boys or girls.'];
  if (!Number.isInteger(classFrom) || classFrom < 1 || classFrom > 12) errors.class_from = ['Choose a class from 1 to 12.'];
  if (!Number.isInteger(classTo) || classTo < 1 || classTo > 12) errors.class_to = ['Choose a class from 1 to 12.'];
  else if (!errors.class_from && classTo < classFrom) errors.class_to = ['The last class must be the same as or after the first.'];
  if (!name) errors.name = ['Name the set, for example "Summer uniform".'];
  if (!Number.isInteger(price) || price <= 0 || price > 100000) errors.price = ['Enter the price of the set in rupees.'];
  if (!sizes.length) errors.sizes = ['Enter the sizes you have, separated by commas.'];
  const top = await readPhoto(form, 'top_photo', errors, 'shirt');
  const bottom = await readPhoto(form, 'bottom_photo', errors, gender === 'GIRL' ? 'skirt cloth' : 'pant cloth');
  if (Object.keys(errors).length) return fields(errors);

  const id = crypto.randomUUID();
  const topKey = `uniform:${id}:top`;
  const bottomKey = `uniform:${id}:bottom`;
  await env.ORDERS.put(topKey, top.bytes, { metadata: { type: top.type } });
  await env.ORDERS.put(bottomKey, bottom.bytes, { metadata: { type: bottom.type } });
  const at = now();
  await env.DB.prepare(
    'INSERT INTO uniforms (id, store_id, school_id, gender, class_from, class_to, name, price, sizes, top_photo_key, bottom_photo_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, store.id, school, gender, classFrom, classTo, name, price, JSON.stringify(sizes), topKey, bottomKey, at, at)
    .run();
  const loaded = await loadUniform(env, id);
  return json(uniformOut(loaded.row, loaded.mockups), 201);
}

/** Saves a finished picture from the retailer's browser as that class's mock-up. */
async function saveMockup(env, request, uniform, classNo) {
  if (classNo < uniform.class_from || classNo > uniform.class_to) return json({ detail: 'That class is not in this set.' }, 400);
  if (classNo < FIRST_MODEL_CLASS) return json({ detail: "The model student for this class isn't ready yet." }, 400);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_MOCKUP_BYTES) return json({ detail: 'The mock-up picture must be 8 MB or smaller.' }, 400);
  const type = logoType(bytes);
  if (!type) return json({ detail: 'The mock-up must be a PNG, JPG or WebP picture.' }, 400);
  const done = await env.DB.prepare("SELECT 1 FROM mockups WHERE uniform_id = ? AND class_no = ? AND status = 'DONE'").bind(uniform.id, classNo).first();
  if (done) return json({ detail: 'This mock-up is already made.' }, 409);
  const id = crypto.randomUUID();
  const key = `mockup:${id}`;
  await env.ORDERS.put(key, bytes, { metadata: { type } });
  await env.DB.prepare(
    `INSERT INTO mockups (id, uniform_id, class_no, status, image_key, updated_at) VALUES (?, ?, ?, 'DONE', ?, ?)
     ON CONFLICT (uniform_id, class_no) DO UPDATE SET status = 'DONE', image_key = excluded.image_key, job_id = NULL, error = '', updated_at = excluded.updated_at`
  )
    .bind(id, uniform.id, classNo, key, now())
    .run();
  const loaded = await loadUniform(env, uniform.id);
  return json(uniformOut(loaded.row, loaded.mockups));
}

async function mockupImage(env, path) {
  const m = path.match(/^\/public\/mockups\/([0-9a-f-]{36})\/$/);
  if (!m) return null;
  const row = await env.DB.prepare('SELECT image_key FROM mockups WHERE id = ? AND status = ?').bind(m[1], 'DONE').first();
  if (!row?.image_key) return json({ detail: 'Not found.' }, 404);
  const { value, metadata } = await env.ORDERS.getWithMetadata(row.image_key, 'arrayBuffer');
  if (!value) return json({ detail: 'Not found.' }, 404);
  // A finished picture never changes: cache it long.
  return new Response(value, { headers: { 'content-type': metadata?.type || 'image/png', 'cache-control': 'public, max-age=604800', 'x-content-type-options': 'nosniff' } });
}

/** Public: a finished mock-up picture. null when the path isn't one. */
export const publicMockup = mockupImage;

/** /retail/uniforms/... for retailers (their own sets) and the Boss (all sets). null when the path isn't one. */
export async function uniformsApi(request, env, path, user) {
  if (!path.startsWith('/retail/uniforms/')) return null;
  if (!user) return json({ detail: 'Not signed in.' }, 401);
  const isBoss = user.role === 'BOSS';
  const isRetailer = user.role === 'RETAILER';
  if (!isBoss && !isRetailer) return json({ detail: 'You do not have permission to do this.' }, 403);
  const method = request.method;
  const store = isRetailer ? await env.DB.prepare('SELECT * FROM stores WHERE owner_id = ?').bind(user.id).first() : null;
  if (isRetailer && !store) return json({ detail: "Your shop isn't set up. Contact the store owner." }, 403);

  if (path === '/retail/uniforms/') {
    if (method === 'POST') {
      if (!isRetailer) return json({ detail: 'Only retailers add uniforms.' }, 403);
      if (!store.active) return json({ detail: 'Your shop is switched off. Contact the store owner.' }, 403);
      return createUniform(env, request, store);
    }
    const sql = `${UNIFORM_SELECT}${isRetailer ? ' WHERE u.store_id = ?' : ''} ORDER BY u.created_at DESC LIMIT 200`;
    const { results } = await (isRetailer ? env.DB.prepare(sql).bind(store.id) : env.DB.prepare(sql)).all();
    const { results: counts } = await env.DB.prepare(
      `SELECT uniform_id, class_no, status, id, error FROM mockups WHERE uniform_id IN (${results.map(() => '?').join(',') || "''"})`
    )
      .bind(...results.map((r) => r.id))
      .all();
    const byUniform = Object.groupBy ? Object.groupBy(counts, (m) => m.uniform_id) : counts.reduce((acc, m) => ((acc[m.uniform_id] ??= []).push(m), acc), {});
    const out = results.map((r) => uniformOut(r, byUniform[r.id] ?? []));
    return json({ count: out.length, next: null, previous: null, results: out });
  }

  const m = path.match(/^\/retail\/uniforms\/([0-9a-f-]{36})\/(?:(photo\/(?:top|bottom)|publish|unpublish|hide|mockups\/(\d+)\/image)\/)?$/);
  if (!m) return json({ detail: 'Not found.' }, 404);
  const loaded = await loadUniform(env, m[1]);
  if (!loaded || (isRetailer && loaded.row.store_id !== store.id)) return json({ detail: 'Not found.' }, 404);
  const uniform = loaded.row;
  const action = m[2];

  if (!action) return json(uniformOut(uniform, loaded.mockups));
  if (action.startsWith('photo/')) {
    const key = action.endsWith('top') ? uniform.top_photo_key : uniform.bottom_photo_key;
    const { value, metadata } = await env.ORDERS.getWithMetadata(key, 'arrayBuffer');
    if (!value) return json({ detail: 'Not found.' }, 404);
    return new Response(value, { headers: { 'content-type': metadata?.type || 'image/jpeg', 'cache-control': 'private, max-age=3600' } });
  }
  if (method !== 'POST') return json({ detail: 'Method not allowed.' }, 405);

  if (action === 'hide') {
    if (!isBoss) return json({ detail: 'Only the store owner can hide a set.' }, 403);
    await env.DB.prepare("UPDATE uniforms SET status = 'HIDDEN', updated_at = ? WHERE id = ?").bind(now(), uniform.id).run();
  } else if (!isRetailer) {
    return json({ detail: 'Only the retailer can change their set.' }, 403);
  } else if (uniform.status === 'HIDDEN') {
    return json({ detail: 'The store owner has hidden this set. Contact them to show it again.' }, 403);
  } else if (action === 'publish') {
    const total = uniform.class_to - Math.max(uniform.class_from, FIRST_MODEL_CLASS) + 1;
    const done = loaded.mockups.filter((x) => x.status === 'DONE').length;
    if (total < 1 || done < total) return json({ detail: `All ${Math.max(total, 1)} mock-ups must be ready before the set can go live (${done} ready).` }, 409);
    await env.DB.prepare("UPDATE uniforms SET status = 'LIVE', updated_at = ? WHERE id = ?").bind(now(), uniform.id).run();
  } else if (action === 'unpublish') {
    await env.DB.prepare("UPDATE uniforms SET status = 'DRAFT', updated_at = ? WHERE id = ?").bind(now(), uniform.id).run();
  } else {
    return saveMockup(env, request, uniform, Number(m[3]));
  }
  const after = await loadUniform(env, uniform.id);
  return json(uniformOut(after.row, after.mockups));
}
