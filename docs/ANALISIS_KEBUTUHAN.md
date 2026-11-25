# Analisis Kebutuhan — DR's Secret Semarang

Disusun 25 November 2026 dari dokumen operasional yang diberikan pemilik
proyek: buku catatan pengiriman (3–13 November 2026), invoice No. 1129, price
list BWL (berlaku 18 Juni 2025), dan bukti transfer pelanggan. Dibandingkan
dengan kemampuan sistem POS asal yang disalin ke folder ini.

## 1. Gambaran bisnis

- Reseller produk BWL di Semarang, satu toko. Rekening penerima: BCA
  017.021.2100 a.n. Elsje Yoshida. Penanda tangan invoice: Ema.
- Alur: pelanggan pesan (chat) → dibuatkan invoice A4 bernomor urut → pelanggan
  transfer sejumlah grand total → barang dikirim.
- Buku catatan harian per baris: tanggal, tujuan (nama + kota), produk + qty
  (kode singkat), no. invoice, pengirim/cara kirim.
- Nomor invoice berurutan, terakhir terlihat **1131** (13 Nov 2026) → sistem
  baru melanjutkan dari **1132**.
- Contoh invoice 1129 (Mrs. Ing, Pati, 12 Nov 2026): 1 × #9 = Rp1.890.000,
  "FREE konsultasi", ongkir Rp15.000, grand total Rp1.905.000. Bukti transfer
  Rp1.905.000 di hari yang sama.

### Cara kirim yang muncul di catatan

JNT, JNE, "JNE Yes", "KC", "P. SKM", "Bw Bu Elsye" (dibawa Bu Elsje),
"Brng Devi Jkt" (dititipkan). Arti "KC" dan "P. SKM" **belum dikonfirmasi**.

### Kode produk (dugaan dari price list — WAJIB dikonfirmasi pemilik)

| Kode di catatan | Dugaan produk |
|---|---|
| #1 | Cleanser 1 (ada 50ml & 118ml) |
| T2 / T3 / T4 ("Ty"?) | Toner T2 / Skin Glow T3 / Skinrecon T4 |
| #5 / #5M | Sunscreen 5 / Sunscreen Matte 5M |
| #6 | Moisturizer 6 |
| #7 | C15 Essence 7 |
| #8 | Spot Serum 8 |
| #9 / 9B | Refining Serum 9 — 30ml / 90ml ("B" = besar) |
| #10K / #10B | Aqua Boost 10 — 30ml / 90ml (dugaan K = kecil) |
| EPA | Avance Super EPA 2000 |
| Ha jelly | Avance HA Jelly |
| VEM | Vitalising Eye Mask (diberikan gratis per lembar, "2 lmbr") |
| Eye Cream | Eye Cream |
| A1, A6, AR set, NL, BO, TP, "610 caps", Biosc | belum jelas — tanya pemilik |

### Hal-hal khusus di catatan

- **Bonus/gratis** sangat sering: "Free vem 2 lmbr", "Free #10K", "Gift dr Bu
  els 3 sachet collagen", "Promo AR set + A6 (free)", "FREE konsultasi".
- **Paket promo**: Promo Twin #7 + #5, Promo Radiant Eye Kit (#1, Eye Cream,
  #5), Promo Dahsyat Biosc Twin free Booster Essence.
- **Indent**: pesanan Hartini (Irene) sebagian ditandai "indent".
- **Prive**: "Ty (prive Bu els)" — barang diambil pemilik.
- **Baris non-penjualan**: "Roti + paspor" ke Toko Jkt, "BH dr Ibu" — titipan
  pribadi, bukan penjualan.

### Temuan: invoice 1129 salah tulis ukuran

Invoice menulis **"#9 (60ml)"**, padahal Refining Serum 9 hanya ada **30ml
(Rp685.000)** dan **90ml (Rp1.890.000)**. Harga di invoice = harga 90ml, dan
buku catatan menulis `#9B = 1`. Kemungkinan besar barangnya 90ml dan "60ml"
salah ketik. Invoice yang dibuat dari master produk mencegah kesalahan ini.

## 2. Pajak (PPN)

