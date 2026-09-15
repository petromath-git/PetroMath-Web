#!/bin/bash
# Pulls the latest DB backup from S3 and restores it over the local MySQL DB.
# Destructive: drops and recreates the target database. See ops/dr-restore-runbook.md.
#
# Usage: ./restore-latest-db-backup.sh [daily|hourly] [/path/to/.env] [pm2-app-name]

set -euo pipefail

TIER="${1:-daily}"
ENV_FILE="${2:-$HOME/petroMath/.env}"
PM2_APP="${3:-petromath}"
S3_BUCKET="mysql-backups-petromath"
WORK_DIR="/home/ubuntu/restore"

if [[ "$TIER" != "daily" && "$TIER" != "hourly" ]]; then
  echo "Usage: $0 [daily|hourly] [/path/to/.env] [pm2-app-name]" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ENV_FILE" >&2
  exit 1
fi

DB_HOST=$(grep -oP '^DB_HOST=\K.*' "$ENV_FILE")
DB_PORT=$(grep -oP '^DB_PORT=\K.*' "$ENV_FILE")
DB_NAME=$(grep -oP '^DB_NAME=\K.*' "$ENV_FILE")
DB_USER=$(grep -oP '^DB_USER=\K.*' "$ENV_FILE")
DB_PASSWORD=$(grep -oP '^DB_PASSWORD=\K.*' "$ENV_FILE")

mkdir -p "$WORK_DIR"

LATEST_KEY=$(aws s3 ls "s3://$S3_BUCKET/mysql-backups/$TIER/" --profile s3-backup-writer \
  | sort | tail -1 | awk '{print $4}')

if [[ -z "$LATEST_KEY" ]]; then
  echo "ERROR: no backups found under s3://$S3_BUCKET/mysql-backups/$TIER/" >&2
  exit 1
fi

LOCAL_FILE="$WORK_DIR/$LATEST_KEY"

echo "=================================================================="
echo "About to restore: s3://$S3_BUCKET/mysql-backups/$TIER/$LATEST_KEY"
echo "Onto database:    $DB_NAME @ $DB_HOST:$DB_PORT"
echo ""
echo "THIS WILL DROP AND RECREATE '$DB_NAME', DESTROYING ITS CURRENT DATA."
echo "=================================================================="
read -r -p "Type 'yes' to continue: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 1
fi

echo "[1/5] Downloading backup..."
aws s3 cp "s3://$S3_BUCKET/mysql-backups/$TIER/$LATEST_KEY" "$LOCAL_FILE" --profile s3-backup-writer

echo "[2/5] Stopping app..."
pm2 stop "$PM2_APP" || true

echo "[3/5] Dropping and recreating database..."
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" \
  -e "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4;"

echo "[4/5] Importing backup (this can take a few minutes)..."
gunzip -c "$LOCAL_FILE" | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"

echo "[5/5] Restarting app..."
pm2 start "$PM2_APP"

rm -f "$LOCAL_FILE"

echo "Done. Restored $LATEST_KEY onto $DB_NAME. Verify with: pm2 list && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/"
