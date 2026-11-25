# Status Proyek — POS 1 Cabang

**Terakhir diperbarui:** 7 Oktober 2026
**Tujuan dokumen ini:** ringkasan kondisi sistem SAAT INI (bukan rencana), supaya diskusi fitur berikutnya bisa dilanjutkan di tempat lain (mis. Claude web) tanpa perlu akses ke kode. Lihat juga `MVP_Blueprint_POS_1_Cabang.md` — itu dokumen rencana ASLI dari hari 1 (17 Juli 2026), scope-nya sengaja dipersempit jadi 7 hari demo. Sistem sekarang sudah jauh melewati scope itu (modul akuntansi penuh, misalnya, awalnya eksplisit "ditunda" — sekarang sudah dibangun dan dipakai harian). Anggap blueprint itu sebagai **sejarah keputusan arsitektur awal yang masih berlaku** (lihat Bagian 4 di bawah), bukan daftar fitur yang akurat.

---

## 1. Arsitektur & Stack

Tiga repo terpisah, masing-masing git repo sendiri dengan remote GitHub sendiri (semua di bawah `warastraadhiguna`):

| Repo | Isi | Remote |
|---|---|---|
| `server/` | Node.js + Express + MySQL — **otak sistem**, semua business logic | `pos-global-server` |
| `pos-admin/` | React SPA (admin panel) — dibuild statis (`npm run build`), **disajikan oleh server yang sama** lewat `express.static` (lihat `server/src/app.js`), bukan server dev terpisah | `pos-global-admin` |
| `pos-client-kasir/` | Electron + React — shell kasir, silent print struk | `pos-global-casier` |

Catatan penting soal arsitektur:
- `pos-admin` TIDAK boleh dijalankan sebagai `npm run dev` (vite standalone) untuk testing end-to-end — base URL API-nya relatif (`/api`), jadi kalau dibuka dari port vite sendiri (mis. 5174) semua request API 404. Build dulu (`npm run build`), lalu akses lewat server yang sama (`http://localhost:4000`).
- Printer struk: pakai `Electron webContents.print()` dari HTML — **bukan** raw ESC/POS. ini perubahan dari rencana awal.
- Hardware printer aktual: Epson TM-T83III (bukan TM-T82 seperti rencana awal).
- DB: MySQL (`pos_branch`), `branch_id` hardcode `1` di semua query — belum multi-cabang.
- Auth: JWT + RBAC. Setiap request ke endpoint yang digerbangi `requirePermission(module, action)` dicek **live ke database** (JOIN `role_permissions`+`permissions`), bukan dari snapshot di token — supaya pencabutan izin langsung berlaku tanpa re-login. `roles.is_superadmin=1` adalah bypass total. Kombinasi module+action yang **tidak terdaftar sama sekali** di tabel `permissions` otomatis tertutup untuk semua role non-superadmin (default-closed, bukan default-allow).

---

## 2. Peta modul yang SUDAH dibangun

### Master Data
Produk (+ multi satuan & konversi, multi barcode), Kategori, Satuan, Level Harga, Metode Pembayaran, Pecahan Uang Kas.

### Penjualan / Kasir (`pos-client-kasir`)
- POS: scan barcode, keranjang multi-satuan & multi-level-harga, diskon, checkout multi-pembayaran.
- Shift kasir: buka/tutup shift, cash in/out, hitung selisih kas otomatis.
- Draft nota (simpan transaksi belum selesai, lanjutkan nanti).
- Void penjualan — alasan wajib, tercatat `activity_logs`.
- Retur Penjualan — **ada fiturnya**, tapi lihat celah di Bagian 5: permission module `sales_returns` belum terdaftar di katalog izin, jadi saat ini praktis cuma superadmin yang bisa akses.

