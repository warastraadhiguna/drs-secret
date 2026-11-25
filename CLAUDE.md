# DR's Secret Semarang — Sistem Penjualan & Stok

Catatan utama proyek untuk Claude. Baca ini dulu sebelum mengubah apa pun.
Detail kebutuhan bisnis ada di `docs/ANALISIS_KEBUTUHAN.md`.

## Asal-usul proyek

- Disalin pada **25 November 2026** dari proyek POS toko lain (`C:\angling\POS`,
  sistem kasir 1 cabang yang sudah dipakai harian). Riwayat git lama sengaja
  **tidak** ikut. Repo git sendiri: `origin` =
  `https://github.com/warastraadhiguna/drs-secret.git`, branch **`master`**
  (bukan `main`). `.gitignore` mengecualikan `.env`, `node_modules`,
  `pos-admin/dist`, `server/backups`; `.gitattributes` memaksa `*.sh`/`*.conf` LF.
- Dokumen proyek asal disimpan sebagai referensi di `docs/referensi-proyek-lama/`
  (`STATUS_PROYEK.md` = peta fitur & prinsip desain, `MVP_Blueprint_POS_1_Cabang.md`
  = rencana awal, `VPS_DEPLOY_TAHAP3.md` = contoh deploy ke VPS). Isinya
  menggambarkan proyek asal; prinsip desain datanya (Bagian 4 STATUS_PROYEK)
  tetap berlaku di sini.
- Proyek asal **tidak boleh tersentuh** dari folder ini (lihat "Aturan keamanan").

## Bisnisnya

