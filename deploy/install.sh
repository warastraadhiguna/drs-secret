#!/usr/bin/env bash
# =============================================================================
# Instalasi PERTAMA DR's Secret di server (Ubuntu 22, Nginx, MariaDB, pm2).
# Jalankan sbg root, setelah kode di-clone dari GitHub:
#   git clone -b master https://github.com/warastraadhiguna/drs-secret.git /var/www/drs-secret
#   bash /var/www/drs-secret/deploy/install.sh
#
# Yang dikerjakan otomatis:
#   cek server -> buat database & user -> buat .env (password acak) -> npm ci
#   -> build admin panel -> isi database awal -> pm2 -> Nginx -> HTTPS (certbot) -> verifikasi
# Yang ditanya: password root MariaDB (sekali) & email utk sertifikat HTTPS.
#
# Aman di server bersama: hanya MENAMBAH (database, user DB, vhost, proses pm2
# baru). Nginx cuma di-reload (bukan restart) & selalu `nginx -t` dulu.
# Berhenti di error pertama.
# =============================================================================
set -euo pipefail

DOMAIN="drs-secret.wan-client.com"
APP_DIR="/var/www/drs-secret"
DB_PORT="${DB_PORT:-5431}"
DB_NAME="pos_drs"
DB_USER="drs_secret"
PM2_NAME="drs-secret"

ok()   { echo -e "\e[32m[OK]\e[0m $*"; }
info() { echo -e "\e[36m==>\e[0m $*"; }
warn() { echo -e "\e[33m[PERHATIAN]\e[0m $*"; }
die()  { echo -e "\e[31m[GAGAL]\e[0m $*"; echo "Instalasi dihentikan. Kirim tampilan layar ini ke Claude."; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Jalankan sebagai root (sudo -i dulu, lalu ulangi perintah)."
[ -f "$APP_DIR/server/package.json" ] || die "Kode belum ada di $APP_DIR — clone dulu: git clone -b master https://github.com/warastraadhiguna/drs-secret.git $APP_DIR"
if [ -f "$APP_DIR/server/.env" ]; then
  die "$APP_DIR/server/.env sudah ada — sudah pernah diinstal.
  - Untuk UPDATE versi baru: bash $APP_DIR/deploy/update-on-server.sh
  - Untuk MENGULANG instalasi yang gagal (database masih kosong): rm $APP_DIR/server/.env  lalu jalankan skrip ini lagi."
fi

# -----------------------------------------------------------------------------
info "1/9 Cek server"
command -v node >/dev/null || die "Node.js tidak ditemukan"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js minimal v18 (sekarang $(node -v))"
command -v npm >/dev/null || die "npm tidak ditemukan"
command -v pm2 >/dev/null || die "pm2 tidak ditemukan"
command -v nginx >/dev/null || die "nginx tidak ditemukan"
command -v mysql >/dev/null || die "client mysql tidak ditemukan"
command -v mysqldump >/dev/null || warn "mysqldump tidak ditemukan — fitur Backup Database tidak akan jalan (apt install mariadb-client)"
command -v certbot >/dev/null || warn "certbot tidak ditemukan — HTTPS dilewati (apt install certbot python3-certbot-nginx)"
nginx -t >/dev/null 2>&1 || die "Konfigurasi nginx yang SUDAH ADA sedang error (nginx -t) — perbaiki dulu, jangan lanjut."
ss -tln | grep -q "127.0.0.1:${DB_PORT}\b" || ss -tln | grep -q ":${DB_PORT}\b" || die "MariaDB tidak terdengar di port ${DB_PORT}"
if ss -tln | grep -q "0.0.0.0:${DB_PORT}\b"; then warn "MariaDB terbuka di 0.0.0.0:${DB_PORT} (bisa diakses dari luar) — masalah terpisah, sebaiknya dibatasi ke 127.0.0.1"; fi
# Sisa percobaan instalasi sebelumnya (proses pm2 milik app INI saja) dibersihkan
# supaya port & proses tidak dobel. Aplikasi pm2 lain tidak disentuh.
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  warn "Proses pm2 ${PM2_NAME} dari percobaan sebelumnya dihapus dulu"
  pm2 delete "$PM2_NAME" >/dev/null
fi

# Pilih port app yang kosong mulai 4101
APP_PORT=""
for p in $(seq 4101 4120); do
  if ! ss -tln | grep -q ":${p}\b"; then APP_PORT=$p; break; fi
done
[ -n "$APP_PORT" ] || die "Tidak ada port kosong di 4101-4120"
ok "Node $(node -v), pm2 $(pm2 -v), MariaDB port ${DB_PORT}, app akan pakai port ${APP_PORT}"

DNS_IP=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
if [ -z "$DNS_IP" ]; then
  warn "DNS ${DOMAIN} belum mengarah ke mana pun — aplikasi tetap dipasang, HTTPS akan gagal sampai DNS siap."
elif hostname -I | tr ' ' '\n' | grep -qx "$DNS_IP"; then
  ok "DNS ${DOMAIN} -> ${DNS_IP} (server ini)"
else
  warn "DNS ${DOMAIN} -> ${DNS_IP}, tapi IP server ini: $(hostname -I). Kalau server di balik NAT ini wajar; kalau tidak, HTTPS akan gagal."
fi

# -----------------------------------------------------------------------------
info "2/9 Pertanyaan (cuma dua)"
read -r -p "Email untuk sertifikat HTTPS (Let's Encrypt): " CERT_EMAIL
[ -n "$CERT_EMAIL" ] || die "Email wajib diisi"

# -----------------------------------------------------------------------------
info "3/9 Buat password acak"
DB_PASS=$(openssl rand -hex 20)
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
ADMIN_PASS=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-14)
ok "dibuat (password admin ditampilkan di akhir)"

