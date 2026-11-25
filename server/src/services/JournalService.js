// Jembatan eksplisit antara modul penjualan (SalesService/VoidService) dan
// mesin jurnal generik (AccountingService) — Lapis 2 (feature/accounting).
// SENGAJA dipanggil langsung dari SalesService/VoidService di dalam transaksi
// yang sama (bukan trigger DB, bukan event/listener tersembunyi), supaya
// jelas terbaca di kode kapan jurnal dibuat dan supaya kalau jurnal gagal,
// seluruh transaksi (sale/stock_movements/void) ikut rollback lewat mekanisme
// try/catch yang sudah ada di sana — tidak ada logic transaksi baru di sini.
const Decimal = require('decimal.js');
const AccountingService = require('./AccountingService');
const HttpError = require('../utils/HttpError');

const ACCOUNT_CODES = {
  KAS: '1-101',
  BANK: '1-102',
  PERSEDIAAN: '1-301',
  PENJUALAN: '4-101',
  RETUR_POTONGAN_PENJUALAN: '4-102',
  HPP: '5-101',
  PPN_KELUARAN: '2-104',
};

// Pembayaran tunai -> akun Kas, semua metode non-tunai (QRIS/kartu/transfer,
// dst) -> akun Bank (disederhanakan jadi satu akun bank bersama utk MVP;
// payment_methods belum ada pemetaan akun per-metode — cukup jelas kalau
// nanti perlu dipisah per rekening/e-wallet).
async function resolvePaymentAccount(conn, isCashPayment) {
  return AccountingService.getAccountByCode(isCashPayment ? ACCOUNT_CODES.KAS : ACCOUNT_CODES.BANK, conn);
}

