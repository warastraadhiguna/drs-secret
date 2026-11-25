# Blueprint MVP — POS 1 Cabang (Handoff untuk Claude Code)

Dokumen kerja untuk Claude Code menjalankan development secara mandiri.
Diturunkan dari diskusi desain arsitektur — versi MVP, 1 cabang, target 10 hari.

---

## 1. Tujuan Dokumen

Ini adalah pegangan teknis agar Claude Code bisa membangun aplikasi ini
**tanpa perlu menanyakan ulang keputusan yang sudah disepakati**. Baca dokumen
ini penuh sebelum mulai coding. Bagian 9 (Protokol Eskalasi) menentukan kapan
harus berhenti dan bertanya ke user, dan kapan boleh lanjut jalan sendiri.

---

## 2. Ringkasan Keputusan Arsitektur

- Arsitektur **client-server dalam 1 cabang**: server cabang, komputer kasir,
  komputer admin — semua di LAN yang sama.
- Server cabang adalah otak sistem. Semua business logic ada di sana.
  Client (kasir, admin) hanya UI + kirim aksi ke API.
- Ini adalah **versi MVP** yang scope-nya disederhanakan dari visi jangka
  panjang (multi-cabang, sync ke pusat, akuntansi penuh, license server).
  Skema data disiapkan agar migrasi ke visi jangka panjang tidak perlu
  rombak ulang — lihat Bagian 5.

---

## 3. Stack Teknologi Final

| Komponen | Teknologi | Catatan |
|---|---|---|
| Server cabang | Node.js + Express | API REST, semua business logic |
| Database | MySQL (InnoDB) | Bukan SQLite — butuh row-level locking untuk multi-kasir dan tipe `DECIMAL` presisi untuk uang |
| Client kasir | Electron + React | Electron = shell + silent print saja, bukan tempat business logic |
| Client admin | React (SPA), dibuka via browser biasa | Tidak perlu Electron, cukup browser |
| Perhitungan uang/HPP | `decimal.js` di kode + `DECIMAL` di kolom MySQL | Jangan pernah pakai operator `+`/`*` JS biasa untuk uang |

**Ditunda ke fase berikutnya (jangan dibangun di MVP ini):**
Docker, license server, sync engine ke pusat, akuntansi (COA/jurnal/closing),
multi-cabang.

---

## 4. Scope MVP — In / Out

**Catatan versi: dipersempit jadi 7 hari untuk MVP presentasi ke bos.**
Ini bukan demo sekali pakai — sistem ini akan lanjut dipakai standar setelah
presentasi, jadi fondasi (Bagian 5) tetap utuh, yang dipangkas cuma fitur
pendukung yang aman menyusul minggu berikutnya.

### Masuk scope (7 hari)
- Login kasir & admin (role sederhana: kasir, admin)
- Buka/tutup shift kasir, cash in/out, hitung selisih kas
- Penjualan: scan barcode, multi satuan (pcs/lusin/dos + konversi), multi
  harga (ecer/grosir), diskon, multi pembayaran (tunai dulu, cukup)
- Cetak struk via silent print (Electron)
- Void transaksi (dengan alasan wajib, dicatat ke activity_logs)
- Stock movement sebagai ledger (bukan angka tunggal) — 1 gudang dulu
- Moving average cost + snapshot HPP per item transaksi
- Admin panel minimal: CRUD produk, kategori, satuan, harga
- Logging dasar ke `activity_logs` (login, void, diskon manual, reprint) —
  datanya dicatat dari hari 1, walau UI untuk mereview belum ada

### Belum masuk scope (ditunda ke fase lanjutan setelah demo)
- Akuntansi (COA, jurnal, buku besar, laba rugi, neraca, closing)
- Sync ke server pusat — fondasi data sudah disiapkan (lihat Bagian 5),
  tapi engine pengirimannya belum dibangun
- License activation — pakai activation key sederhana dulu, bukan
  hardware-binding penuh
- Docker deployment — instalasi manual dulu di 1 mesin server cabang
- Pembelian terpusat & distribusi antar cabang — belum relevan untuk 1 cabang
- **Modul retur formal** (credit note mereferensikan invoice lama) — void
  cukup dulu untuk minggu pertama
- **Export CSV/Excel laporan** — laporan tetap bisa dilihat langsung di
  admin panel, tombol download menyusul
- **Dashboard audit trail** — log tetap tercatat di database, UI untuk
  mereview menyusul
- **Multi gudang** (utama vs display) — disederhanakan jadi 1 gudang,
  struktur tabel tetap siap ditambah nanti
- **Approval matrix** untuk diskon/void besar — tercatat siapa yang
  melakukan, tapi belum ada aturan otomatis butuh approval

