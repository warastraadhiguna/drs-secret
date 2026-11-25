// Laporan read-only — TIDAK PERNAH menulis apa pun, cuma agregasi SUM() dari
// data yang sudah ada. Transaksi voided (status != 'completed') selalu
// dikecualikan di WHERE clause, bukan difilter belakangan.
//
// Setiap SUM()/COUNT() dari MySQL WAJIB dibungkus decimal.js sebelum dipakai
// operasi apa pun (termasuk .toFixed() format) — driver mysql2 mengembalikan
// DECIMAL dan BIGINT hasil agregat sebagai string, dan pernah ada bug nyata
// (ShiftService.calculateExpectedCash) gara-gara ini dijumlah pakai `+` JS
// biasa tanpa dibungkus dulu, jadi string concatenation. Lihat catatan
// Bagian 5 di MVP_Blueprint_POS_1_Cabang.md.
const Decimal = require('decimal.js');
const pool = require('../config/db');
const HttpError = require('../utils/HttpError');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

async function getDailySalesReport(startDate, endDate) {
  if (!startDate || !DATE_REGEX.test(startDate)) {
    throw new HttpError(400, 'bad_request', 'Parameter startDate wajib diisi, format YYYY-MM-DD');
  }
  if (!endDate || !DATE_REGEX.test(endDate)) {
    throw new HttpError(400, 'bad_request', 'Parameter endDate wajib diisi, format YYYY-MM-DD');
  }
  if (endDate < startDate) {
    throw new HttpError(400, 'bad_request', 'endDate tidak boleh sebelum startDate');
  }

  const [[summaryRow]] = await pool.query(
    `SELECT
       COUNT(*) AS transaction_count,
       COALESCE(SUM(grand_total), 0) AS total_omzet,
       COALESCE(SUM(total_cost), 0) AS total_hpp,
       COALESCE(SUM(gross_profit), 0) AS total_gross_profit
     FROM sales
     WHERE DATE(created_at) BETWEEN ? AND ? AND status = 'completed'`,
    [startDate, endDate]
  );

  const [productRows] = await pool.query(
    `SELECT
       si.product_id,
       p.name AS product_name,
       u.name AS base_unit_name,
       COALESCE(SUM(si.quantity_base), 0) AS qty_sold_base,
       COALESCE(SUM(si.subtotal), 0) AS subtotal,
       COALESCE(SUM(si.total_cost), 0) AS total_cost,
       COALESCE(SUM(si.gross_profit), 0) AS gross_profit
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     JOIN units u ON u.id = p.base_unit_id
     WHERE DATE(s.created_at) BETWEEN ? AND ? AND s.status = 'completed'
     GROUP BY si.product_id, p.name, u.name
     ORDER BY p.name`,
    [startDate, endDate]
  );

  return {
    startDate,
    endDate,
    transactionCount: Number(summaryRow.transaction_count),
    totalOmzet: new Decimal(summaryRow.total_omzet).toFixed(0),
    totalHpp: new Decimal(summaryRow.total_hpp).toFixed(4),
    totalGrossProfit: new Decimal(summaryRow.total_gross_profit).toFixed(4),
    products: productRows.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      baseUnitName: row.base_unit_name,
      qtySoldBase: new Decimal(row.qty_sold_base).toFixed(4),
      subtotal: new Decimal(row.subtotal).toFixed(0),
      totalCost: new Decimal(row.total_cost).toFixed(4),
      grossProfit: new Decimal(row.gross_profit).toFixed(4),
    })),
  };
}

// Daftar nota (transaksi) dalam rentang tanggal — dipakai "Laporan Transaksi"
// di admin. Beda dari getDailySalesReport: ini daftar per-nota (termasuk yang
// voided, ditandai statusnya), bukan agregat per-produk. Detail lengkap satu
// nota (item, PPN, pembayaran) diambil lewat endpoint terpisah GET /api/sales/:id
// (SalesService.getSaleDetail) — sudah ada, dipakai juga oleh kasir utk cetak ulang.
async function getTransactionsReport(startDate, endDate) {
  if (!startDate || !DATE_REGEX.test(startDate)) {
    throw new HttpError(400, 'bad_request', 'Parameter startDate wajib diisi, format YYYY-MM-DD');
  }
  if (!endDate || !DATE_REGEX.test(endDate)) {
    throw new HttpError(400, 'bad_request', 'Parameter endDate wajib diisi, format YYYY-MM-DD');
  }
  if (endDate < startDate) {
    throw new HttpError(400, 'bad_request', 'endDate tidak boleh sebelum startDate');
  }

  const [rows] = await pool.query(
    `SELECT
       s.id, s.sale_number, s.created_at, s.status, s.grand_total, s.channel, s.payment_status, s.customer_name,
       u.full_name AS cashier_name,
       (SELECT sp.payment_method_name FROM sale_payments sp
        WHERE sp.sale_id = s.id AND sp.status = 'active' ORDER BY sp.created_at ASC LIMIT 1) AS payment_method_name
     FROM sales s
     JOIN users u ON u.id = s.user_id
     WHERE DATE(s.created_at) BETWEEN ? AND ?
     ORDER BY s.created_at DESC`,
    [startDate, endDate]
  );

  const [[summaryRow]] = await pool.query(
    `SELECT
       COUNT(*) AS transaction_count,
       SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END) AS voided_count,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN grand_total ELSE 0 END), 0) AS total_omzet
     FROM sales
     WHERE DATE(created_at) BETWEEN ? AND ?`,
    [startDate, endDate]
  );

  return {
    startDate,
    endDate,
    transactionCount: Number(summaryRow.transaction_count),
    voidedCount: Number(summaryRow.voided_count),
    totalOmzet: new Decimal(summaryRow.total_omzet).toFixed(0),
    transactions: rows.map((row) => ({
      id: row.id,
      saleNumber: row.sale_number,
      createdAt: row.created_at,
      status: row.status,
      grandTotal: new Decimal(row.grand_total).toFixed(0),
      cashierName: row.cashier_name,
      // Invoice (channel 'order') bisa belum dibayar — jangan jatuh ke 'Tunai'.
      paymentMethodName: row.channel === 'order'
        ? `${row.payment_method_name || '-'} (${({ unpaid: 'belum bayar', partial: 'sebagian', paid: 'lunas' })[row.payment_status] || row.payment_status})`
        : row.payment_method_name || 'Tunai',
      customerName: row.customer_name,
    })),
  };
}