// Dipanggil dari SalesService.createSale, di dalam transaksi yang sama,
// SEBELUM conn.commit(). Menghasilkan sampai 2 jurnal:
//   1) Jurnal pendapatan — Diskon SELALU baris terpisah (akun Retur &
//      Potongan Penjualan) di SEMUA kasus, PPN aktif atau tidak (revisi —
//      keputusan klien: diskon wajib kelihatan di buku besar). Yang beda
//      cuma "Penjualan" dicatat di angka berapa & apakah ada baris PPN
//      Keluaran, tergantung PPN aktif/tidak dan mode-nya:
//      - TANPA PPN (ppnAmount=0, PERSIS perilaku sebelum Batch 3C, tidak
//        berubah): Debit Kas/Bank (grandTotal) [+ Debit Diskon kalau ada]
//        = Kredit Penjualan (subtotal kotor B, sebelum diskon).
//      - DENGAN PPN mode exclude: Debit Kas/Bank (N+PPN, PPN nambah di atas)
//        + Debit Diskon (Dc, nilai wajar/face value — SAMA persis dgn yang
//        tampil di struk) = Kredit Penjualan (B, bruto APA ADANYA — di mode
//        ini B memang sudah tax-exclusive, tidak perlu disesuaikan) +
//        Kredit PPN Keluaran (PPN).
//      - DENGAN PPN mode included: Debit Kas/Bank (N, TIDAK bertambah — PPN
//        sudah ada di dalam N) + Debit Diskon (Dc, SAMA nilai wajar seperti
//        mode exclude, TIDAK di-"bersih"-kan dari PPN — lihat derivasi yang
//        disetujui user) = Kredit Penjualan (B' = B − PPN, bruto DIKURANGI
//        PPN yang terkandung di dalamnya — supaya Penjualan yang dibukukan
//        tetap pre-tax di KEDUA mode, konsisten) + Kredit PPN Keluaran (PPN).
//        B' = B − PPN adalah pengurangan dua angka yang SUDAH bulat rupiah
//        (subtotalDec & ppnAmountDec) → hasilnya otomatis bulat, TIDAK ADA
//        pembulatan baru yang diperkenalkan di sini. Balance jurnal
//        TERJAMIN lewat identitas aljabar N+Dc=B (selalu benar, sudah
//        diverifikasi user), bukan dicek belakangan.
//   2) Jurnal HPP: Debit Harga Pokok Penjualan = Kredit Persediaan Barang
//      Dagang, sebesar totalCost — INI PAKAI totalCostSum yang sudah dihitung
//      SalesService dari cost_per_base_unit snapshot moving-average tiap
//      item (BUKAN dihitung ulang di sini), sama seperti VoidService membalik
//      stok pakai snapshot yang sama, bukan avg cost sekarang. PPN TIDAK
//      menyentuh jurnal HPP sama sekali (persediaan/HPP independen dari pajak).
// subtotal/discountTotal/ppnAmount/grandTotal/totalCost boleh Decimal atau
// angka biasa — semua dibungkus ulang lewat decimal.js di sini, tidak ada
// operator +/-/* JS biasa dipakai untuk uang.
async function postSaleJournals(conn, { saleId, saleNumber, entryDate, subtotal, discountTotal, ppnAmount = 0, ppnMode = null, grandTotal, totalCost, isCashPayment, createdBy }) {
  const subtotalDec = new Decimal(subtotal); // B — bruto, sebelum diskon
  const discountDec = new Decimal(discountTotal); // Dc — nilai wajar/face value, SAMA di semua kasus
  const ppnAmountDec = new Decimal(ppnAmount || 0);
  const grandTotalDec = new Decimal(grandTotal); // Kas/Bank yang benar2 diterima
  const totalCostDec = new Decimal(totalCost);

  let revenueEntry = null;
  // Jaga-jaga kasus ekstrem (mis. seluruh keranjang didiskon 100% jadi
  // grandTotal 0, atau subtotal 0) — tidak ada apa pun yang perlu dijurnal,
  // daripada memaksa posting baris bernilai nol yang ditolak AccountingService
  // dan bikin checkout yang tadinya sukses jadi gagal gara-gara jurnal.
  if (subtotalDec.gt(0)) {
    const lines = [];
    if (grandTotalDec.gt(0)) {
      const paymentAccount = await resolvePaymentAccount(conn, isCashPayment);
      lines.push({ accountId: paymentAccount.id, debit: grandTotalDec, description: 'Kas/Bank diterima' });
    }
    if (discountDec.gt(0)) {
      const returAccount = await AccountingService.getAccountByCode(ACCOUNT_CODES.RETUR_POTONGAN_PENJUALAN, conn);
      lines.push({ accountId: returAccount.id, debit: discountDec, description: 'Diskon penjualan' });
    }

    const penjualanAccount = await AccountingService.getAccountByCode(ACCOUNT_CODES.PENJUALAN, conn);
    if (ppnAmountDec.gt(0)) {
      const ppnAccount = await AccountingService.getAccountByCode(ACCOUNT_CODES.PPN_KELUARAN, conn);
      // exclude: B sudah tax-exclusive, dicatat apa adanya.
      // included: B mengandung PPN di dalamnya, WAJIB dikurangi dulu supaya
      // Penjualan yang dibukukan tetap pre-tax (lihat derivasi yang disetujui).
      const penjualanAmount = ppnMode === 'included' ? subtotalDec.minus(ppnAmountDec) : subtotalDec;
      if (penjualanAmount.gt(0)) lines.push({ accountId: penjualanAccount.id, credit: penjualanAmount, description: 'Penjualan (bruto)' });
      lines.push({ accountId: ppnAccount.id, credit: ppnAmountDec, description: 'PPN Keluaran' });
    } else {
      // PPN OFF — PERSIS perilaku sebelum Batch 3C, tidak berubah.
      lines.push({ accountId: penjualanAccount.id, credit: subtotalDec, description: 'Penjualan kotor' });
    }

    revenueEntry = await AccountingService.postJournalEntry(conn, {
      entryDate,
      description: `Penjualan ${saleNumber}`,
      sourceType: 'sale',
      sourceUuid: saleId,
      lines,
      createdBy,
    });
  }

  let cogsEntry = null;
  if (totalCostDec.gt(0)) {
    const hppAccount = await AccountingService.getAccountByCode(ACCOUNT_CODES.HPP, conn);
    const persediaanAccount = await AccountingService.getAccountByCode(ACCOUNT_CODES.PERSEDIAAN, conn);
    cogsEntry = await AccountingService.postJournalEntry(conn, {
      entryDate,
      description: `HPP Penjualan ${saleNumber}`,
      sourceType: 'sale',
      sourceUuid: saleId,
      lines: [
        { accountId: hppAccount.id, debit: totalCostDec, description: 'Harga pokok penjualan' },
        { accountId: persediaanAccount.id, credit: totalCostDec, description: 'Pengurangan persediaan' },
      ],
      createdBy,
    });
  }

  return { revenueEntry, cogsEntry };
}