---

## 5. Prinsip Desain Data (WAJIB DIIKUTI — jangan diubah tanpa eskalasi)

Ini bukan preferensi gaya, ini keputusan yang punya konsekuensi jangka
panjang. Semua sudah dipertimbangkan matang-matang di diskusi sebelumnya.

1. **UUID sebagai primary key** untuk semua tabel transaksi (bukan
   auto-increment). Ini wajib untuk kesiapan sync ke pusat nanti.
2. **Kolom `sync_status`** (default `'local_only'`) di semua tabel transaksi
   utama (sales, sale_items, stock_movements, cashier_shifts). Logic sync-nya
   belum dibangun — kolom ini cuma disiapkan.
3. **Kolom `branch_id`** di semua tabel transaksi, hardcode ke 1 untuk MVP
   ini, tapi jangan diasumsikan single-tenant di level query/logic.
4. **Uang disimpan sebagai integer rupiah** (tidak ada pecahan sen). Untuk
   nilai yang butuh presisi desimal (harga modal rata-rata bergerak), pakai
   `decimal.js` di JavaScript dan kolom `DECIMAL` (bukan `FLOAT`/`DOUBLE`)
   di MySQL.
5. **Snapshot HPP wajib** disimpan di setiap `sale_items` saat transaksi
   terjadi (`cost_per_unit`), bukan dihitung ulang saat retur nanti.
6. **Stock movement sebagai sumber kebenaran stok** — jangan pernah
   mengurangi/menambah field `stock_balance` secara langsung tanpa mencatat
   baris di `stock_movements`. `stock_balance` boleh ada sebagai cache,
   tapi harus selalu bisa direkonstruksi dari movement.
7. **Tidak ada hard delete** pada data transaksi. Pakai `voided_at`,
   `cancelled_at` sesuai konteks.
8. **Base unit + konversi** — setiap produk punya base unit (biasanya pcs).
   Transaksi menyimpan `quantity`, `unit_id`, `conversion_factor`, dan
   `quantity_base` hasil konversi. Stok dan HPP selalu dihitung dalam
   base unit.

**Catatan implementasi (ditambahkan Hari 3, 2026-07-17):** poin 4 di atas
bukan cuma soal kolom `DECIMAL` di MySQL — driver `mysql2` mengembalikan
kolom `DECIMAL` *dan* hasil agregat `SUM()` (tipe `BIGINT`) sebagai **string**
ke JavaScript, bukan `Number`. Kalau nilai itu langsung dioperasikan pakai
`+`/`-` tanpa dibungkus `decimal.js` dulu, JS melakukan *string concatenation*,
bukan penjumlahan — ini pernah kejadian sungguhan di `ShiftService.
calculateExpectedCash` (hasil `SUM()` bikin kas sistem overflow ke
`2147483647`) dan sudah diperbaiki. Pola wajib: setiap kali membaca kolom
`DECIMAL` atau hasil `SUM()`/agregat dari MySQL, bungkus dulu dengan
`new Decimal(...)` sebelum operasi matematis apa pun — lihat
`StockMovementService.js` dan `SalesService.js` sebagai referensi pola yang
benar. **Ini wajib diikuti juga saat modul retur formal dan stock adjustment/
opname dibangun nanti** (keduanya sudah punya kolom `DECIMAL` di skema —
lihat `sale_return_items.quantity_base`/`cost_per_base_unit` dan
`stock_adjustments.qty_base` — tapi belum ada service/logic yang membacanya
sampai dokumen ini ditulis).

---

## 6. Tabel Inti (skema awal — nama boleh disesuaikan, struktur relasi jangan)

| Kelompok | Tabel |
|---|---|
| Master | `products`, `product_categories`, `units`, `product_units`, `barcodes` |
| Harga | `price_levels`, `product_prices` (kolom: product_id, unit_id, price_level_id, min_qty_base, price) |
| User | `users`, `roles` |
| Penjualan | `sales`, `sale_items`, `sale_payments`, `sale_returns`, `sale_return_items` |
| Kasir | `cashier_shifts`, `cash_movements` |
| Stok | `warehouses`, `stock_movements`, `stock_balances`, `stock_adjustments` |
| Audit | `activity_logs` |

Contoh field wajib di `stock_movements`:
```
uuid, branch_id, warehouse_id, product_id, movement_type,
reference_type, reference_uuid, qty_in_base, qty_out_base,
cost_per_base_unit, total_cost, movement_date, sync_status
```

Contoh field wajib di `sale_items`:
```
uuid, sale_id, product_id, unit_id, quantity, conversion_factor,
quantity_base, selling_price, subtotal, cost_per_base_unit,
total_cost, gross_profit
```