### Stok
- `stock_movements` sebagai ledger/source of truth; `stock_balances` cache (termasuk `avg_cost_per_base_unit`, dihitung moving average — lihat `StockMovementService.applyMovementStep`).
- Riwayat Stok.
- **Pemakaian Internal Stok** — barang dagangan dipakai sendiri (bukan dijual), dibebankan sebesar HPP berjalan ke akun beban. Bisa di-void lewat Riwayat Pemakaian Internal, tapi jurnal pembalik & movement pembalik **hardcode ke tanggal SAAT di-void** (bukan tanggal transaksi asli) — relevan kalau transaksi asli ada di bulan yang sudah ditutup bukunya.
- **Stock Opname** — selisih stok fisik dinilai pakai avg cost yang **sudah ada**, jadi SALAH dipakai untuk kasus barang masuk gratis (akan ikut menaikkan nilai persediaan + muncul "Keuntungan Selisih Persediaan" fiktif). Untuk barang gratis yang mau dipakai sendiri, jalur yang benar adalah Pemakaian Internal Stok dengan HPP yang sudah tercampur rata (karena barang gratis itu menurunkan avg cost keseluruhan saat diterima, bukan dicatat terpisah).

### Pembelian
- Supplier, Pembelian (+ draft pembelian), Riwayat Pembelian (per nota maupun per produk).
- **Retur Pembelian** — dokumen BERDIRI SENDIRI, **tidak** direferensikan ke nota pembelian asli manapun (tidak ada `purchaseId`). Valuasi pakai avg cost **saat ini** (bukan harga beli asli di nota tsb) — pola "OUT biasa" seperti penjualan, bukan pembalik nilai seperti Void. Jurnal cuma menyentuh akun neraca (Kas/Utang Usaha di satu sisi, Persediaan di sisi lain) — **tidak pernah** menyentuh pendapatan/beban, jadi tidak mengganggu Laba Rugi. Tanggal bisa dipilih bebas oleh user (beda dari Void yang hardcode ke hari ini).
- Tidak ada subledger utang per-supplier — "Utang Usaha" adalah satu akun agregat, bukan per-supplier.

### Akuntansi
Modul ini awalnya eksplisit **"ditunda ke fase berikutnya"** di blueprint hari 1 — sekarang sudah dibangun penuh dan dipakai:
- Chart of Accounts (COA).
- Jurnal manual: Beban & Prive (owner draw).
- Aset Tetap & Depresiasi — proses bulanan dipicu manual oleh admin, aman diklik berkali-kali (periode yang sudah dijurnal otomatis dilewati, tidak pernah dobel).
- Saldo Awal Persediaan (proses sekali-jalan).
- Laporan: Neraca Saldo, Laba Rugi, Neraca, Arus Kas, Buku Besar, PPN Setoran (Keluaran vs Masukan, relevan kalau mode pajak PKP).
- **Tutup Buku (period closing)** — baru dibangun 2 Okt–7 Okt 2026. Admin bisa menutup/membuka kembali periode per bulan dari layar "Tutup Buku" (grup menu Akuntansi). Begitu periode ditutup, `AccountingService.assertPeriodOpen` (dipanggil wajib di `postJournalEntry`, jadi berlaku untuk SEMUA jalur jurnal — otomatis dari transaksi maupun manual) menolak jurnal baru bertanggal di periode itu dengan error `409 period_closed`. Sengaja **tidak** memaksa urutan tutup berurutan (keputusan desain eksplisit, didokumentasikan di komentar `AccountingPeriodService.js` — dianggap over-engineering untuk kebutuhan yang belum tentu ada). Tidak bisa menutup periode yang belum terjadi. Buka kembali wajib isi alasan, tercatat ke `activity_logs`. Digerbangi permission `accounting.close_period` (terpisah dari `accounting.view`/`accounting.create`, ditandai sensitif).
- Pola **Void/Reversal** dipakai konsisten di seluruh sistem akuntansi: entri jurnal asli TIDAK PERNAH diedit/dihapus, hanya ditandai `status='reversed'`; dibuat entri BARU dengan debit/kredit dibalik di tiap baris. Entri yang sudah di-reverse tetap IKUT dihitung di semua laporan (tidak ada filter `status='posted'` di manapun pada `AccountingReportService.js`) — supaya asli + pembalik saling menetralkan jadi nol secara matematis, bukan "disembunyikan".

