# School Store Phone App: Antigravity Build Prompts

Paste these into Antigravity one at a time, in order. Let the agent finish, review its artifacts (plan, changed files, walkthrough), and only then move to the next prompt.

Target setup: existing React frontend made phone-ready as a PWA with the same UI as the website, existing Django backend, PostgreSQL, Redis, all on one Oracle Cloud Always Free Ampere (ARM) server. Upgrade to Pay As You Go planned for late February, before the March rush.

## Prompt 0: Ground rules (paste first, keep as a workspace rule)

You are working on the School Store (Colorbenz) project in the project folder on the Z drive. Follow these rules for every task in this workspace:

- Work only on branch `draft-01`. Never push, merge or deploy to main.
- Do not touch anything in Documents\\antigravity workspaces.
- The phone app UI must look and behave exactly like the current website: same layouts, colours, fonts, components, animations and flow. Do not redesign anything. Brand highlight colour stays #2E8B57.
- Keep every existing business rule. If a rule is unclear, stop and ask me before changing anything.
- Keep Django as the backend. Do not introduce a new framework or language.
- Before writing code, produce an implementation plan artifact and wait for my approval.
- After each task, produce a walkthrough artifact: files changed, commands to run, and tests you ran with results.
- Use the browser to verify UI changes at a phone viewport (390 x 844) and a desktop viewport.

## Prompt 1: Audit and baseline

Read the whole project, frontend and backend, and produce an artifact `docs/audit.md` with:

1. Every Django model, field, relation and constraint.
2. Every API endpoint: method, path, request, response, and which role can call it.
3. Every business rule, including: Boss, Admin (per city), School, Teacher and Parent roles; teachers ordering on behalf of students; the School panel seeing all parent and teacher orders; parents cannot edit data; the parent flow School, then City, then Grade (Nursery, Junior KG, Senior KG, 1 to 12), then Male/Female; sections Uniform, School Shoes, Uniform Accessories (Socks, Belt, Tie), then the Stationery yes/no popup.
4. Performance problems you can find: N+1 queries, missing indexes, large responses, unpaginated lists, slow pages. Measure response times of the main endpoints locally and record them as the baseline.
5. Anything that will break on a phone screen. Do not change code in this step.

## Prompt 2: Make Django fast

Using `docs/audit.md`, fix the backend performance problems without changing behaviour:

- Remove N+1 queries with `select_related` and `prefetch_related`.
- Add database indexes for every foreign key and every field used to filter (school, city, grade, gender, order status, created date). Create proper migrations.
- Return only the fields each screen needs; paginate any list that can grow.
- Enable persistent database connections (`CONN_MAX_AGE`) and health checks.
- Turn on gzip compression for API responses.
- Run the app with Gunicorn (workers = 2 x CPU cores + 1) behind Nginx; Nginx serves static and media files directly. Re-measure the same endpoints from Prompt 1 and show before and after times in the walkthrough.

## Prompt 3: Redis caching

Add Redis to the Django project using `django-redis`.

- Cache the parent catalogue responses: school list, cities for a school, grades, and products by school, grade and gender. Key them clearly, with a 10 minute expiry.
- Whenever Boss or Admin edits a school, product, price or stock, delete the matching cache keys immediately, so parents never see stale prices.
- Store Django sessions in Redis.
- If Redis is down, the site must still work by reading from Postgres. Write a test that proves this. Show cached versus uncached response times in the walkthrough.

## Prompt 4: Safe orders under load

Make checkout safe when many parents order at the same time:

- Create each order inside one database transaction (`transaction.atomic`).
- Lock stock rows with `select_for_update` while checking and reducing stock, so two people can never buy the last item.
- Require an idempotency key on order creation, so a double tap or a network retry never creates two orders.
- Teachers ordering for a student must record both the student and the teacher who placed the order.
- Order payment status changes only from the payment gateway's verified webhook, never from the browser. The webhook must check the signature and be safe to receive twice. Write tests for: two parents buying the last item at once, double submit, and duplicate webhooks.

## Prompt 5: Turn the website into a phone-ready PWA

Make the existing React site installable on Android and iPhone, with the same UI as the website:

- Add a web app manifest: name, short name, theme colour #2E8B57, background colour matching the site, `display: standalone`, and icons at 192, 512 and maskable sizes made from the current logo.
- Add a service worker (use Workbox or `vite-plugin-pwa`, whichever fits the current build tool): cache the app shell and static assets; network-first for API calls; never cache cart, checkout, payment or login responses.
- Show a friendly offline screen in the site's existing style when there is no connection.
- Add an "Install app" prompt for Android and a small "Add to Home Screen" guide for iPhone Safari, styled like the existing site.
- Add the iOS meta tags and apple-touch-icon so it opens full screen on iPhone.
- Fix every phone layout issue listed in `docs/audit.md`: tap targets at least 44 px, no horizontal scrolling, safe-area padding for notched phones, and inputs that don't zoom on focus. Verify in the browser at phone size, and run a Lighthouse PWA and performance check. Report the scores.

## Prompt 6: Oracle Cloud server setup

Write a setup script `deploy/setup_server.sh` for a fresh Oracle Cloud Always Free Ampere A1 instance (ARM64, Ubuntu 22.04 or 24.04), plus `deploy/README.md` explaining each step. The script must be safe to re-run.

- Install Python, Nginx, PostgreSQL, Redis and Certbot, all ARM64-compatible.
- Create a non-root `app` user; the app runs as that user under systemd (Gunicorn service, auto-restart on failure, start on boot).
- PostgreSQL: listen on localhost only, strong generated password stored in an `.env` file readable only by `app`, tuned for the instance's RAM.
- Redis: localhost only, password set, `maxmemory` with `allkeys-lru`.
- Nginx: reverse proxy to Gunicorn, serve the React build and media files, gzip, long cache headers for hashed assets, HTTPS with Certbot and auto-renew.
- Firewall: open only 22, 80 and 443. Explain that the Oracle VCN security list must also allow 80 and 443, and that Ubuntu images on Oracle ship with iptables rules that also need opening.
- SSH: key login only, password login disabled. Do not run anything against a real server; I will run it myself.

## Prompt 7: Deploy script and one-hour rebuild

Create `deploy/deploy.sh` that, on the server, pulls branch `draft-01`, installs dependencies, runs migrations, builds the React app, collects static files and restarts Gunicorn with zero manual steps. Then write `deploy/REBUILD.md`: exact steps to rebuild the whole server from nothing (new instance, `setup_server.sh`, restore latest backup, `deploy.sh`, DNS check) in under one hour. This is the recovery plan if Oracle reclaims the free instance.

## Prompt 8: Nightly backups and a tested restore

Create `deploy/backup.sh` and a systemd timer that runs it nightly:

- `pg_dump` the database (compressed) and archive the media folder.
- Upload both to an Oracle Object Storage bucket using the OCI CLI.
- Keep the last 14 daily backups and delete older ones.
- Log success or failure. Create `deploy/restore.sh` that restores the latest backup onto a fresh server. Test restore on a local copy and record the result in the walkthrough. A backup that has never been restored doesn't count.

## Prompt 9: Uptime and error alerts

Add a `/health` endpoint that checks Postgres and Redis and returns 200 only when both work. Document how to point a free uptime monitor (for example UptimeRobot) at it, with alerts to my phone and email. Add error logging to a file with rotation, and send Django 500 errors to my email.

## Prompt 10: Load test before going live

Write a k6 load test script `loadtest/shop_flow.js` that simulates real parents: open the site, pick school, city, grade and gender, view products, add to cart and check out against a test payment mode.

- Ramp from 10 to 300 virtual users over 10 minutes.
- Report requests per second, p95 response time and error rate.
- Run it from my laptop or another machine, never on the server itself. Pass criteria: p95 under 500 ms and errors under 0.1% at 300 users. If it fails, list the bottleneck (CPU, database, Redis or network) and the fix. Run this again in mid-February, before upgrading Oracle to Pay As You Go ahead of the March rush.

## Prompt 11: Launch checklist

Produce `docs/launch-checklist.md` and verify each item, marking pass or fail:

- Every parent flow works on an Android phone and an iPhone, installed as an app and in the browser.
- UI matches the website screen by screen.
- Payments work end to end in live mode with a small real order, then refund it.
- Backups ran last night and a restore was tested.
- Uptime alert fires when the app is stopped.
- HTTPS valid, no secrets in the repo, debug mode off.
- Everything is still on `draft-01`; nothing deployed to main without my go-ahead.
