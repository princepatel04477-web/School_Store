// Uniform sets and their mock-ups on the showcase store (Cloudflare D1 + KV).
//
// A retailer adds a set for one of their approved schools: shirt + pant (boys) or shirt + skirt
// (girls), two real photos, a class range, price and sizes. The mock-up engine then dresses the
// store's fixed model student for each class in the range (frontend/public/models/stdNN-boy|girl.webp)
// with FASHN virtual try-on, in two runs: the shirt onto the model, then the pant or skirt onto
// that result. The same model photo, settings and seed are used every time, so every school's
// Class 6 boy is the same boy in the same pose; only the uniform changes. The retailer checks the
// mock-ups and publishes the set; the Boss can hide any set.
//
// Try-on jobs take tens of seconds, longer than a request, so each set moves forward one step at a
// time: the retailer's screen calls /tick every few seconds while mock-ups are being made.

import { logoType } from './showcaseRetail.js';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const FASHN_CONCURRENCY = 6; // FASHN's default limit of jobs in progress at once
const FASHN_MODEL = 'tryon-v1.6';
const DEFAULT_SEED = 42;
const GENDERS = { BOY: 'boy', GIRL: 'girl' };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fields = (errors) => json(errors, 400);
const now = () => new Date().toISOString();
const clean = (v) => String(v ?? '').trim();

/** The fixed model photo for a class and gender, as a path on this site. */
export const modelPath = (classNo, gender) => `/models/std${String(classNo).padStart(2, '0')}-${GENDERS[gender]}.webp`;

function toBase64(bytes) {
  const view = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(text);
}

// ---- FASHN --------------------------------------------------------------------------------------

async function fashn(env, path, body) {
  const res = await fetch(`${env.FASHN_API_URL || 'https://api.fashn.ai'}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${env.FASHN_API_KEY}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Try-on service answered ${res.status}`);
  return data;
}

async function startTryOn(env, modelImage, garmentImage, category, seed) {
  const data = await fashn(env, '/v1/run', {
    model_name: FASHN_MODEL,
    inputs: {
      model_image: modelImage,
      garment_image: garmentImage,
      category,
      garment_photo_type: 'flat-lay',
      mode: 'quality',
      seed,
      num_samples: 1,
      output_format: 'png',
    },
  });
  if (!data.id) throw new Error(data.error?.message || data.error || 'The try-on service did not start the job.');
  return data.id;
}

async function garmentDataUri(env, key) {
  const { value, metadata } = await env.ORDERS.getWithMetadata(key, 'arrayBuffer');
  if (!value) throw new Error('The uniform photo is missing.');
  return `data:${metadata?.type || 'image/jpeg'};base64,${toBase64(value)}`;
}

/**
 * Moves one set's mock-ups forward: checks the jobs in progress, starts the pant or skirt run when
 * the shirt run is done, saves finished pictures, and starts queued ones while there is room.
 */
async function advance(env, uniform, origin) {
  const { results: rows } = await env.DB.prepare('SELECT * FROM mockups WHERE uniform_id = ? ORDER BY class_no').bind(uniform.id).all();
  const save = (row, changes) => {
    const keys = Object.keys(changes);
    return env.DB.prepare(`UPDATE mockups SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...keys.map((k) => changes[k]), now(), row.id)
      .run();
  };
  const fail = (row, error) => save(row, { status: 'FAILED', job_id: null, error: String(error?.message || error).slice(0, 300) });

  for (const row of rows.filter((r) => (r.status === 'TOP' || r.status === 'BOTTOM') && r.job_id)) {
    let job;
    try {
      job = await fashn(env, `/v1/status/${row.job_id}`);
    } catch (error) {
      continue; // a network hiccup: ask again on the next tick
    }
    if (job.status === 'failed') {
      await fail(row, job.error?.message || job.error || 'The try-on did not work.');
      continue;
    }
    if (job.status !== 'completed') continue;
    const output = job.output?.[0];
    if (!output) {
      await fail(row, 'The try-on service returned no picture.');
      continue;
    }
    try {
      if (row.status === 'TOP') {
        const jobId = await startTryOn(env, output, await garmentDataUri(env, uniform.bottom_photo_key), 'bottoms', row.seed);
        await save(row, { status: 'BOTTOM', job_id: jobId, top_image_url: output });
      } else {
        const picture = await fetch(output);
        if (!picture.ok) throw new Error('Could not download the finished mock-up.');
        const key = `mockup:${row.id}:${row.seed}`;
        await env.ORDERS.put(key, await picture.arrayBuffer(), { metadata: { type: picture.headers.get('content-type') || 'image/png' } });
        await save(row, { status: 'DONE', job_id: null, image_key: key, error: '' });
      }
    } catch (error) {
      await fail(row, error);
    }
  }

  const queued = rows.filter((r) => r.status === 'QUEUED');
  if (!queued.length) return;
  const busy = await env.DB.prepare("SELECT COUNT(*) AS n FROM mockups WHERE status IN ('TOP', 'BOTTOM')").first();
  let room = FASHN_CONCURRENCY - (busy?.n ?? 0);
  if (room <= 0) return;
  const shirt = await garmentDataUri(env, uniform.top_photo_key).catch((error) => error);
  for (const row of queued) {
    if (room <= 0) break;
    if (shirt instanceof Error) {
      await fail(row, shirt);
      continue;
    }
    try {
      const jobId = await startTryOn(env, `${origin}${modelPath(row.class_no, uniform.gender)}`, shirt, 'tops', row.seed);
      await save(row, { status: 'TOP', job_id: jobId, error: '' });
      room -= 1;
    } catch (error) {
      await fail(row, error);
    }
  }
}

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
  const bottom = await readPhoto(form, 'bottom_photo', errors, gender === 'GIRL' ? 'skirt' : 'pant');
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

/** Queue a mock-up for every class in the range that has a model photo; keep finished ones. */
async function generate(env, request, uniform) {
  if (!env.FASHN_API_KEY) return json({ detail: "The mock-up engine isn't switched on yet. The store owner needs to add the try-on key." }, 503);
  const origin = new URL(request.url).origin;
  const missing = [];
  const statements = [];
  for (let classNo = uniform.class_from; classNo <= uniform.class_to; classNo += 1) {
    const photo = await env.ASSETS.fetch(new Request(`${origin}${modelPath(classNo, uniform.gender)}`, { method: 'HEAD' }));
    if (!photo.ok || (photo.headers.get('content-type') || '').includes('text/html')) {
      missing.push(classNo);
      continue;
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO mockups (id, uniform_id, class_no, status, seed, updated_at) VALUES (?, ?, ?, 'QUEUED', ?, ?)
         ON CONFLICT (uniform_id, class_no) DO UPDATE SET status = 'QUEUED', job_id = NULL, error = '', updated_at = excluded.updated_at
         WHERE mockups.status = 'FAILED'`
      ).bind(crypto.randomUUID(), uniform.id, classNo, DEFAULT_SEED, now())
    );
  }
  if (statements.length) await env.DB.batch(statements);
  await advance(env, uniform, origin);
  const loaded = await loadUniform(env, uniform.id);
  return json({ ...uniformOut(loaded.row, loaded.mockups), missing_models: missing });
}