// Dipanggil dari VoidService.voidSale, di dalam transaksi yang sama, SEBELUM
// conn.commit(). Membalik SEMUA jurnal 'posted' yang sourceType='sale' &
// sourceUuid=saleId (revenue + HPP, apa pun jumlahnya) — bukan menghapus,
// bukan mengedit, cuma menambah entry baru dgn debit/kredit tertukar plus
// menandai entry lama 'reversed' (lihat AccountingService.reverseJournalEntry).
async function reverseSaleJournals(conn, { saleId, saleNumber, entryDate, createdBy }) {
  const [entries] = await conn.query(
    `SELECT id FROM journal_entries WHERE source_type = 'sale' AND source_uuid = ? AND status = 'posted' ORDER BY created_at ASC`,
    [saleId]
  );

  const reversals = [];
  for (const entry of entries) {
    const reversal = await AccountingService.reverseJournalEntry(conn, {
      entryId: entry.id,
      entryDate,
      description: `Void Penjualan ${saleNumber}`,
      sourceType: 'void',
      sourceUuid: saleId,
      createdBy,
    });
    reversals.push(reversal);
  }
  return reversals;
}

// ============================================================================
// Invoice/Pesanan (channel 'order', OrderService) — beda dari kasir:
//  - Pendapatan diakui saat invoice dibuat, dgn lawan PIUTANG USAHA (bukan
//    Kas/Bank) — pembayaran dicatat terpisah (postOrderPaymentJournal), bisa
//    sekaligus atau bertahap. Invoice yang langsung lunas pun lewat jalur
//    yang sama (Piutang lalu langsung dilunasi) supaya satu pola saja.
//  - Ongkir yang ditagih ke pembeli = baris kredit Pendapatan Ongkos Kirim,
//    di luar DPP/PPN (lihat catatan di OrderService).
//  - HPP baris bonus/gratis didebit ke Beban Promosi, bukan HPP penjualan.
// sourceType tetap 'sale' utk jurnal pendapatan & HPP supaya
// reverseSaleJournals (void) otomatis ikut membaliknya.
// ============================================================================
const ORDER_ACCOUNT_CODES = {
  PIUTANG: '1-201',
  PENDAPATAN_DITERIMA_DIMUKA: '2-103',
  PENDAPATAN_ONGKIR: '4-203',
  BEBAN_PROMOSI: '5-208',
};

