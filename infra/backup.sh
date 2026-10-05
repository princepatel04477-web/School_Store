#!/usr/bin/env bash
# ==============================================================================
# Nightly Automated Database Backup Script
# Creates a compressed, custom-format PostgreSQL dump and verifies its integrity.
# Retains the last 14 days of backups locally or uploads to S3/GCS.
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/school_store}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/school_store_backup_${TIMESTAMP}.dump"
RETENTION_DAYS=14

# Database connection variables (defaults to env or local container)
PGHOST="${POSTGRES_HOST:-127.0.0.1}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-school_user}"
PGDATABASE="${POSTGRES_DB:-school_store}"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting database backup for ${PGDATABASE}..."

# Run pg_dump using custom format (-Fc) which includes compression and allows parallel restore
PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_dump \
    -h "${PGHOST}" \
    -p "${PGPORT}" \
    -U "${PGUSER}" \
    -d "${PGDATABASE}" \
    -Fc \
    -v \
    -f "${BACKUP_FILE}"

FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup completed successfully. File size: ${FILE_SIZE}. Saved to ${BACKUP_FILE}."

# Verify archive integrity with pg_restore list verification
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Verifying backup archive integrity..."
pg_restore -l "${BACKUP_FILE}" > /dev/null
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup archive verified successfully."

# Prune old backups older than RETENTION_DAYS
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "school_store_backup_*.dump" -mtime +"${RETENTION_DAYS}" -delete
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Pruning complete."
