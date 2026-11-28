#!/bin/sh
# Start the School Store test copy: bring its database up to date, then serve.
set -e
cd /app
python manage.py migrate --noinput
python manage.py collectstatic --noinput >/dev/null
python manage.py sync_store_api || true
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 --threads 4 \
  --worker-class gthread --worker-tmp-dir /dev/shm --access-logfile - --error-logfile -