### Administrasi
Kelola Pengguna, Kelola Role & Wewenang (RBAC granular per module+action), Pengaturan Toko (identitas, visibilitas level harga, mode pajak), Backup Database (manual + jadwal otomatis), Notifikasi Perubahan Harga.

---

## 3. Skema database (tabel-tabel inti, per `server/src/db/schema.sql`)

```
roles, permissions, role_permissions, users
product_categories, units, products, product_units, barcodes
price_levels, product_prices
warehouses, stock_movements, stock_balances, stock_adjustments
cashier_shifts, cash_movements
sales, sale_items, sale_payments
suppliers, purchases, purchase_items, purchase_payments
stock_opnames, stock_opname_items
purchase_returns, purchase_return_items
internal_stock_usages, internal_stock_usage_items
purchase_drafts, sale_drafts
sale_returns, sale_return_items
activity_logs
payment_methods, cash_denominations
accounts, accounting_periods, journal_entries, journal_entry_lines
fixed_assets, fixed_asset_depreciation_entries
opening_balance_runs
pricing_settings, store_settings
backup_settings, backup_history
price_change_events, price_change_event_lines
```

---

## 4. Prinsip desain data — masih berlaku, jangan dilanggar

Dari blueprint asli, dikonfirmasi masih dipegang di seluruh kode baru:

1. **UUID** sebagai primary key semua tabel transaksi (bukan auto-increment) — kesiapan sync ke pusat nanti.
2. Kolom **`sync_status`** disiapkan di tabel transaksi utama, tapi engine sync-nya **belum dibangun**.
3. **`branch_id`** hardcode `1` di semua query, tapi jangan diasumsikan single-tenant di level logic.
4. **Uang = integer rupiah**, nilai presisi (avg cost dll) pakai `DECIMAL` di MySQL + `decimal.js` di kode. **Jangan pernah** operasi `+`/`-` JS biasa pada kolom `DECIMAL` atau hasil `SUM()` — driver `mysql2` mengembalikan keduanya sebagai **string**, bukan `Number`. Kejadian nyata: `ShiftService.calculateExpectedCash` pernah overflow ke `2147483647` karena string concatenation, bukan penjumlahan. Pola wajib: bungkus `new Decimal(...)` dulu sebelum operasi matematis apa pun.
5. **Snapshot HPP** wajib disimpan di `sale_items.cost_per_unit` saat transaksi terjadi, bukan dihitung ulang saat retur.
6. **Stock movement = source of truth** — `stock_balances` cuma cache, harus selalu bisa direkonstruksi dari movement.
7. **Tidak ada hard delete** pada data transaksi — pakai `voided_at`/`cancelled_at`/`status='reversed'` sesuai konteks.
8. **Base unit + konversi** — setiap produk punya base unit, stok & HPP selalu dihitung dalam base unit.

---

## 5. Celah yang diketahui (belum diperbaiki — kandidat kerja berikutnya)

- **`sales_returns` permission belum terdaftar** di katalog `PERMISSIONS` (`server/src/db/seed.js`). Route-nya (`adminSalesReturns.routes.js`) sudah pakai `requirePermission('sales_returns', ...)`, tapi karena module+action itu tidak ada barisnya di tabel `permissions`, sistem RBAC default-closed membuatnya **tidak bisa diberikan ke role manapun** lewat halaman Kelola Role — cuma superadmin yang bisa akses. Kemungkinan belum ketahuan karena pemakaian sehari-hari masih lewat akun superadmin.
- **Void (Pemakaian Internal, dan kemungkinan jalur void lain)** hardcode jurnal pembalik ke tanggal **hari ini**, tidak bisa backdate ke tanggal transaksi asli — jadi kalau transaksi aslinya ada di periode yang sudah ditutup, void akan tercatat di periode berjalan, bukan periode asli. (Ini tadinya pertimbangan penting saat desain Tutup Buku — sudah didiskusikan, perilaku ini dianggap tetap benar/acceptable untuk kasus koreksi kesalahan input.)
- **Retur Pembelian tidak terhubung ke nota pembelian asli** — tidak ada field referensi/linkage. Kalau ke depan butuh audit "retur ini dari nota yang mana", perlu ditambah.
- **Tidak ada subledger utang per-supplier** — "Utang Usaha" satu akun agregat.
- `pos-admin` tidak melakukan filtering menu berbasis permission di sisi client — semua item menu selalu tampil ke user manapun yang login, otorisasi murni ditegakkan di API (403 kalau tidak berhak). Belum dicek apakah semua screen menampilkan pesan error yang jelas kalau kena 403.

