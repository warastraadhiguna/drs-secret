# Deploy DR's Secret ke server — `drs-secret.wan-client.com`

## Cara cepat (instalasi pertama)

Laptop (Git Bash, folder proyek):

```bash
bash deploy/pack.sh
scp drs-secret-release.tar.gz root@156.67.219.118:/tmp/
```

Server (sbg root):

```bash
mkdir -p /var/www/drs-secret && tar -xzf /tmp/drs-secret-release.tar.gz -C /var/www/drs-secret && bash /var/www/drs-secret/deploy/install.sh
```

`install.sh` mengerjakan semua langkah 0–8 di bawah secara otomatis (cuma
menanyakan email HTTPS & password root MariaDB). Bagian di bawah ini = rincian
manual yang sama, utk referensi / kalau ada langkah yang gagal.

---

Server: Ubuntu 22.04, sudah ada Nginx, MariaDB/MySQL, Node.js, pm2.
Susunan di server:

```
/var/www/drs-secret/
├── server/          ← API (Node/Express), berisi .env & folder backups
├── pos-admin/dist/  ← admin panel (hasil build), disajikan oleh server di atas
└── deploy/          ← berkas-berkas ini
```

Aplikasi jalan di `127.0.0.1:4101` (tidak terbuka ke internet), Nginx meneruskan
`https://drs-secret.wan-client.com` ke sana.

**Prinsip di server bersama:** hanya MENAMBAH, tidak mengubah situs lain. Pakai
`systemctl reload nginx` (bukan restart), selalu `nginx -t` dulu. Kalau ada
keluaran yang tidak sesuai harapan, **berhenti** dan kirim hasilnya ke saya.

---

## 0. Pengecekan awal (di server)

```bash
# DNS subdomain sudah mengarah ke IP server ini? (wajib sebelum certbot)
getent hosts drs-secret.wan-client.com

# domain belum dipakai vhost lain?
ls /etc/nginx/sites-enabled | grep drs-secret || echo "belum dipakai (bagus)"

# port 4101 masih kosong? (kalau terpakai, pilih port lain & ganti di .env,
# nginx-drs-secret.conf)
ss -tlnp | grep ':4101' || echo "4101 kosong (bagus)"

# port & alamat MariaDB — catat port-nya (server ini sebelumnya 5431).
# Harus 127.0.0.1:PORT, BUKAN 0.0.0.0:PORT
ss -tlnp | grep -E 'mysqld|mariadbd'

# versi tools
node -v          # minimal v18
pm2 -v
mysqldump --version
nginx -t
```

---

## 1. Upload kode (dari LAPTOP, Git Bash di folder proyek)

```bash
bash deploy/pack.sh
scp drs-secret-release.tar.gz USER@IP_SERVER:/tmp/
```

Lalu di server:

```bash
sudo mkdir -p /var/www/drs-secret
sudo tar -xzf /tmp/drs-secret-release.tar.gz -C /var/www/drs-secret
ls /var/www/drs-secret     # harus ada: server  pos-admin  deploy
```

---

## 2. Database

```bash
# password acak utk user database — SIMPAN hasilnya
openssl rand -base64 24

# masuk sbg root MariaDB. -h 127.0.0.1 -P <port> WAJIB eksplisit
# (ganti 5431 dgn port hasil langkah 0)
mysql -u root -p -h 127.0.0.1 -P 5431
```

Di prompt MySQL:

```sql
CREATE DATABASE pos_drs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- '127.0.0.1' (bukan 'localhost') — aplikasi konek lewat TCP 127.0.0.1
CREATE USER 'drs_secret'@'127.0.0.1' IDENTIFIED BY 'TEMPEL_PASSWORD_DI_SINI';
GRANT ALL PRIVILEGES ON pos_drs.* TO 'drs_secret'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

---

## 3. File `.env`

```bash
cd /var/www/drs-secret/server
sudo cp .env.example .env
openssl rand -base64 48      # -> utk JWT_SECRET
sudo nano .env
```

Isi minimal:

| Kunci | Isi |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4101` |
| `HOST` | `127.0.0.1` |
| `DB_PORT` | port MariaDB dari langkah 0 (mis. `5431`) |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `drs_secret` / password langkah 2 / `pos_drs` |
| `JWT_SECRET` | hasil `openssl rand -base64 48` |
| `SEED_ADMIN_PASSWORD` | password awal login admin (min 10 karakter) |
| `SEED_CASHIER_PIN` | biarkan kosong |

```bash
sudo chmod 600 .env
```

---

## 4. Install & isi database awal