# -----------------------------------------------------------------------------
info "4/9 Database & user (masukkan password ROOT MariaDB saat diminta)"
MYSQL_ADMIN=(mysql -u root -p -h 127.0.0.1 -P "$DB_PORT")
"${MYSQL_ADMIN[@]}" <<SQL || die "Gagal membuat database/user (password root salah? root tidak boleh login via TCP?)"
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
MYSQL_PWD="$DB_PASS" mysql -u "$DB_USER" -h 127.0.0.1 -P "$DB_PORT" -e "SELECT 1" "$DB_NAME" >/dev/null || die "User ${DB_USER} dibuat tapi tidak bisa login"
ok "database ${DB_NAME} & user ${DB_USER}@127.0.0.1 siap"

# -----------------------------------------------------------------------------
info "5/9 Tulis .env"
umask 077
cat > "$APP_DIR/server/.env" <<ENV
NODE_ENV=production
PORT=${APP_PORT}
HOST=127.0.0.1

DB_HOST=127.0.0.1
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=12h

SEED_ADMIN_PASSWORD=${ADMIN_PASS}
SEED_CASHIER_PIN=
ENV
chmod 600 "$APP_DIR/server/.env"
umask 022
ok "$APP_DIR/server/.env (hanya bisa dibaca root)"

# -----------------------------------------------------------------------------
info "6/9 Install, build admin panel & isi database awal"
cd "$APP_DIR/pos-admin"
npm ci --no-audit --no-fund
npm run build
[ -f "$APP_DIR/pos-admin/dist/index.html" ] || die "Build admin panel gagal"
cd "$APP_DIR/server"
npm ci --omit=dev --no-audit --no-fund
npm run db:migrate
npm run db:seed
npm run db:upgrade >/dev/null
# Password awal tidak perlu tersimpan di server setelah seed.
sed -i '/^SEED_ADMIN_PASSWORD=/d' "$APP_DIR/server/.env"
mkdir -p "$APP_DIR/server/backups"
ok "database terisi (COA, role, akun admin, pengaturan toko)"

# -----------------------------------------------------------------------------
info "7/9 Jalankan dengan pm2"
pm2 start "$APP_DIR/deploy/ecosystem.config.js"
pm2 save
for i in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null || { pm2 logs "$PM2_NAME" --lines 30 --nostream; die "Aplikasi tidak merespons di port ${APP_PORT}"; }
ok "aplikasi jalan (pm2: ${PM2_NAME}, port ${APP_PORT})"

# -----------------------------------------------------------------------------
info "8/9 Nginx"
sed "s#127.0.0.1:4101#127.0.0.1:${APP_PORT}#" "$APP_DIR/deploy/nginx-drs-secret.conf" > "/etc/nginx/sites-available/${DOMAIN}"
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
if ! nginx -t; then
  rm -f "/etc/nginx/sites-enabled/${DOMAIN}"
  die "nginx -t gagal setelah vhost ditambah — vhost dilepas lagi, situs lain tidak terganggu."
fi
systemctl reload nginx
ok "vhost ${DOMAIN} aktif (HTTP)"

# -----------------------------------------------------------------------------
info "9/9 HTTPS"
HTTPS_OK=0
if command -v certbot >/dev/null; then
  if certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos -m "$CERT_EMAIL"; then
    nginx -t && systemctl reload nginx
    HTTPS_OK=1
    ok "HTTPS aktif, HTTP dialihkan otomatis"
  else
    warn "certbot gagal (biasanya DNS belum mengarah ke server). Ulangi nanti:  certbot --nginx -d ${DOMAIN} --redirect -m ${CERT_EMAIL} --agree-tos"
  fi
fi

# -----------------------------------------------------------------------------
echo
info "Verifikasi"
SCHEME=http; [ "$HTTPS_OK" -eq 1 ] && SCHEME=https
echo -n "  health ${SCHEME}://${DOMAIN}/api/health : "; curl -s --max-time 10 "${SCHEME}://${DOMAIN}/api/health" || echo "(tidak bisa dijangkau dari server ini)"
echo
echo -n "  admin panel                     : HTTP "; curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 "${SCHEME}://${DOMAIN}/" || true
[ "$HTTPS_OK" -eq 1 ] && { echo -n "  http -> https                   : "; curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" --max-time 10 "http://${DOMAIN}/" || true; }
echo -n "  port ${APP_PORT} di firewall         : "; (ufw status 2>/dev/null | grep -q "${APP_PORT}" && echo "TERBUKA (tidak seharusnya)") || echo "tidak dibuka (bagus)"
pm2 status "$PM2_NAME" | tail -n +1

cat <<DONE

=============================================================================
 INSTALASI SELESAI
-----------------------------------------------------------------------------
 Alamat     : ${SCHEME}://${DOMAIN}
 Login      : admin   / ${ADMIN_PASS}
              admin2  / ${ADMIN_PASS}
 >>> CATAT password ini sekarang — tidak ditampilkan lagi & tidak disimpan
     di server. Segera ganti lewat menu profil (kanan atas) setelah login.

 Konfigurasi : ${APP_DIR}/server/.env  (password database & kunci login)
 Log         : pm2 logs ${PM2_NAME}
 Update nanti: bash ${APP_DIR}/deploy/update-on-server.sh
=============================================================================
DONE
