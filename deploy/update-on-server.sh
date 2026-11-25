#!/usr/bin/env bash
# Dijalankan di SERVER (sbg root/sudo) setiap kali ada versi baru:
#   bash /var/www/drs-secret/deploy/update-on-server.sh /tmp/drs-secret-release.tar.gz
# Aman utk data: .env & folder backups TIDAK ditimpa, skema DB diperbarui
# lewat migrasi inkremental (npm run db:upgrade), BUKAN db:migrate.
set -euo pipefail

RELEASE="${1:-/tmp/drs-secret-release.tar.gz}"
APP_DIR=/var/www/drs-secret

[ -f "$RELEASE" ] || { echo "File $RELEASE tidak ada"; exit 1; }
[ -f "$APP_DIR/server/.env" ] || { echo "$APP_DIR/server/.env belum ada — ini instalasi pertama? Ikuti DEPLOY.md"; exit 1; }

echo "== Backup database dulu sebelum update =="
BK_DIR="$APP_DIR/server/backups"
mkdir -p "$BK_DIR"
set -a; . "$APP_DIR/server/.env"; set +a
MYSQL_PWD="$DB_PASSWORD" mysqldump --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
  --single-transaction --no-tablespaces "$DB_NAME" > "$BK_DIR/pre-update_$(date +%Y%m%d_%H%M%S).sql"
echo "   OK"

echo "== Ekstrak versi baru (src & dist diganti bersih) =="
rm -rf "$APP_DIR/server/src" "$APP_DIR/pos-admin/dist"
tar -xzf "$RELEASE" -C "$APP_DIR"

echo "== Dependensi =="
cd "$APP_DIR/server"
npm ci --omit=dev

echo "== Migrasi skema inkremental =="
npm run db:upgrade

echo "== Restart aplikasi =="
pm2 reload drs-secret --update-env
sleep 2
pm2 status drs-secret
curl -fsS http://127.0.0.1:${PORT}/api/health && echo && echo "UPDATE SELESAI"
