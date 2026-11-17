You are working on School Store (Colorbenz): a school uniform store for parents, schools and teachers.
Repo: princepatel04477-web/School_Store. Work ONLY in this folder (School_Store-draft01), on branch draft-01.

Stack:
- frontend/: React 18 + Vite 5 + TypeScript, React Query, react-router. Hosted on a Cloudflare Worker
  (frontend/worker/index.js) that serves the site and forwards /api, /admin, /static, /media to the Django server.
- frontend/android/: Capacitor 6 Android app (capacitor.config.json). Keep Capacitor 6: this PC has JDK 17,
  and Capacitor 7+ needs JDK 21.
- backend/: Django 5 + DRF + SimpleJWT, PostgreSQL, Redis, Celery (worker + beat).
  Apps: accounts, analytics, catalog, common, inventory, orders, panel, retail, schools.
- Live site: https://school-store.aqualite.workers.dev

Rules for every task:
1. Never push, merge or deploy. Commit locally on draft-01 only, one commit per prompt, clear message.
2. Never touch main, other School_Store folders, or Documents/antigravity workspaces.
3. Keep every business rule and every existing screen working on the website. App-only behaviour goes behind
   a single isNativeApp() check (Capacitor.isNativePlatform()), so the website is unchanged.
4. Same look as the website: layouts, colours, fonts, components. Brand green #2E8B57, logo green #2F5D50.
5. TypeScript: no `any`, no @ts-ignore. No console.log in production code. Complete working code only:
   no stubs, TODOs or placeholder data.
6. Python: type hints, tests for every new endpoint and every new calculation (Django test runner).
7. Children's data (height, weight, shoulder, photos) is sensitive: never log it, never send it to third parties,
   keep the existing retention rules (orders/fit_retention.py, PHOTO_RETENTION_DAYS, FIT_DATA_RETENTION_DAYS).
8. Before coding, write a short plan. If nothing blocks you, continue without waiting. Stop and ask only for a
   business-rule question or a step that needs a password, a paid account, or a key you don't have.
9. After each task, write a walkthrough (docs/walkthroughs/<NN>-<name>.md): files changed, commands to run,
   tests run with results, and anything you could not do and why.
10. Run before every commit: cd frontend && npm run build && npx vitest run ; cd backend && python manage.py test
    (use the backend venv; if the backend test database needs Postgres and none is running, run with
    USE_SQLITE=1 and say so in the walkthrough).