- Price list BWL: harga DP **sudah termasuk PPN 11%** — itu PPN atas pembelian
  toko ke BWL.
- Sistem mendukung dua mode (Pengaturan Toko):
  - **Non-PKP**: jual tanpa PPN; PPN pembelian melebur ke HPP.
  - **PKP**: PPN keluaran di penjualan (tarif bebas, harga termasuk/belum
    termasuk PPN), PPN masukan dipisah, laporan PPN Setoran.
- Mode mana yang dipakai = status pajak usaha (wajib PKP kalau omzet >
  Rp4,8 miliar/tahun) — **belum dikonfirmasi**.

## 3. Kecocokan dengan sistem asal

### Sudah ada

Master produk + multi satuan & konversi (jual per kotak atau per lembar),
multi barcode/kode, level harga, pembelian + supplier + pembelian kredit, retur
pembelian, stok (ledger, opname, riwayat), akuntansi lengkap (COA, laba rugi,
neraca, arus kas, buku besar, tutup buku), PPN, RBAC, backup.

### Belum ada (harus dibangun)

| # | Kebutuhan | Kondisi di sistem asal |
|---|---|---|
| 1 | Data pelanggan | Hanya kolom teks `sales.customer_name`, tidak ada tabel pelanggan |
| 2 | Invoice A4 (logo, nomor urut, rekening, tanda tangan, PDF untuk WA) | Hanya struk thermal 80mm |
| 3 | Ongkir + cara kirim + no. resi | Tidak ada |
| 4 | Alur pesanan (belum bayar → lunas → dikirim) | Penjualan wajib lewat shift kasir (`cashier_shift_id` NOT NULL) dan wajib lunas saat itu |
| 5 | Baris bonus/gratis | Jual di bawah modal butuh otorisasi Owner (PIN + TOTP) setiap kali |
| 6 | Paket promo (bundle) | Tidak ada |
| 7 | Pesanan indent | Penjualan ditolak kalau stok kurang (`insufficient_stock`) |
| 8 | Prive barang | Pemakaian Internal hardcode ke akun Beban Perlengkapan |
| 9 | Bayar utang ke supplier | Tidak ada |
| 10 | Rekap BV (opsional) | Tidak ada |
| 11 | Layanan non-stok, mis. konsultasi gratis (opsional) | Tidak ada |

## 4. Jawaban pemilik (25 November 2026)

| Pertanyaan | Jawaban | Dampak di sistem |
|---|---|---|
| Status pajak PKP / non-PKP | Belum pasti — **buat pengaturannya** | Pilihan di Pengaturan Toko (default seed: Non-PKP). Tarif & mode PPN di halaman Level Harga. |
| Harga jual = harga DP BWL? | Ya. Toko reseller konsep MLM; harga jual ditentukan pusat, ada **poin (BV)** per barang | Harga jual diisi manual di master produk. Kolom `products.bv_points` (per satuan dasar), snapshot ke `sale_items.bv_points`, total di `sales.bv_total`. HPP = harga beli ke BWL (modul Pembelian). |
| Ongkir ditanggung siapa? | **Pembeli** | Ongkir baris tersendiri di invoice, dijurnal ke Pendapatan Ongkos Kirim (4-203). Biaya ke ekspedisi dicatat sbg Beban Pengiriman (5-209). |
| Lunas sebelum kirim / piutang? | Biasanya lunas, tapi **sediakan piutang** | Invoice diakui sbg Piutang Usaha; pembayaran dicatat terpisah (sekaligus/bertahap), ada jatuh tempo & daftar "Belum lunas". |
| Arti kode produk, "KC", "P. SKM" | **Ditulis sambil jalan** | Cara kirim = teks bebas dengan saran isian (bawaan + yang pernah dipakai). Kode produk masuk sbg SKU saat katalog diinput. |
| `pos-client-kasir` masih dipakai? | **Tidak** — hanya online, jualan lewat `pos-admin` | Tidak dikembangkan; menu kasir (Pecahan Uang) & Sinkronisasi disembunyikan dari admin panel. |

Masih terbuka: BV perlu direkap per bulan?; siapa operator & perangkatnya;
baris non-penjualan (titipan pribadi) perlu dicatat atau tidak.
