-- School Store catalogue API on Supabase (phase 1).
--
-- Read-only copies of the Django public catalogue endpoints (backend/catalog/public.py),
-- served by a separate PostgREST container (supabase/store-api/) whose anonymous role is
-- store_web. The Cloudflare Worker calls these functions and falls back to Django.
--
-- Every function returns {"status": <http status>, "body": <same JSON Django returns>}.
-- Functions run as their owner (store_app, which owns the store tables) and store_web may
-- only execute them: it cannot read any table directly.
--
-- Apply as a superuser:  psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f store_api.sql
-- Safe to run again (replaces the functions, keeps photo_meta / class_alias / edge_secret rows).

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'store_web') THEN
    CREATE ROLE store_web NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS store_api AUTHORIZATION store_app;
REVOKE ALL ON SCHEMA store_api FROM PUBLIC;
GRANT USAGE ON SCHEMA store_api TO store_web;

SET LOCAL ROLE store_app;

-- Filled by `manage.py sync_store_api` from the Python code that owns these rules
-- (catalog/kv_photos.py, catalog/images.py, common/constants.py).
CREATE TABLE IF NOT EXISTS store_api.photo_meta (
  url       text PRIMARY KEY,
  thumbnail text,
  alt       text
);
CREATE TABLE IF NOT EXISTS store_api.class_alias (
  alias text PRIMARY KEY,   -- lower-case, as typed
  name  text NOT NULL       -- canonical class name, e.g. "Class 5"
);
-- The shared secret the Worker sends in x-store-edge. One row.
CREATE TABLE IF NOT EXISTS store_api.edge_secret (
  id     boolean PRIMARY KEY DEFAULT true CHECK (id),
  secret text NOT NULL
);
REVOKE ALL ON store_api.photo_meta, store_api.class_alias, store_api.edge_secret FROM PUBLIC;

-- Stop everything that does not carry the Worker's secret (PostgREST db-pre-request).
CREATE OR REPLACE FUNCTION store_api.check_request() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = store_api, pg_temp AS $$
DECLARE
  sent text := current_setting('request.headers', true)::json ->> 'x-store-edge';
