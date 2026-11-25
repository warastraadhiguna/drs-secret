#!/usr/bin/env bash
# Update ke versi terbaru dari GitHub (branch master). Jalankan sbg root:
#   bash /var/www/drs-secret/deploy/update-on-server.sh
# Aman utk data: database dibackup dulu, .env & folder backups tidak
# disentuh (keduanya di .gitignore), skema DB diperbarui lewat migrasi
# inkremental (npm run db:upgrade), BUKAN db:migrate.
set -euo pipefail

APP_DIR=/var/www/drs-secret
BRANCH=master

ok()  { echo -e "\e[32m[OK]\e[0m $*"; }
die() { echo -e "\e[31m[GAGAL]\e[0m $*"; echo "Update dihentikan. Kirim tampilan layar ini ke Claude."; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Jalankan sebagai root"
[ -f "$APP_DIR/server/.env" ] || die "$APP_DIR/server/.env belum ada — belum pernah diinstal? Jalankan deploy/install.sh"
cd "$APP_DIR"

echo "== 1/6 Cek perubahan lokal di server =="
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  die "Ada file kode yang diubah langsung di server (di atas). Jangan edit kode di server — kirim daftar ini ke Claude."
fi
ok "bersih"

echo "== 2/6 Backup database =="
mkdir -p "$APP_DIR/server/backups"
set -a; . "$APP_DIR/server/.env"; set +a
BK="$APP_DIR/server/backups/pre-update_$(date +%Y%m%d_%H%M%S).sql"
MYSQL_PWD="$DB_PASSWORD" mysqldump --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
  --single-transaction --no-tablespaces "$DB_NAME" > "$BK" || die "Backup gagal — update dibatalkan"
ok "$BK"

echo "== 3/6 Ambil kode terbaru =="
OLD=$(git rev-parse --short HEAD)
git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH" || die "Tidak bisa fast-forward ke origin/$BRANCH"
NEW=$(git rev-parse --short HEAD)
if [ "$OLD" = "$NEW" ]; then ok "sudah versi terbaru ($NEW)"; else ok "$OLD -> $NEW"; git log --oneline "$OLD..$NEW"; fi

echo "== 4/6 Build admin panel & dependensi server =="
cd "$APP_DIR/pos-admin"
npm ci --no-audit --no-fund
npm run build
cd "$APP_DIR/server"
npm ci --omit=dev --no-audit --no-fund

echo "== 5/6 Migrasi skema inkremental =="
npm run db:upgrade

echo "== 6/6 Restart aplikasi =="
pm2 reload drs-secret --update-env
for i in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null || { pm2 logs drs-secret --lines 30 --nostream; die "Aplikasi tidak merespons setelah update"; }
pm2 status drs-secret
echo
ok "UPDATE SELESAI — versi $(git -C "$APP_DIR" rev-parse --short HEAD)"