// deferredRevenue = nilai jual (subtotal setelah diskon item) baris INDENT —
// belum boleh diakui sbg Penjualan karena barangnya belum diserahkan;
// dikreditkan ke Pendapatan Diterima Dimuka dan dipindah ke Penjualan oleh
// postIndentFulfillmentJournal saat barangnya dikirim. Diskon total & PPN
// tetap diakui penuh di sini (disederhanakan).
async function postOrderJournals(conn, {
  saleId, label, entryDate, subtotal, discountTotal, ppnAmount = 0, ppnMode = null,
  grandTotal, shippingFee = 0, saleCost = 0, bonusCost = 0, deferredRevenue = 0, createdBy,
}) {
  const deferredDec = new Decimal(deferredRevenue || 0);
  const subtotalDec = new Decimal(subtotal);
  const discountDec = new Decimal(discountTotal);
  const ppnAmountDec = new Decimal(ppnAmount || 0);
  const grandTotalDec = new Decimal(grandTotal);
  const shippingDec = new Decimal(shippingFee || 0);
  const saleCostDec = new Decimal(saleCost || 0);
  const bonusCostDec = new Decimal(bonusCost || 0);
  const receivable = grandTotalDec.plus(shippingDec);

  let revenueEntry = null;
  if (receivable.gt(0) || discountDec.gt(0)) {
    const lines = [];
    if (receivable.gt(0)) {
      const piutang = await AccountingService.getAccountByCode(ORDER_ACCOUNT_CODES.PIUTANG, conn);
      lines.push({ accountId: piutang.id, debit: receivable, description: 'Piutang invoice' });
    }
    if (discountDec.gt(0)) {
      const returAccount = await AccountingService.getAccountByCode(ACCOUNT_CODES.RETUR_POTONGAN_PENJUALAN, conn);
      lines.push({ accountId: returAccount.id, debit: discountDec, description: 'Diskon penjualan' });
    }
    if (subtotalDec.gt(0)) {
      const penjualanAccount = await AccountingService.getAccountByCode(ACCOUNT_CODES.PENJUALAN, conn);
      let penjualanAmount = ppnAmountDec.gt(0) && ppnMode === 'included' ? subtotalDec.minus(ppnAmountDec) : subtotalDec;
      if (deferredDec.gt(0)) {
        if (deferredDec.gt(penjualanAmount)) {
          throw new HttpError(400, 'bad_request', 'Nilai barang indent melebihi nilai penjualan invoice');
        }
        penjualanAmount = penjualanAmount.minus(deferredDec);
        const dimuka = await AccountingService.getAccountByCode(ORDER_ACCOUNT_CODES.PENDAPATAN_DITERIMA_DIMUKA, conn);
        lines.push({ accountId: dimuka.id, credit: deferredDec, description: 'Penjualan barang indent (belum diserahkan)' });
      }
      if (penjualanAmount.gt(0)) {
        lines.push({ accountId: penjualanAccount.id, credit: penjualanAmount, description: ppnAmountDec.gt(0) ? 'Penjualan (bruto)' : 'Penjualan kotor' });
      }
      if (ppnAmountDec.gt(0)) {
        const ppnAccount = await AccountingService.getAccountByCode(ACCOUNT_CODES.PPN_KELUARAN, conn);
        lines.push({ accountId: ppnAccount.id, credit: ppnAmountDec, description: 'PPN Keluaran' });
      }
    }
    if (shippingDec.gt(0)) {
      const ongkirAccount = await AccountingService.getAccountByCode(ORDER_ACCOUNT_CODES.PENDAPATAN_ONGKIR, conn);
      lines.push({ accountId: ongkirAccount.id, credit: shippingDec, description: 'Ongkos kirim ditagih' });
    }
    revenueEntry = await AccountingService.postJournalEntry(conn, {
      entryDate,
      description: `Penjualan ${label}`,
      sourceType: 'sale',
      sourceUuid: saleId,
      lines,
      createdBy,
    });
  }

  let cogsEntry = null;
  const totalCost = saleCostDec.plus(bonusCostDec);
  if (totalCost.gt(0)) {
    const lines = [];
    if (saleCostDec.gt(0)) {
      const hppAccount = await AccountingService.getAccountByCode(ACCOUNT_CODES.HPP, conn);
      lines.push({ accountId: hppAccount.id, debit: saleCostDec, description: 'Harga pokok penjualan' });
    }
    if (bonusCostDec.gt(0)) {
      const promosiAccount = await AccountingService.getAccountByCode(ORDER_ACCOUNT_CODES.BEBAN_PROMOSI, conn);
      lines.push({ accountId: promosiAccount.id, debit: bonusCostDec, description: 'Barang bonus/gratis' });
    }
    const persediaanAccount = await AccountingService.getAccountByCode(ACCOUNT_CODES.PERSEDIAAN, conn);
    lines.push({ accountId: persediaanAccount.id, credit: totalCost, description: 'Pengurangan persediaan' });
    cogsEntry = await AccountingService.postJournalEntry(conn, {
      entryDate,
      description: `HPP Penjualan ${label}`,
      sourceType: 'sale',
      sourceUuid: saleId,
      lines,
      createdBy,
    });
  }

  return { revenueEntry, cogsEntry };
}

