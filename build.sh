#!/usr/bin/env bash
# Render build step: install deps, collect static files, migrate the Neon database.
set -o errexit
pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate --no-input
