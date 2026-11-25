// Data pelanggan DR's Secret. Tidak ada hard delete — pelanggan yang sudah
// tidak dipakai dinonaktifkan (is_active=0) supaya riwayat invoice lamanya
// tetap utuh. Alamat di sini = default; invoice menyimpan snapshot sendiri.
const { v4: uuidv4 } = require('uuid');
const Decimal = require('decimal.js');
const pool = require('../config/db');
const HttpError = require('../utils/HttpError');

const BRANCH_ID = 1;

// Kolom DATE dari mysql2 = objek Date tengah malam waktu LOKAL server —
// dikirim ke client sbg string YYYY-MM-DD supaya tidak bergeser sehari
// kalau zona waktu browser beda dari server.
function toDateStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clean(value, maxLen) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  if (maxLen && trimmed.length > maxLen) {
    throw new HttpError(400, 'bad_request', `Isian terlalu panjang (maks ${maxLen} karakter)`);
  }
  return trimmed;
}

// q mencocokkan nama/telepon/kota. Ringkasan belanja (jumlah invoice aktif,
// total belanja, sisa piutang) ikut dihitung supaya daftar langsung berguna.
async function listCustomers({ q, includeInactive = false, page = 1, limit = 50 } = {}) {
  const where = ['c.branch_id = ?'];
  const params = [BRANCH_ID];
  if (!includeInactive) where.push('c.is_active = 1');
  const trimmed = (q || '').trim();
  if (trimmed) {
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.city LIKE ?)');
    params.push(`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`);
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM customers c WHERE ${where.join(' AND ')}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT c.*,
            COALESCE(st.order_count, 0) AS order_count,
            COALESCE(st.total_spent, 0) AS total_spent,
            COALESCE(st.outstanding, 0) AS outstanding,
            st.last_order_date
     FROM customers c
     LEFT JOIN (
       SELECT customer_id,
              COUNT(*) AS order_count,
              SUM(total_due) AS total_spent,
              SUM(total_due - amount_paid) AS outstanding,
              MAX(invoice_date) AS last_order_date
       FROM sales
       WHERE status = 'completed' AND customer_id IS NOT NULL
       GROUP BY customer_id
     ) st ON st.customer_id = c.id
     WHERE ${where.join(' AND ')}
     ORDER BY c.name ASC
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, (safePage - 1) * safeLimit]
  );

  return {
    total: Number(countRow.total),
    page: safePage,
    limit: safeLimit,
    customers: rows.map(formatCustomer),
  };
}

function formatCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    city: row.city,
    address: row.address,
    notes: row.notes,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    orderCount: row.order_count !== undefined ? Number(row.order_count) : undefined,
    totalSpent: row.total_spent !== undefined ? new Decimal(row.total_spent).toFixed(0) : undefined,
    outstanding: row.outstanding !== undefined ? new Decimal(row.outstanding).toFixed(0) : undefined,
    lastOrderDate: toDateStr(row.last_order_date),
  };
}

async function getCustomerRow(id, conn = pool) {
  const [[row]] = await conn.query(`SELECT * FROM customers WHERE id = ? AND branch_id = ?`, [id, BRANCH_ID]);
  if (!row) throw new HttpError(404, 'customer_not_found', 'Pelanggan tidak ditemukan');
  return row;
}

// Detail + riwayat belanja (semua invoice termasuk yang di-void, ditandai)
// + produk yang paling sering dibeli.
async function getCustomerDetail(id) {
  const row = await getCustomerRow(id);

  const [orders] = await pool.query(
    `SELECT id, invoice_number, sale_number, invoice_date, created_at, status, total_due, amount_paid,
            payment_status, shipping_status, shipping_method, tracking_number
     FROM sales
     WHERE customer_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [id]
  );

  const [topProducts] = await pool.query(
    `SELECT p.id AS product_id, p.name AS product_name, u.name AS base_unit_name,
            SUM(si.quantity_base) AS qty_base, SUM(si.subtotal) AS amount
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     JOIN units u ON u.id = p.base_unit_id
     WHERE s.customer_id = ? AND s.status = 'completed' AND si.is_bonus = 0
     GROUP BY p.id, p.name, u.name
     ORDER BY qty_base DESC
     LIMIT 10`,
    [id]
  );

  let totalSpent = new Decimal(0);
  let outstanding = new Decimal(0);
  let orderCount = 0;
  for (const o of orders) {
    if (o.status !== 'completed') continue;
    orderCount += 1;
    totalSpent = totalSpent.plus(o.total_due);
    outstanding = outstanding.plus(new Decimal(o.total_due).minus(o.amount_paid));
  }

  return {
    ...formatCustomer(row),
    orderCount,
    totalSpent: totalSpent.toFixed(0),
    outstanding: outstanding.toFixed(0),
    orders: orders.map((o) => ({
      id: o.id,
      invoiceNumber: o.invoice_number,
      saleNumber: o.sale_number,
      invoiceDate: toDateStr(o.invoice_date),
      createdAt: o.created_at,
      status: o.status,
      totalDue: new Decimal(o.total_due).toFixed(0),
      amountPaid: new Decimal(o.amount_paid).toFixed(0),
      paymentStatus: o.payment_status,
      shippingStatus: o.shipping_status,
      shippingMethod: o.shipping_method,
      trackingNumber: o.tracking_number,
    })),
    topProducts: topProducts.map((p) => ({
      productId: p.product_id,
      productName: p.product_name,
      baseUnitName: p.base_unit_name,
      qtyBase: new Decimal(p.qty_base).toFixed(4),
      amount: new Decimal(p.amount).toFixed(0),
    })),
  };
}

async function createCustomer({ name, phone, city, address, notes, userId }) {
  const cleanName = clean(name, 100);
  if (!cleanName) throw new HttpError(400, 'bad_request', 'Nama pelanggan wajib diisi');
  const id = uuidv4();
  await pool.query(
    `INSERT INTO customers (id, branch_id, name, phone, city, address, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, BRANCH_ID, cleanName, clean(phone, 30) ?? null, clean(city, 100) ?? null, clean(address) ?? null, clean(notes) ?? null, userId]
  );
  return formatCustomer(await getCustomerRow(id));
}

// Partial update — field yang tidak dikirim (undefined) tidak diubah.
async function updateCustomer(id, { name, phone, city, address, notes, isActive }) {
  const current = await getCustomerRow(id);
  const next = {
    name: name !== undefined ? clean(name, 100) : current.name,
    phone: phone !== undefined ? clean(phone, 30) : current.phone,
    city: city !== undefined ? clean(city, 100) : current.city,
    address: address !== undefined ? clean(address) : current.address,
    notes: notes !== undefined ? clean(notes) : current.notes,
    isActive: isActive !== undefined ? (isActive ? 1 : 0) : current.is_active,
  };
  if (!next.name) throw new HttpError(400, 'bad_request', 'Nama pelanggan wajib diisi');
  await pool.query(
    `UPDATE customers SET name = ?, phone = ?, city = ?, address = ?, notes = ?, is_active = ? WHERE id = ?`,
    [next.name, next.phone, next.city, next.address, next.notes, next.isActive, id]
  );
  return formatCustomer(await getCustomerRow(id));
}

module.exports = { listCustomers, getCustomerDetail, getCustomerRow, createCustomer, updateCustomer };