---

## 7. Rencana 7 Hari (versi demo presentasi ke bos)

| Hari | Fokus | Risiko |
|---|---|---|
| 1 | Schema MySQL (disederhanakan, 1 gudang) + scaffold Express server | Rendah |
| 2 | POS React: scan barcode, keranjang, multi satuan, multi harga, checkout tunai | Rendah |
| 3 | Stock movement + moving average cost + HPP snapshot + shift kasir | Sedang |
| 4 | Silent print struk ke printer thermal asli | **Tinggi** — butuh printer fisik, tidak bisa disimulasikan |
| 5 | Admin panel minimal: CRUD produk, kategori, satuan, harga | Rendah |
| 6 | Testing end-to-end di jaringan LAN toko asli + packaging installer | **Tinggi** — butuh setup IP statis, jaringan nyata |
| 7 | Buffer bug dari hari 6 + siapkan skenario demo untuk presentasi | — |

Catatan: buffer cuma 1 hari untuk menampung dua hari berisiko tinggi (4 dan
6). Pastikan printer thermal dan barcode scanner fisik sudah di tangan
sebelum hari 3, supaya hari 4 tidak tertunda menunggu perangkat datang.

---

## 8. Aturan Implementasi Teknis

- Gunakan **database transaction** (MySQL) untuk setiap transaksi POS:
  `sales`, `sale_items`, `sale_payments`, `stock_movements`, `activity_logs`
  harus commit/rollback bersama.
- Pisahkan logic ke **service layer** (mis. `SalesService`,
  `StockMovementService`, `PricingService`, `CostingService`) — jangan
  taruh business logic di route handler langsung.
- Jangan pernah pakai `Number` biasa untuk operasi matematis pada uang/HPP —
  selalu lewat `decimal.js`, baru dikonversi ke integer/string saat disimpan.
- Electron **tidak boleh** menyimpan database sendiri atau logic bisnis.
  Dia hanya membuka UI React dan handle silent print + device I/O.
- IP server harus bisa dikonfigurasi (bukan hardcode), karena di lapangan
  nanti bisa beda-beda tergantung jaringan toko.

---

## 9. Protokol Eskalasi — WAJIB dibaca sebelum jalan otonom

Claude Code boleh dan sebaiknya **jalan sendiri tanpa bertanya** untuk hal
teknis sehari-hari: struktur file, penamaan variabel, pilihan library kecil,
refactor, menulis test, memperbaiki bug yang jelas.

**Claude Code WAJIB berhenti dan bertanya ke user (bukan asal ambil
keputusan sendiri) kalau:**

1. Perlu mengubah struktur tabel inti di Bagian 5–6 (bukan menambah kolom
   kecil, tapi mengubah relasi/prinsip dasarnya).
2. Menemukan aturan bisnis yang **ambigu dan tidak dijelaskan** di dokumen
   ini (contoh: berapa batas diskon manual per role, aturan approval retur
   nominal besar) — jangan menebak, tanyakan.
3. Ada keputusan yang menyentuh **keamanan** (autentikasi, penyimpanan
   password/credential, format license key).
4. Masalah integrasi hardware yang tidak terselesaikan setelah beberapa
   percobaan (printer tidak terdeteksi, format ESC/POS tidak cocok) —
   jangan coba-coba berjam-jam sendirian, laporkan dan lanjut ke bagian lain.
5. Timeline 10 hari kelihatan tidak akan tercapai — laporkan sedini mungkin,
   bukan di hari ke-9.
6. Sebelum **deploy ke mesin produksi toko yang sebenarnya** (bukan
   lingkungan development) — ini butuh konfirmasi eksplisit dari user.
7. Menemukan scope creep — diminta menambah fitur yang tidak ada di Bagian 4
   "Masuk scope".

Kalau ragu antara "ini penting" atau "ini teknis biasa" — condongkan ke
bertanya untuk hal yang menyentuh **uang, data client, atau keamanan**, dan
jalan sendiri untuk hal yang murni teknis/kode.

---

## 10. Prompt Pembuka untuk Claude Code

Gunakan ini saat memulai sesi Claude Code baru di folder project:

> Baca dokumen `MVP_Blueprint_POS_1_Cabang.md` ini penuh dulu sebelum mulai.
> Bangun sistem POS 1 cabang sesuai Bagian 7 (rencana 7 hari), ikuti
> prinsip desain data di Bagian 5 tanpa kecuali, dan ikuti protokol
> eskalasi di Bagian 9 — kalau menemukan hal yang perlu dikonfirmasi ke
> saya, berhenti dan laporkan, jangan menebak sendiri. Mulai dari Hari 1:
> schema MySQL dan scaffold Express server.