Reseller produk BWL (DR's Secret, Aestier, Avance, Optrimax, PentaLab) di
Semarang, **satu toko**, pemilik Bu Elsje Yoshida. Penjualan **berbasis pesanan**
(chat/WA → invoice A4 → pelanggan transfer BCA → barang dikirim via JNT/JNE/kurir
atau diambil), bukan pembeli datang ke kasir. Akan dibuat **online** (diakses lewat
internet). **Tidak ada sync** ke server pusat mana pun.

Keputusan pemilik (25 Nov 2026, rinci di `docs/ANALISIS_KEBUTUHAN.md` §4):
konsep MLM — harga jual ditentukan pusat & tiap barang punya **poin BV**;
ongkir ditanggung **pembeli**; biasanya lunas sebelum kirim tapi **piutang
harus didukung**; status PKP belum pasti (ada pengaturannya); arti kode
produk/cara kirim diisi sambil jalan; **hanya online lewat `pos-admin`** —
aplikasi kasir Electron (`pos-client-kasir`) sudah dihapus dari folder ini
(salinan aslinya tetap ada di proyek asal).

## Struktur

| Folder | Isi |
|---|---|
| `server/` | Node.js + Express + MySQL — semua business logic & API. Juga menyajikan `pos-admin/dist` sebagai file statis. |
| `pos-admin/` | React SPA (admin panel). Build dulu (`npm run build`), diakses lewat server yang sama. Base URL API relatif `/api`. |
| `deploy/` | Deploy ke server produksi: `DEPLOY.md` (panduan), `pack.sh` (bungkus rilis di laptop), `update-on-server.sh`, config Nginx & pm2. |
| `docs/` | Analisis kebutuhan + referensi proyek asal. |

## Menjalankan (lokal, Windows + WAMP)

```bash
# MySQL WAMP harus jalan dulu (service wampmysqld64 — butuh hak admin / ikon WAMP)
cd server
npm run db:migrate   # buat DB pos_drs dari schema.sql (DROP TABLE semua tabel!)
npm run db:seed      # role, permission, COA, akun awal, produk contoh
npm run dev          # http://localhost:4001

cd ../pos-admin && npm run build   # lalu buka http://localhost:4001
```

- Port **4001**, database **`pos_drs`** — sengaja beda dari proyek asal
  (port 4000, DB `pos_branch`) yang berjalan di komputer yang sama.
- Login awal: `admin` (superadmin) & `admin2` (admin) dengan password
  `SEED_ADMIN_PASSWORD` di `server/.env`. Ganti lewat aplikasi setelah login
  pertama.
- Rute kasir warisan (`/api/shifts`, checkout `/api/sales`, `/api/sale-drafts`,
  pecahan uang, user kasir PIN di seed) masih ada di server tapi tidak dipakai
  — semua penjualan lewat Invoice/Pesanan.
- `mysql` CLI tidak ada di PATH — query ad-hoc pakai Node one-liner dari
  `server/`: `node -e "require('dotenv').config(); const p=require('./src/config/db'); p.query('SELECT 1').then(([r])=>{console.log(r);p.end()})"`.

## Aturan keamanan (wajib)

1. **Jangan pernah** mengarahkan apa pun di folder ini ke database `pos_branch`
   atau port 4000 — itu toko lain yang sedang beroperasi. `schema.sql` memakai
   placeholder `__DB_NAME__` yang diisi `migrate.js` dari `DB_NAME`, dan
   `migrate.js` menolak `pos_branch`. Jangan kembalikan nama DB yang
   di-hardcode.
2. `npm run db:migrate` **menghapus semua tabel** di `DB_NAME` — sekarang
   otomatis MENOLAK kalau DB sudah berisi penjualan/produk/pembelian (reset DB
   uji lokal sengaja: `MIGRATE_FORCE=1 npm run db:migrate`). Perubahan skema
   WAJIB lewat skrip migrasi tambahan (pola `src/db/add-*.js`: `ALTER`/`CREATE
   TABLE IF NOT EXISTS`, idempoten), `schema.sql` ikut diperbarui, dan nama
   skripnya DITAMBAHKAN ke daftar `STEPS` di `src/db/upgrade.js`
   (`npm run db:upgrade`, dijalankan otomatis oleh `deploy/update-on-server.sh`).
3. `.env` berisi secret (JWT, password awal) — jangan ditampilkan ke luar,
   jangan pernah di-commit (sudah di `.gitignore`).

## Prinsip desain data (warisan, tetap berlaku)

**Mode SQL ketat** dipaksa per koneksi di `config/db.js` (sama dgn MariaDB
strict di server) — jangan dihapus; bug yang lolos di MySQL longgar akan
meledak di produksi.

UUID sebagai PK; uang = INT rupiah, nilai presisi = DECIMAL + `decimal.js`
(driver `mysql2` mengembalikan DECIMAL & hasil `SUM()` sebagai **string** —
selalu `new Decimal(...)` sebelum hitung); snapshot HPP di `sale_items`;
`stock_movements` = sumber kebenaran, `stock_balances` cache; **tidak ada hard
delete** data transaksi (void/reversal); base unit + konversi; jurnal tidak
pernah diedit — dibalik dengan entri baru. Auth JWT + RBAC dicek live ke DB,
permission yang tidak terdaftar = tertutup (default-closed). `branch_id`
hardcode 1 (memang toko tunggal).

## Yang sudah diubah dari proyek asal

- Nama DB lewat `.env` (`__DB_NAME__` di `schema.sql`, pengaman di `migrate.js`),
  default `pos_drs` di `config/db.js` & `BackupService.js`, nama file backup
  ikut nama DB.
- **Sinkronisasi ke pusat dihapus total** (25 Nov 2026, migrasi
  `src/db/remove-sync.js`): SyncService/Scheduler/route/menu, tabel
  `sync_settings`, kolom `sync_status` di semua tabel, `store_settings.branch_code`,
  izin `sync.*`, `utils/syncStatus.js`, dan `server/docs/`. Default port 4001.
- **Pelanggan** (25 Nov 2026): tabel `customers`, `CustomerService`, rute
  `/api/admin/customers`, layar Pelanggan (daftar + riwayat + piutang).
- **Invoice/Pesanan** (25 Nov 2026): disimpan di `sales` dgn `channel='order'`
  (tanpa shift, `sale_number` = `INV-<no>`), `OrderService` + rute
  `/api/admin/orders`. Nomor urut dari `store_settings.next_invoice_number`
  (dikunci FOR UPDATE, mulai 1132). `grand_total` = nilai barang saja,
  `total_due` = + ongkir. Jurnal: Piutang Usaha (1-201) saat invoice dibuat,
  pembayaran (`sale_payments`, bisa bertahap, dibatalkan lewat status
  'voided') Dr Kas/Bank Cr Piutang; ongkir → 4-203; HPP bonus → Beban Promosi
  5-208. Void invoice wajib batalkan pembayaran dulu; retur hanya untuk
  invoice lunas. Izin baru `customers.*`, `orders.*` (admin dapat semua).
- **Bonus/gratis**: `sale_items.is_bonus` — harga 0, tidak kena aturan HPP.
- **BV**: `products.bv_points` → snapshot `sale_items.bv_points`, `sales.bv_total`.
- **Cetak/PDF invoice A4**: `InvoiceDocument.jsx` (cetak browser) &
  `utils/invoicePdf.js` (jsPDF) — isinya harus dijaga sama. Logo, rekening,
  penanda tangan, catatan kaki di Pengaturan Toko → Invoice.
- **Paket promo** (25 Nov 2026, migrasi `src/db/add-bundles.js`): tabel
  `bundles` + `bundle_items`, `BundleService`, rute `/api/admin/bundles`,
  layar Paket Promo. Di invoice 1 paket dipecah jadi 1 baris `sale_items` per
  isi (`bundle_group` sama, snapshot nama/qty/harga paket); harga paket
  dibagi sebanding harga normal isi (fallback HPP, lalu rata), sisa
  pembulatan ke isi terakhir. BV paket = `bundles.bv_points` (dibagi dgn
  bobot sama) atau, kalau NULL, jumlah BV isinya. Cek HPP per paket.
  Tampilan invoice/PDF/WA menggabungkan baris per paket lewat
  `groupInvoiceLines()` di `pos-admin/src/utils/format.js`.
  `sale_items.line_no` menjaga urutan baris invoice.
- **Pesanan indent** (25 Nov 2026, migrasi `src/db/add-indent.js`): tanda
  `isIndent` per baris invoice (paket: semua isinya).
  `sale_items.fulfillment_status` 'pending' = stok belum dipotong, HPP 0,
  nilai jualnya dikredit ke Pendapatan Diterima Dimuka (2-103) alih-alih
  Penjualan. `OrderService.fulfillIndent` (POST `/admin/orders/:id/fulfill`)
  memotong stok, snapshot HPP berjalan, jurnal Dr 2-103 / Cr Penjualan + HPP
  (sourceType 'sale' → ikut dibalik saat void), dan menambah
  `sales.total_cost`. Isi paket selalu dipenuhi sekaligus. Void hanya
  mengembalikan stok baris 'fulfilled'; baris pending tidak bisa diretur.
  Diskon total & PPN tetap diakui penuh saat invoice dibuat (disederhanakan).
- **Prive barang** (25 Nov 2026, migrasi `src/db/add-internal-usage-type.js`):
  `internal_stock_usages.usage_type` — 'supplies' → Beban Perlengkapan (5-204,
  perilaku lama), 'owner_draw' → Prive Pemilik (3-102), 'promotion' → Beban
  Promosi (5-208). Peta akun di `InternalStockUsageService.USAGE_TYPES`.
  Menu: "Pemakaian Internal & Prive".
- **Utang supplier** (25 Nov 2026, migrasi `src/db/add-supplier-payments.js`):
  `purchases.due_date/amount_paid/payment_status` (tunai langsung 'paid'),
  tabel `supplier_payments` (per nota, bertahap, void = status + jurnal
  balik), `SupplierPayableService` + rute `/api/admin/supplier-payables`,
  layar Pembelian → Utang Supplier. Cara bayar: cash/bank (Dr Utang Usaha
  2-101 / Cr Kas|Bank) atau `return_credit` = pakai saldo retur pembelian
  kredit (TANPA jurnal, utang sudah turun saat retur). Void pembelian
  ditolak selama ada pelunasan aktif. Izin `supplier_payments.*`.
- **Rekap BV** (25 Nov 2026): `ReportService.getBvRecap`, GET
  `/api/admin/reports/bv`, layar Laporan → Rekap Poin BV (per bulan tanggal
  invoice, per produk & pelanggan, BV indent ditandai, unduh Excel).
- **Produk jasa/non-stok** (25 Nov 2026, migrasi `src/db/add-service-products.js`):
  `products.is_service`. Ditolak di `StockMovementService.applyStockMovement`
  (satu titik pengaman utk pembelian/pemakaian/retur/opname); OrderService
  melewati stok & HPP utk jasa; tidak bisa indent; tidak muncul di daftar
  stok & opname. Ganti barang↔jasa ditolak kalau sudah ada riwayat stok.
- Admin panel: grup menu **Penjualan** (default), menu Sinkronisasi & Pecahan
  Uang disembunyikan, kartu Kode Cabang & Level Harga Kasir dihapus dari
  Pengaturan Toko.

## Pekerjaan berikutnya (urut prioritas — rincian di docs/ANALISIS_KEBUTUHAN.md)

Selesai 25 Nov 2026: (1) data pelanggan, (2) modul invoice/pesanan + piutang,
(3) cetak/PDF invoice A4, (4) baris bonus/gratis, (5) paket promo,
(6) pesanan indent, (7) prive barang, (8) pembayaran utang supplier.

Juga selesai: (9) rekap BV & produk jasa, (10) hapus sync & `pos-client-kasir`.

- **Katalog BWL**: belum diisi (seed `PRODUCTS` kosong) — menunggu price list
  dari pemilik (nama, kode, satuan, harga jual, BV, harga beli/HPP awal, stok awal).
- Belum ditangani di invoice: koreksi ongkir/isi invoice setelah tersimpan
  (sekarang: void lalu buat ulang); retur sebagian atas invoice belum lunas.
- Sebelum online: lihat bagian berikut.

## Produksi / online

Target: `https://drs-secret.wan-client.com` di server Ubuntu 22 bersama (Nginx,
MariaDB port 5431, pm2) — kemungkinan server yang sama dgn proyek asal
(`docs/referensi-proyek-lama/VPS_DEPLOY_TAHAP3.md`). Panduan lengkap:
`deploy/DEPLOY.md`. App di `/var/www/drs-secret`, `HOST=127.0.0.1`,
`PORT=4101`, pm2 name `drs-secret` (WAJIB 1 instance), user DB `drs_secret`@`127.0.0.1`.

Sudah di kode (25 Nov 2026): `trust proxy` (rate limiter login per IP asli),
CORS mati kecuali `CORS_ORIGIN` diisi, `x-powered-by` mati, error 500 tanpa
detail di `NODE_ENV=production`, server menolak start kalau `JWT_SECRET`
lemah, seed produksi menolak password lemah & tidak membuat user kasir PIN,
`mysqldump --no-tablespaces` utk user DB non-root.

Sisa tanggung jawab operasional: ganti password awal, backup otomatis +
salinan di luar server.
