# Supabase (self-hosted on the database server)

The store's data lives in a self-hosted Supabase on a separate Linux machine. Django reaches it
through `DATABASE_URL` in the store server's `.env`. The tables are in the `public` schema of the
`postgres` database and are owned by the `store_app` role.

## Phase 1: the public catalogue is served by Supabase

The Cloudflare Worker (`frontend/worker/index.js`) answers these GET requests from Supabase
instead of Django:

| Django path | Supabase function |
|---|---|
| `/api/public/schools/` | `store_api.schools(search)` |
| `/api/public/schools/delivered/`, `/logos/` | `store_api.schools_delivered()` |
| `/api/public/schools/<id>/cities/` | `store_api.school_cities(school_id)` |
| `/api/public/states/` | `store_api.states(school)` |
| `/api/public/cities/?state=` | `store_api.cities(state, school)` |
| `/api/public/cities/<id>/branches/` | `store_api.city_branches(city_id, search, school, media_base)` |
| `/api/public/grades/` | `store_api.grades()` |
| `/api/public/products/` (first page) | `store_api.products(...)` |

Rules:

* Only well-formed requests go to Supabase. Unknown parameters, later product pages (`cursor`)
  and anything Supabase answers with an error go to Django, so error messages stay Django's.
* If Supabase is down or slower than 4 seconds, Django answers. Responses from Supabase carry
  `x-served-by: supabase`.
* Off switch: set the Worker KV key `sb_catalogue` to `off` (namespace `school-store-config`).

Pieces:

* `store_api.sql`: the functions. Apply with `psql -U supabase_admin -d postgres -f store_api.sql`
  inside the `supabase-db` container. Safe to run again.
* `store-api/docker-compose.yml`: a separate PostgREST that only serves `store_api`, as role
  `store_web` (execute on those functions only), plus a Cloudflare quick tunnel. Every request
  must carry the Worker's secret in `x-store-edge` (`store_api.check_request`). Secrets live in
  `/opt/supabase-setup/store-api/` on the database server, never in git.
* `store-api/store-api-register.sh`: systemd timer that tells the Worker the tunnel address
  (KV `sb_origin`).
* `manage.py sync_store_api`: copies the photo thumbnail/alt rules (`catalog/kv_photos.py`) and
  class aliases (`common/constants.py`) into `store_api.photo_meta` / `class_alias`.
  `deploy/publish.ps1` runs it on every start.
* `parity_check.py`: asks Django and Supabase the same questions and reports every difference.
  Run it after changing either side.

When `catalog/public.py` changes, change `store_api.sql` the same way and run `parity_check.py`.
