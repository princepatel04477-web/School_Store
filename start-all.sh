#!/usr/bin/env sh
# Start the whole store (backend + website) and open it in the browser.
# Needs Git, Node.js LTS and Python 3 installed. Press Ctrl+C to stop.
cd "$(dirname "$0")" || exit 1
for tool in git node python3; do
  command -v $tool >/dev/null 2>&1 || { echo "Please install $tool first, then run this again."; exit 1; }
done

export USE_SQLITE=1 CELERY_TASK_ALWAYS_EAGER=1

# Backend: first run installs everything and loads sample schools
if [ ! -d .venv ]; then
  echo "First run: setting up the backend (takes a few minutes)..."
  python3 -m venv .venv || exit 1
fi
. .venv/bin/activate
pip install -q -r requirements.txt || exit 1
cd backend || exit 1
python manage.py migrate --noinput || exit 1
if [ ! -f .seeded ]; then
  (python manage.py seed || python manage.py seed_data) && touch .seeded
fi
python manage.py runserver 127.0.0.1:8000 &
BACKEND=$!
trap 'kill $BACKEND 2>/dev/null' EXIT INT TERM
cd ../frontend || exit 1

# Website
npm install --no-audit --no-fund || exit 1
echo ""
echo "Opening http://localhost:5173  (press Ctrl+C here to stop)"
npm run dev -- --open