async function mockupImage(env, path) {
  const m = path.match(/^\/public\/mockups\/([0-9a-f-]{36})\/$/);
  if (!m) return null;
  const row = await env.DB.prepare('SELECT image_key FROM mockups WHERE id = ? AND status = ?').bind(m[1], 'DONE').first();
  if (!row?.image_key) return json({ detail: 'Not found.' }, 404);
  const { value, metadata } = await env.ORDERS.getWithMetadata(row.image_key, 'arrayBuffer');
  if (!value) return json({ detail: 'Not found.' }, 404);
  // The key changes when a mock-up is made again, so a finished picture never changes: cache it long.
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

  const m = path.match(/^\/retail\/uniforms\/([0-9a-f-]{36})\/(?:(photo\/(?:top|bottom)|generate|tick|publish|unpublish|hide|mockups\/(\d+)\/(?:retry|another))\/)?$/);
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
  } else if (action === 'generate') {
    return generate(env, request, uniform);
  } else if (action === 'tick') {
    if (env.FASHN_API_KEY) await advance(env, uniform, new URL(request.url).origin);
  } else if (action === 'publish') {
    const total = uniform.class_to - uniform.class_from + 1;
    const done = loaded.mockups.filter((x) => x.status === 'DONE').length;
    if (done < total) return json({ detail: `All ${total} mock-ups must be ready before the set can go live (${done} ready).` }, 409);
    await env.DB.prepare("UPDATE uniforms SET status = 'LIVE', updated_at = ? WHERE id = ?").bind(now(), uniform.id).run();
  } else if (action === 'unpublish') {
    await env.DB.prepare("UPDATE uniforms SET status = 'DRAFT', updated_at = ? WHERE id = ?").bind(now(), uniform.id).run();
  } else {
    // One class again: "retry" after a failure keeps the seed (the same result as planned);
    // "another" asks for a different version with the next seed.
    const classNo = Number(m[3]);
    const mockup = loaded.mockups.find((x) => x.class_no === classNo);
    if (!mockup) return json({ detail: 'Not found.' }, 404);
    if (mockup.status === 'TOP' || mockup.status === 'BOTTOM' || mockup.status === 'QUEUED') return json({ detail: 'This mock-up is still being made.' }, 409);
    if (action.endsWith('/retry') && mockup.status !== 'FAILED') return json({ detail: 'Only a failed mock-up can be tried again.' }, 409);
    const seed = action.endsWith('/another') ? mockup.seed + 1 : mockup.seed;
    await env.DB.batch([
      env.DB.prepare("UPDATE mockups SET status = 'QUEUED', job_id = NULL, error = '', seed = ?, updated_at = ? WHERE id = ?").bind(seed, now(), mockup.id),
      env.DB.prepare("UPDATE uniforms SET status = 'DRAFT', updated_at = ? WHERE id = ?").bind(now(), uniform.id),
    ]);
    if (env.FASHN_API_KEY) await advance(env, uniform, new URL(request.url).origin);
  }
  const after = await loadUniform(env, uniform.id);
  return json(uniformOut(after.row, after.mockups));
}
