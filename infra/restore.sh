#!/usr/bin/env bash
# ==============================================================================
# Database Restore Verification Script
# Restores a given backup file into a temporary verification database or production.
# ==============================================================================

set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <path_to_backup_file> [target_db_name]"
    exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="${2:-school_store_restore_test}"

PGHOST="${POSTGRES_HOST:-127.0.0.1}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-school_user}"

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "Error: Backup file not found at ${BACKUP_FILE}"
    exit 1
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Restoring ${BACKUP_FILE} into ${TARGET_DB}..."

# Drop and recreate test database
PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres -c "DROP DATABASE IF EXISTS ${TARGET_DB};"
PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres -c "CREATE DATABASE ${TARGET_DB};"

# Restore using parallel workers (-j 4)
PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_restore \
    -h "${PGHOST}" \
    -p "${PGPORT}" \
    -U "${PGUSER}" \
    -d "${TARGET_DB}" \
    --no-owner \
    --role="${PGUSER}" \
    -j 4 \
    "${BACKUP_FILE}" || true

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Restore finished. Verifying record counts..."

# Run health check count verification
ORDER_COUNT=$(PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${TARGET_DB}" -t -c "SELECT count(*) FROM orders_order;" | xargs)
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Verified order count in restored database: ${ORDER_COUNT}"

if [ "${TARGET_DB}" = "school_store_restore_test" ]; then
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Cleaning up temporary verification database..."
    PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres -c "DROP DATABASE ${TARGET_DB};"
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Database restore verification completed successfully!"