---

## 6. Keputusan bisnis yang relevan untuk diskusi lanjutan

Beberapa hal yang sudah dibahas & diputuskan dalam diskusi dengan owner/admin toko, berguna sebagai konteks kalau mau lanjut ke fitur terkait:

- **Barang gratis dari supplier** (mis. 1 pcs kresek gratis dari 1 dos) yang dipakai sendiri sebagai perlengkapan toko: dicatat lewat **Pemakaian Internal Stok** seperti biasa (dibebankan sebesar HPP berjalan). Stock Opname **bukan** jalur yang tepat untuk ini karena akan menilai barang gratis itu pakai avg cost yang sudah ada, bukan nol — malah lebih salah.
- **Kesalahan input kuantitas** (mis. tercatat 1 karton/20 pack padahal yang dipakai cuma 1 pack): dikoreksi lewat **Void** dokumen Pemakaian Internal yang salah, lalu input ulang dengan kuantitas yang benar.
- **Retur barang ke supplier yang merupakan pihak terkait** (kasus: PT SA Indonesia, kerabat/1 payung yang sama dengan owner, menarik kembali sebagian barang yang sudah diinput di pembelian untuk dijual ke tempat lain): dicatat lewat **Retur Pembelian** biasa — stok berkurang, utang ke supplier itu berkurang (karena jurnalnya di sisi Kas/Utang Usaha), dan Laba Rugi **tidak terganggu** karena retur pembelian murni transaksi neraca.
- **Tutup buku bulan yang sudah lewat**: kalau ada koreksi (void/retur) yang perlu dicatat setelah bukunya ditutup, jurnal pembalik/baru akan jatuh ke bulan BERJALAN (bulan saat aksi dilakukan), bukan di-backdate ke bulan asli — ini sudah dikonfirmasi sebagai perilaku yang diterima, bukan bug yang perlu diperbaiki.
- **Konsep Tutup Buku**: menutup periode = mengunci bulan itu supaya tidak ada jurnal baru (otomatis maupun manual) yang bisa diposting dengan tanggal di bulan itu. Tujuannya: begitu laporan keuangan bulan itu sudah "final" (dipakai buat keputusan, dilaporkan ke pihak lain, dll), angkanya tidak bisa berubah diam-diam oleh transaksi susulan yang salah tanggal. Fitur ini **tidak wajib** dipakai (semua bulan default terbuka), tapi sangat disarankan dipakai begitu laporan bulanan sudah dianggap final.

---

## 7. Cara menjalankan untuk testing/verifikasi

```bash
# Server (port 4000, auto-reload via --watch)
cd server && npm run dev

# pos-admin — HARUS dibuild dulu, lalu diakses lewat server yang sama
cd pos-admin && npm run build
# buka http://localhost:4000 (BUKAN port vite dev server)

# Login dev
# Superadmin: admin / admin123
# Admin biasa: admin2 / admin123
# (password override via env SEED_ADMIN_PASSWORD)
```

---

## 8. Dokumen terkait

- `MVP_Blueprint_POS_1_Cabang.md` — rencana arsitektur & scope hari 1 (sejarah, prinsip desain di Bagian 4 di atas masih berlaku, daftar fitur sudah usang).
