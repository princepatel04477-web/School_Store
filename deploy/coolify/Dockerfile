# Test copy of School Store for Coolify: the React site built in, served by Django (one origin).
# Built from the repository root: docker build -f deploy/coolify/Dockerfile .

FROM node:20-bookworm-slim AS site
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
COPY shared /src/shared
ENV VITE_API_URL=/api
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 FRONTEND_DIST=/app/frontend-dist
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt gunicorn
COPY backend /app
COPY shared /shared
COPY --from=site /src/frontend/dist /app/frontend-dist
COPY deploy/coolify/start.sh /start.sh
RUN chmod +x /start.sh && groupadd -r app && useradd -r -g app -d /app app \
    && mkdir -p /app/staticfiles /app/media && chown -R app:app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fs http://127.0.0.1:8000/api/health/ || exit 1
CMD ["/start.sh"]