BEGIN
  IF sent IS NULL OR NOT EXISTS (SELECT 1 FROM store_api.edge_secret WHERE secret = sent) THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'Forbidden';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION store_api._like(q text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- catalog/images.py is_remote_image_url
CREATE OR REPLACE FUNCTION store_api._is_remote(u text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(u ~* '^https?://[^/?#]+', false)
$$;

-- catalog/images.py cdn_thumbnail_url with the default CATALOG_THUMBNAIL_TEMPLATE
CREATE OR REPLACE FUNCTION store_api._cdn_thumb(u text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN store_api._is_remote(u)
    THEN u || CASE WHEN position('?' IN u) > 0 THEN '&' ELSE '?' END || 'width=320&quality=70' END
$$;

-- thumbnail_for_url(url) or cdn_thumbnail_url(url); photo_meta holds Python's answer.
CREATE OR REPLACE FUNCTION store_api._thumb(u text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = store_api, pg_temp AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM store_api.photo_meta WHERE url = u)
    THEN (SELECT thumbnail FROM store_api.photo_meta WHERE url = u)
    ELSE store_api._cdn_thumb(u) END
$$;

CREATE OR REPLACE FUNCTION store_api._alt(u text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = store_api, pg_temp AS $$
  SELECT alt FROM store_api.photo_meta WHERE url = u
$$;

CREATE OR REPLACE FUNCTION store_api._ok(body json) RETURNS json
LANGUAGE sql IMMUTABLE AS $$ SELECT json_build_object('status', 200, 'body', body) $$;

CREATE OR REPLACE FUNCTION store_api._err(status int, field text, message text) RETURNS json
LANGUAGE sql IMMUTABLE AS $$ SELECT json_build_object('status', status, 'body', json_build_object(field, message)) $$;

-- GET /api/public/schools/[?search=]
CREATE OR REPLACE FUNCTION store_api.schools(search text DEFAULT NULL) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT store_api._ok(coalesce(json_agg(row ORDER BY ord), '[]'::json)) FROM (
    SELECT row_number() OVER (ORDER BY s.name) AS ord,
      json_build_object(
        'id', s.id, 'name', s.name, 'code', s.code,
        'city', s.city_id,
        'city_name', coalesce(c.name, ''),
        'home_delivery', s.home_delivery_enabled,
        'school_pickup', s.school_pickup_enabled,
        'grades', coalesce((SELECT json_agg(g.name ORDER BY g.sort_order)
                            FROM schools_school_grades sg JOIN schools_grade g ON g.id = sg.grade_id
                            WHERE sg.school_id = s.id), '[]'::json)
      ) AS row
    FROM schools_school s LEFT JOIN schools_city c ON c.id = s.city_id
    WHERE s.active AND s.is_public_store
      AND (coalesce(btrim(search), '') = ''
           OR upper(s.name) LIKE '%' || upper(store_api._like(btrim(search))) || '%')
  ) x
$$;

-- GET /api/public/schools/delivered/ and /api/public/schools/logos/
CREATE OR REPLACE FUNCTION store_api.schools_delivered() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT store_api._ok(coalesce(json_agg(json_build_object('id', id, 'name', name, 'logo_url', logo_url) ORDER BY name), '[]'::json))
  FROM schools_school
  WHERE active AND show_logo_public AND logo_url IS NOT NULL AND logo_url <> ''
$$;

-- GET /api/public/schools/<school_id>/cities/
CREATE OR REPLACE FUNCTION store_api.school_cities(school_id uuid) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s_city uuid;
BEGIN
  SELECT city_id INTO s_city FROM schools_school WHERE id = school_id AND active AND is_public_store;
  IF NOT FOUND THEN RETURN store_api._err(404, 'detail', 'School not found.'); END IF;
  RETURN store_api._ok((
    SELECT coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'code', c.code) ORDER BY c.name), '[]'::json)
    FROM schools_city c
    WHERE c.active AND (c.id = s_city OR c.id IN (
      SELECT b.city_id FROM schools_schoolbranch b WHERE b.school_id = school_cities.school_id AND b.active))
  ));
END $$;

-- Open branches (catalog/public.py _open_branches), optionally for one school.
CREATE OR REPLACE FUNCTION store_api._open_branches(only_school uuid)
RETURNS SETOF schools_schoolbranch
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT b.* FROM schools_schoolbranch b
  JOIN schools_school s ON s.id = b.school_id
  JOIN schools_city c ON c.id = b.city_id
  WHERE b.active AND s.active AND s.is_public_store AND c.active
    AND (only_school IS NULL OR b.school_id = only_school)
$$;

-- GET /api/public/states/[?school=]
CREATE OR REPLACE FUNCTION store_api.states(school uuid DEFAULT NULL) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT store_api._ok(coalesce(json_agg(json_build_object('name', state, 'city_count', n) ORDER BY state), '[]'::json))
  FROM (
    SELECT c.state, count(DISTINCT b.city_id) AS n
    FROM store_api._open_branches(school) b JOIN schools_city c ON c.id = b.city_id
    WHERE c.state <> ''
    GROUP BY c.state
  ) x
$$;

-- GET /api/public/cities/?state=[&school=]
CREATE OR REPLACE FUNCTION store_api.cities(state text, school uuid DEFAULT NULL) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT store_api._ok(coalesce(json_agg(json_build_object(
      'id', id, 'name', name, 'code', code, 'state', st, 'branch_count', n) ORDER BY name), '[]'::json))
  FROM (
    SELECT c.id, c.name, c.code, c.state AS st, count(b.id) AS n
    FROM store_api._open_branches(school) b JOIN schools_city c ON c.id = b.city_id
    WHERE upper(c.state) = upper(btrim(cities.state))
    GROUP BY c.id, c.name, c.code, c.state
  ) x
$$;

-- GET /api/public/cities/<city_id>/branches/[?search=][&school=]
-- media_base: the site origin, e.g. https://school-store.aqualite.workers.dev (for branch photos)
CREATE OR REPLACE FUNCTION store_api.city_branches(city_id uuid, search text DEFAULT NULL, school uuid DEFAULT NULL, media_base text DEFAULT '')
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q text := coalesce(btrim(search), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schools_city WHERE id = city_branches.city_id AND active) THEN
    RETURN store_api._err(404, 'detail', 'City not found.');
  END IF;
  RETURN store_api._ok((
    SELECT coalesce(json_agg(row ORDER BY sort_name, bid), '[]'::json) FROM (
      SELECT b.id AS bid,
        coalesce(nullif(b.name, ''), s.name) AS sort_name,
        json_build_object(
          'id', b.id,
          'name', coalesce(nullif(b.name, ''), s.name),
          'address', b.address,
          'pincode', b.pincode,
          'udise_code', coalesce(b.udise_code, ''),
          'photo', CASE WHEN coalesce(b.photo, '') <> '' THEN media_base || '/media/' || b.photo END,
          'school', json_build_object('id', s.id, 'name', s.name, 'code', s.code)
        ) AS row
      FROM store_api._open_branches(school) b JOIN schools_school s ON s.id = b.school_id
      WHERE b.city_id = city_branches.city_id
        AND (q = ''
             OR upper(b.name) LIKE '%' || upper(store_api._like(q)) || '%'
             OR upper(s.name) LIKE '%' || upper(store_api._like(q)) || '%'
             OR upper(b.address) LIKE '%' || upper(store_api._like(q)) || '%'
             OR b.pincode LIKE store_api._like(q) || '%'
             OR b.udise_code LIKE store_api._like(q) || '%')
    ) x
  ));
END $$;

-- GET /api/public/grades/
CREATE OR REPLACE FUNCTION store_api.grades() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT store_api._ok(coalesce(json_agg(json_build_object('id', id, 'name', name, 'sort_order', sort_order) ORDER BY sort_order), '[]'::json))
  FROM schools_grade
$$;

-- catalog stock rules (inventory/services.py stock_flag)
CREATE OR REPLACE FUNCTION store_api._stock_flag(quantity int, threshold int) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN quantity IS NULL OR quantity <= 0 THEN 'OUT_OF_STOCK'
              WHEN quantity <= coalesce(threshold, 0) THEN 'LOW_STOCK'
              ELSE 'IN_STOCK' END
$$;

-- GET /api/public/products/?school=&class=|grade=&gender=[&city=][&category=][&product_type=][&page_size=][&cursor=]
-- The Worker sends only well-formed requests here (UUIDs, a known gender word, a cursor it can read);
-- anything else still goes to Django. after_id is the decoded DRF cursor position.
CREATE OR REPLACE FUNCTION store_api.products(
  school uuid, grade text, gender text,
  city uuid DEFAULT NULL, category text DEFAULT NULL, product_type text DEFAULT NULL,
  page_size int DEFAULT 25, after_id uuid DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- settings.STOCK_SCOPE defaults to "india": every catalogue reads the India stock row.
  stock_city constant uuid := 'd50ed060-432d-4ef9-b4fb-0231b6de8d16';
  s_city uuid;
  v_city uuid := city;
  g_id uuid;
  g_name text;
  class_num int;
  sel_gender text;
  pt text := upper(btrim(coalesce(product_type, '')));
  lim int := least(greatest(coalesce(page_size, 25), 1), 50);
  rows json;
  last_id uuid;
  more boolean;
BEGIN
  SELECT s.city_id INTO s_city FROM schools_school s WHERE s.id = school AND s.active AND s.is_public_store;
  IF NOT FOUND THEN RETURN store_api._err(400, 'school', 'School not found or inactive.'); END IF;

  BEGIN
    g_id := btrim(grade)::uuid;
    SELECT id, name INTO g_id, g_name FROM schools_grade WHERE id = g_id;
  EXCEPTION WHEN invalid_text_representation THEN g_id := NULL;
  END;
  -- Django only tries names when normalize_class_name(grade) knows the value.
  IF g_name IS NULL AND EXISTS (SELECT 1 FROM store_api.class_alias a WHERE a.alias = lower(btrim(grade))) THEN
    SELECT g.id, g.name INTO g_id, g_name FROM schools_grade g
    WHERE upper(g.name) = upper((SELECT a.name FROM store_api.class_alias a WHERE a.alias = lower(btrim(grade))))
       OR upper(g.name) = upper(btrim(grade))
    ORDER BY g.id LIMIT 1;
  END IF;
  IF g_name IS NULL THEN
    RETURN store_api._err(400, 'class', format('Invalid class ''%s''. Must be a valid school class.', grade));
  END IF;

  sel_gender := CASE lower(btrim(gender)) WHEN 'boy' THEN 'boy' WHEN 'male' THEN 'boy' WHEN 'm' THEN 'boy'
                                          WHEN 'girl' THEN 'girl' WHEN 'female' THEN 'girl' WHEN 'f' THEN 'girl' END;
  IF sel_gender IS NULL THEN
    RETURN store_api._err(400, 'gender', format('Invalid gender ''%s''. Must be ''boy'' or ''girl''.', gender));
  END IF;

  IF v_city IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM schools_schoolbranch b WHERE b.school_id = school AND b.city_id = v_city AND b.active)
       AND s_city IS DISTINCT FROM v_city THEN
      RETURN store_api._err(400, 'city', 'The selected school does not operate in this city.');
    END IF;
  ELSE
    v_city := s_city;
  END IF;

  class_num := coalesce(substring(g_name FROM '\d+')::int, 0);

  WITH matched AS (
    SELECT p.* FROM catalog_product p
    LEFT JOIN catalog_category cat ON cat.id = p.category_id
    WHERE p.active AND NOT p.needs_review AND p.gender IS NOT NULL
      AND (p.school_id = school OR p.school_id IS NULL)
      AND (EXISTS (SELECT 1 FROM catalog_product_grades pg WHERE pg.product_id = p.id AND pg.grade_id = g_id)
           OR (NOT EXISTS (SELECT 1 FROM catalog_product_grades pg WHERE pg.product_id = p.id)
               AND (p.class_from IS NULL OR p.class_from <= class_num)
               AND (p.class_to IS NULL OR p.class_to >= class_num)))
      AND p.gender IN (sel_gender, 'unisex')
      AND (category IS NULL OR category = ''
           OR upper(cat.name) = upper(category) OR upper(cat.slug) = upper(category))
      AND (pt NOT IN ('SOCKS', 'BELT', 'TIE') OR p.product_type = pt)
      AND (after_id IS NULL OR p.id > after_id)
    ORDER BY p.id
    LIMIT lim + 1
  ), page AS (
    SELECT * FROM matched ORDER BY id LIMIT lim
  )
  SELECT
    coalesce(json_agg(json_build_object(
      'id', p.id,
      'name', p.name,
      'description', left(coalesce(p.description, ''), 300),
      'category', cat.name,
      'product_type', p.product_type,
      'gender', p.gender,
      'needs_review', p.needs_review,
      'school', ps.name,
      'price', coalesce(cp.selling_price, p.selling_price)::float8,
      'thumbnail', CASE WHEN jsonb_typeof(p.images) = 'array' THEN
                        CASE WHEN jsonb_array_length(p.images) > 0 THEN store_api._thumb(p.images ->> 0) END END,
      'image', CASE WHEN jsonb_typeof(p.images) = 'array' THEN
                    CASE WHEN store_api._is_remote(p.images ->> 0) THEN p.images ->> 0 END END,
      'image_alt', CASE WHEN jsonb_typeof(p.images) = 'array' THEN
                        CASE WHEN jsonb_array_length(p.images) > 0 THEN store_api._alt(p.images ->> 0) END END,
      'images', coalesce((
          SELECT json_agg(json_build_object('image', u, 'thumbnail', store_api._thumb(u), 'alt', store_api._alt(u)) ORDER BY n)
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p.images) = 'array' THEN p.images ELSE '[]'::jsonb END)
               WITH ORDINALITY AS e(u, n)
          WHERE store_api._is_remote(u)), '[]'::json),
      'customisation_schema', p.customisation_schema,
      'variants', coalesce((
          SELECT json_agg(json_build_object('id', v.id, 'size', v.size,
                   'stock_status', CASE WHEN sb.id IS NULL THEN NULL
                                        ELSE store_api._stock_flag(sb.stock_quantity, sb.low_stock_threshold) END)
                 ORDER BY v.size, v.id)
          FROM catalog_productvariant v
          LEFT JOIN inventory_stockbalance sb ON sb.variant_id = v.id AND sb.city_id = stock_city
          WHERE v.product_id = p.id AND v.active), '[]'::json)
    ) ORDER BY p.id), '[]'::json),
    (SELECT id FROM page ORDER BY id DESC LIMIT 1),
    (SELECT count(*) > lim FROM matched)
  INTO rows, last_id, more
  FROM page p
  LEFT JOIN catalog_category cat ON cat.id = p.category_id
  LEFT JOIN schools_school ps ON ps.id = p.school_id
  LEFT JOIN catalog_productcityprice cp ON cp.product_id = p.id AND cp.city_id = v_city AND cp.active AND v_city IS NOT NULL;

  RETURN json_build_object('status', 200, 'body', json_build_object(
    'next_after', CASE WHEN more THEN last_id END,
    'had_cursor', after_id IS NOT NULL,
    'results', rows));
END $$;

RESET ROLE;

-- store_web may run the public functions and nothing else.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA store_api FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  store_api.schools(text), store_api.schools_delivered(), store_api.school_cities(uuid),
  store_api.states(uuid), store_api.cities(text, uuid), store_api.city_branches(uuid, text, uuid, text),
  store_api.grades(), store_api.products(uuid, text, text, uuid, text, text, int, uuid)
TO store_web;
-- PostgREST's pre-request hook runs as store_web too.
GRANT EXECUTE ON FUNCTION store_api.check_request() TO store_web;

COMMIT;