```bash
cd /var/www/drs-secret/server
sudo npm ci --omit=dev
sudo npm run db:migrate     # harus: "Schema berhasil dibuat/diperbarui."
sudo npm run db:seed        # harus: "Seed selesai — DR's Secret"
```

> `db:migrate` HANYA untuk instalasi pertama (database kosong). Ia otomatis
> menolak kalau database sudah berisi data.

Setelah seed berhasil, hapus baris `SEED_ADMIN_PASSWORD` dari `.env` (tidak dipakai
lagi, tidak perlu disimpan di server).

---

## 5. Jalankan dengan pm2

```bash
cd /var/www/drs-secret
sudo pm2 start deploy/ecosystem.config.js
sudo pm2 save
sudo pm2 status drs-secret                       # harus "online"
sudo pm2 logs drs-secret --lines 20 --nostream   # harus: "DR's Secret server berjalan di http://127.0.0.1:4101"
curl -s http://127.0.0.1:4101/api/health         # harus: {"status":"ok","service":"drs-secret",...}
```

> Pakai user yang sama dengan pm2 aplikasi lain di server ini (sebelumnya root,
> `pm2-angling_root.service`) supaya ikut hidup lagi otomatis saat server reboot.

---

## 6. Nginx

```bash
sudo cp /var/www/drs-secret/deploy/nginx-drs-secret.conf /etc/nginx/sites-available/drs-secret.wan-client.com
sudo ln -s /etc/nginx/sites-available/drs-secret.wan-client.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
curl -s http://drs-secret.wan-client.com/api/health
```

## 7. HTTPS

```bash
sudo certbot --nginx -d drs-secret.wan-client.com --redirect --non-interactive --agree-tos -m EMAIL_ANDA
sudo nginx -t && sudo systemctl reload nginx
```

---

## 8. Verifikasi (kirim hasilnya ke saya)

```bash
curl -s https://drs-secret.wan-client.com/api/health                 # 1. HTTPS jalan
curl -sI http://drs-secret.wan-client.com/ | head -3                 # 2. harus 301 ke https
curl -s -o /dev/null -w "%{http_code}\n" https://drs-secret.wan-client.com/   # 3. 200 (admin panel)
curl -s -o /dev/null -w "%{http_code}\n" https://sumber-alam.wan-client.com/api/health   # 4. situs lain tetap sehat
sudo ufw status | grep 4101 || echo "4101 tidak dibuka di firewall (bagus)"           # 5.
sudo pm2 status                                                       # 6. tidak ada restart berulang
```

Lalu buka `https://drs-secret.wan-client.com` di browser dan login `admin`.

---

## 9. Setelah online (di aplikasi)

1. **Ganti password** `admin` & `admin2` (menu profil kanan atas) — pakai
   password kuat, karena sekarang halaman login bisa dibuka siapa saja di internet.
2. **Pengaturan Toko**: alamat & no. WA toko, logo invoice, cek rekening & penanda
   tangan, pastikan **mode pajak** sebelum ada transaksi.
3. **Backup Database**: aktifkan backup otomatis harian. File tersimpan di
   `/var/www/drs-secret/server/backups/` — **salin juga ke luar server**
   (mis. unduh berkala dari menu Backup, atau rclone/rsync ke penyimpanan lain).
4. Isi katalog produk, saldo awal stok & kas, lalu mulai buat invoice.

---

## Update versi berikutnya

Di laptop: `bash deploy/pack.sh` lalu `scp drs-secret-release.tar.gz USER@IP_SERVER:/tmp/`.
Di server:

```bash
sudo bash /var/www/drs-secret/deploy/update-on-server.sh /tmp/drs-secret-release.tar.gz
```

Skrip itu: backup database dulu → ganti kode (`.env` & backups tidak disentuh) →
`npm ci` → `npm run db:upgrade` (migrasi aman, tidak menghapus data) → `pm2 reload`.

---

## Kalau ada masalah

| Gejala | Cek |
|---|---|
| `pm2 status` errored / restart terus | `sudo pm2 logs drs-secret --lines 50 --nostream` |
| "JWT_SECRET ... wajib diisi" | `.env` belum diisi JWT_SECRET acak ≥ 32 karakter |
| `ER_ACCESS_DENIED` / `ECONNREFUSED` | `DB_PORT`, user dibuat `@'127.0.0.1'`, password di `.env` |
| 502 Bad Gateway | aplikasi mati (pm2) atau port di Nginx ≠ `PORT` di `.env` |
| certbot gagal | DNS subdomain belum mengarah ke server (langkah 0) |
| Backup gagal | `mysqldump --version` ada? `DB_*` di `.env` benar? |