// Rekap poin BV (konsep MLM BWL) dari invoice (channel 'order') yang tidak
// di-void, menurut TANGGAL INVOICE. BV = snapshot sale_items.bv_points saat
// invoice dibuat (baris bonus BV-nya 0). Baris indent yang belum dikirim
// tetap dihitung di tanggal invoice-nya — ditandai terpisah (pendingBv)
// supaya bisa dicocokkan kalau pusat menghitung BV saat barang dikirim.
async function getBvRecap(startDate, endDate) {
  if (!startDate || !DATE_REGEX.test(startDate) || !endDate || !DATE_REGEX.test(endDate)) {
    throw new HttpError(400, 'bad_request', 'startDate & endDate wajib diisi, format YYYY-MM-DD');
  }
  if (endDate < startDate) throw new HttpError(400, 'bad_request', 'endDate tidak boleh sebelum startDate');

  const base = `FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.channel = 'order' AND s.status = 'completed' AND s.invoice_date BETWEEN ? AND ?`;
  const params = [startDate, endDate];

  const [[totals]] = await pool.query(
    `SELECT COALESCE(SUM(si.bv_points), 0) AS bv,
            COALESCE(SUM(CASE WHEN si.fulfillment_status = 'pending' THEN si.bv_points ELSE 0 END), 0) AS pending_bv,
            COUNT(DISTINCT s.id) AS invoice_count,
            COALESCE(SUM(si.subtotal), 0) AS goods_value
     ${base}`,
    params
  );
  const [byMonth] = await pool.query(
    `SELECT DATE_FORMAT(s.invoice_date, '%Y-%m') AS month,
            SUM(si.bv_points) AS bv, COUNT(DISTINCT s.id) AS invoice_count, SUM(si.subtotal) AS goods_value
     ${base} GROUP BY month ORDER BY month`,
    params
  );
  const [byCustomer] = await pool.query(
    `SELECT s.customer_id, MAX(s.customer_name) AS customer_name, MAX(s.customer_city) AS customer_city,
            SUM(si.bv_points) AS bv, COUNT(DISTINCT s.id) AS invoice_count, SUM(si.subtotal) AS goods_value
     ${base} GROUP BY s.customer_id ORDER BY bv DESC`,
    params
  );
  const [byProduct] = await pool.query(
    `SELECT p.id AS product_id, p.name AS product_name, p.sku, u.name AS base_unit_name,
            SUM(si.quantity_base) AS qty_base, SUM(si.bv_points) AS bv, SUM(si.subtotal) AS goods_value
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     JOIN products p ON p.id = si.product_id JOIN units u ON u.id = p.base_unit_id
     WHERE s.channel = 'order' AND s.status = 'completed' AND s.invoice_date BETWEEN ? AND ? AND si.is_bonus = 0
     GROUP BY p.id, p.name, p.sku, u.name ORDER BY bv DESC, p.name`,
    params
  );
  const bv = (v) => new Decimal(v || 0).toFixed(2);
  const rp = (v) => new Decimal(v || 0).toFixed(0);
  return {
    startDate,
    endDate,
    totalBv: bv(totals.bv),
    pendingBv: bv(totals.pending_bv),
    invoiceCount: Number(totals.invoice_count),
    goodsValue: rp(totals.goods_value),
    months: byMonth.map((r) => ({ month: r.month, bv: bv(r.bv), invoiceCount: Number(r.invoice_count), goodsValue: rp(r.goods_value) })),
    customers: byCustomer.map((r) => ({
      customerId: r.customer_id, customerName: r.customer_name, customerCity: r.customer_city,
      bv: bv(r.bv), invoiceCount: Number(r.invoice_count), goodsValue: rp(r.goods_value),
    })),
    products: byProduct.map((r) => ({
      productId: r.product_id, productName: r.product_name, sku: r.sku, baseUnitName: r.base_unit_name,
      qtyBase: new Decimal(r.qty_base || 0).toFixed(4), bv: bv(r.bv), goodsValue: rp(r.goods_value),
    })),
  };
}

module.exports = { getDailySalesReport, getTransactionsReport, getBvRecap };