// Barang indent dikirim: pendapatan yang ditahan dipindah ke Penjualan, dan
// HPP (bonus -> Beban Promosi) diakui dari HPP berjalan saat itu.
// sourceType 'sale' supaya ikut dibalik kalau invoice di-void.
async function postIndentFulfillmentJournal(conn, { saleId, label, entryDate, revenue = 0, saleCost = 0, bonusCost = 0, createdBy }) {
  const revenueDec = new Decimal(revenue || 0);
  const saleCostDec = new Decimal(saleCost || 0);
  const bonusCostDec = new Decimal(bonusCost || 0);
  const lines = [];
  if (revenueDec.gt(0)) {
    const dimuka = await AccountingService.getAccountByCode(ORDER_ACCOUNT_CODES.PENDAPATAN_DITERIMA_DIMUKA, conn);
    const penjualan = await AccountingService.getAccountByCode(ACCOUNT_CODES.PENJUALAN, conn);
    lines.push({ accountId: dimuka.id, debit: revenueDec, description: 'Barang indent diserahkan' });
    lines.push({ accountId: penjualan.id, credit: revenueDec, description: 'Penjualan barang indent' });
  }
  const totalCost = saleCostDec.plus(bonusCostDec);
  if (totalCost.gt(0)) {
    if (saleCostDec.gt(0)) {
      const hpp = await AccountingService.getAccountByCode(ACCOUNT_CODES.HPP, conn);
      lines.push({ accountId: hpp.id, debit: saleCostDec, description: 'HPP barang indent' });
    }
    if (bonusCostDec.gt(0)) {
      const promosi = await AccountingService.getAccountByCode(ORDER_ACCOUNT_CODES.BEBAN_PROMOSI, conn);
      lines.push({ accountId: promosi.id, debit: bonusCostDec, description: 'Barang bonus indent' });
    }
    const persediaan = await AccountingService.getAccountByCode(ACCOUNT_CODES.PERSEDIAAN, conn);
    lines.push({ accountId: persediaan.id, credit: totalCost, description: 'Pengurangan persediaan' });
  }
  if (lines.length < 2) return null;
  return AccountingService.postJournalEntry(conn, {
    entryDate,
    description: `Pemenuhan indent ${label}`,
    sourceType: 'sale',
    sourceUuid: saleId,
    lines,
    createdBy,
  });
}

// Pembayaran invoice: Debit Kas/Bank, Kredit Piutang Usaha.
async function postOrderPaymentJournal(conn, { paymentId, label, entryDate, amount, isCashPayment, createdBy }) {
  const amountDec = new Decimal(amount);
  const paymentAccount = await resolvePaymentAccount(conn, isCashPayment);
  const piutang = await AccountingService.getAccountByCode(ORDER_ACCOUNT_CODES.PIUTANG, conn);
  return AccountingService.postJournalEntry(conn, {
    entryDate,
    description: `Pembayaran ${label}`,
    sourceType: 'sale_payment',
    sourceUuid: paymentId,
    lines: [
      { accountId: paymentAccount.id, debit: amountDec, description: 'Pembayaran diterima' },
      { accountId: piutang.id, credit: amountDec, description: 'Pelunasan piutang' },
    ],
    createdBy,
  });
}

async function reverseOrderPaymentJournal(conn, { paymentId, label, entryDate, createdBy }) {
  const [entries] = await conn.query(
    `SELECT id FROM journal_entries WHERE source_type = 'sale_payment' AND source_uuid = ? AND status = 'posted'`,
    [paymentId]
  );
  const reversals = [];
  for (const entry of entries) {
    reversals.push(await AccountingService.reverseJournalEntry(conn, {
      entryId: entry.id,
      entryDate,
      description: `Batal Pembayaran ${label}`,
      sourceType: 'sale_payment_void',
      sourceUuid: paymentId,
      createdBy,
    }));
  }
  return reversals;
}

module.exports = {
  postSaleJournals,
  reverseSaleJournals,
  postOrderJournals,
  postOrderPaymentJournal,
  postIndentFulfillmentJournal,
  reverseOrderPaymentJournal,
};
