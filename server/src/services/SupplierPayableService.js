// Utang ke supplier & pelunasannya (menu Pembelian > Utang Supplier).
// Utang lahir dari pembelian KREDIT (PurchaseService: Kredit Utang Usaha
// 2-101). Pelunasan dicatat per nota, boleh bertahap:
//  - 'cash' / 'bank'   : Debit Utang Usaha / Kredit Kas (1-101) / Bank (1-102).
//  - 'return_credit'   : pakai saldo retur pembelian KREDIT ke supplier yang
//                        sama. Utangnya sudah berkurang saat retur dicatat
//                        (PurchaseReturnService: Debit Utang Usaha), jadi di
//                        sini TANPA jurnal — cuma alokasi ke nota supaya
//                        status lunasnya benar.
// Saldo akun Utang Usaha = Σ sisa utang per nota − saldo retur kredit yang
// belum dipakai.
const { v4: uuidv4 } = require('uuid');
const Decimal = require('decimal.js');
const pool = require('../config/db');
const HttpError = require('../utils/HttpError');
const AccountingService = require('./AccountingService');
const { logActivity } = require('./AuthService');

const BRANCH_ID = 1;
const UTANG_USAHA_CODE = '2-101';
const METHOD_ACCOUNT = { cash: '1-101', bank: '1-102' };
const METHODS = ['cash', 'bank', 'return_credit'];
const METHOD_LABEL = { cash: 'Kas (tunai)', bank: 'Bank (transfer)', return_credit: 'Potong saldo retur' };
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function toDateStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayLocal() {
  return toDateStr(new Date());
}

function computeStatus(total, paid) {
  const t = new Decimal(total);
  const p = new Decimal(paid);
  if (p.gte(t)) return 'paid';
  if (p.gt(0)) return 'partial';
  return 'unpaid';
}

// Saldo retur kredit yang belum dipakai melunasi nota, per supplier.
async function getReturnCredit(conn, supplierId) {
  const [[ret]] = await conn.query(
    `SELECT COALESCE(SUM(grand_total), 0) AS total FROM purchase_returns WHERE supplier_id = ? AND payment_type = 'credit'`,
    [supplierId]
  );
  const [[used]] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments
     WHERE supplier_id = ? AND method = 'return_credit' AND status = 'active'`,
    [supplierId]
  );
  return Decimal.max(new Decimal(ret.total).minus(used.total), 0);
}

// Ringkasan per supplier yang punya utang/saldo retur.
async function getSummary() {
  const [rows] = await pool.query(
    `SELECT s.id, s.name,
            COALESCE(SUM(CASE WHEN p.status = 'completed' AND p.payment_status <> 'paid' THEN p.grand_total - p.amount_paid ELSE 0 END), 0) AS outstanding,
            COALESCE(SUM(CASE WHEN p.status = 'completed' AND p.payment_status <> 'paid' THEN 1 ELSE 0 END), 0) AS open_count,
            MIN(CASE WHEN p.status = 'completed' AND p.payment_status <> 'paid' THEN p.due_date END) AS nearest_due
     FROM suppliers s
     LEFT JOIN purchases p ON p.supplier_id = s.id
     GROUP BY s.id, s.name`
  );
  const suppliers = [];
  let totalOutstanding = new Decimal(0);
  let totalReturnCredit = new Decimal(0);
  for (const r of rows) {
    const returnCredit = await getReturnCredit(pool, r.id);
    const outstanding = new Decimal(r.outstanding);
    if (outstanding.lte(0) && returnCredit.lte(0)) continue;
    totalOutstanding = totalOutstanding.plus(outstanding);
    totalReturnCredit = totalReturnCredit.plus(returnCredit);
    suppliers.push({
      supplierId: r.id,
      supplierName: r.name,
      outstanding: outstanding.toFixed(0),
      openCount: Number(r.open_count),
      nearestDue: toDateStr(r.nearest_due),
      returnCredit: returnCredit.toFixed(0),
      net: outstanding.minus(returnCredit).toFixed(0),
    });
  }
  suppliers.sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
  return {
    totalOutstanding: totalOutstanding.toFixed(0),
    totalReturnCredit: totalReturnCredit.toFixed(0),
    totalNet: totalOutstanding.minus(totalReturnCredit).toFixed(0),
    suppliers,
  };
}

// Daftar nota pembelian kredit. status: 'outstanding' (default) | 'all'.
async function listPayablePurchases({ supplierId, status = 'outstanding' } = {}) {
  const where = [`p.status = 'completed'`, `pp.payment_type = 'credit'`];
  const params = [];
  if (status === 'outstanding') where.push(`p.payment_status <> 'paid'`);
  if (supplierId) {
    where.push('p.supplier_id = ?');
    params.push(supplierId);
  }
  const [rows] = await pool.query(
    `SELECT p.id, p.purchase_number, p.purchase_date, p.due_date, p.grand_total, p.amount_paid, p.payment_status, p.notes,
            s.id AS supplier_id, s.name AS supplier_name
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id
     JOIN purchase_payments pp ON pp.purchase_id = p.id
     WHERE ${where.join(' AND ')}
     ORDER BY (p.due_date IS NULL), p.due_date ASC, p.purchase_date ASC
     LIMIT 500`,
    params
  );
  const today = todayLocal();
  return rows.map((r) => {
    const dueDate = toDateStr(r.due_date);
    return {
      id: r.id,
      purchaseNumber: r.purchase_number,
      purchaseDate: toDateStr(r.purchase_date),
      dueDate,
      overdue: !!dueDate && r.payment_status !== 'paid' && dueDate < today,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      grandTotal: new Decimal(r.grand_total).toFixed(0),
      amountPaid: new Decimal(r.amount_paid).toFixed(0),
      outstanding: new Decimal(r.grand_total).minus(r.amount_paid).toFixed(0),
      paymentStatus: r.payment_status,
      notes: r.notes,
    };
  });
}

async function getPurchasePayable(purchaseId) {
  const [[p]] = await pool.query(
    `SELECT p.*, s.name AS supplier_name, pp.payment_type
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN purchase_payments pp ON pp.purchase_id = p.id
     WHERE p.id = ?`,
    [purchaseId]
  );
  if (!p) throw new HttpError(404, 'purchase_not_found', 'Pembelian tidak ditemukan');
  const [payments] = await pool.query(
    `SELECT sp.*, cu.full_name AS created_by_name, vu.full_name AS voided_by_name
     FROM supplier_payments sp
     JOIN users cu ON cu.id = sp.created_by
     LEFT JOIN users vu ON vu.id = sp.voided_by
     WHERE sp.purchase_id = ? ORDER BY sp.created_at ASC`,
    [purchaseId]
  );
  return {
    id: p.id,
    purchaseNumber: p.purchase_number,
    purchaseDate: toDateStr(p.purchase_date),
    dueDate: toDateStr(p.due_date),
    supplierId: p.supplier_id,
    supplierName: p.supplier_name,
    paymentType: p.payment_type,
    status: p.status,
    grandTotal: new Decimal(p.grand_total).toFixed(0),
    amountPaid: new Decimal(p.amount_paid).toFixed(0),
    outstanding: new Decimal(p.grand_total).minus(p.amount_paid).toFixed(0),
    paymentStatus: p.payment_status,
    returnCreditAvailable: (await getReturnCredit(pool, p.supplier_id)).toFixed(0),
    payments: payments.map((x) => ({
      id: x.id,
      paymentDate: toDateStr(x.payment_date),
      method: x.method,
      methodLabel: METHOD_LABEL[x.method] || x.method,
      amount: new Decimal(x.amount).toFixed(0),
      notes: x.notes,
      status: x.status,
      createdByName: x.created_by_name,
      createdAt: x.created_at,
      voidedByName: x.voided_by_name,
      voidedAt: x.voided_at,
      voidReason: x.void_reason,
    })),
  };
}

async function recordPayment({ purchaseId, paymentDate, method, amount, notes, userId }) {
  const date = paymentDate || todayLocal();
  if (!DATE_REGEX.test(date)) throw new HttpError(400, 'bad_request', 'Tanggal bayar wajib format YYYY-MM-DD');
  if (!METHODS.includes(method)) throw new HttpError(400, 'bad_request', `Cara bayar harus salah satu dari: ${METHODS.join(', ')}`);
  const amountDec = new Decimal(amount || 0);
  if (!amountDec.isInteger() || amountDec.lte(0)) throw new HttpError(400, 'bad_request', 'Jumlah bayar harus rupiah bulat > 0');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query(
      `SELECT p.*, pp.payment_type FROM purchases p LEFT JOIN purchase_payments pp ON pp.purchase_id = p.id
       WHERE p.id = ? FOR UPDATE`,
      [purchaseId]
    );
    if (!p) throw new HttpError(404, 'purchase_not_found', 'Pembelian tidak ditemukan');
    if (p.status !== 'completed') throw new HttpError(409, 'purchase_voided', 'Pembelian ini sudah di-void');
    if (p.payment_type !== 'credit') throw new HttpError(409, 'not_credit', 'Pembelian ini tunai — tidak ada utang');
    const remaining = new Decimal(p.grand_total).minus(p.amount_paid);
    if (amountDec.gt(remaining)) {
      throw new HttpError(400, 'overpayment', `Jumlah bayar melebihi sisa utang nota ini (sisa Rp${remaining.toFixed(0)})`);
    }
    if (method === 'return_credit') {
      // Kunci baris supplier supaya dua pelunasan bersamaan tidak memakai
      // saldo retur yang sama dua kali.
      await conn.query(`SELECT id FROM suppliers WHERE id = ? FOR UPDATE`, [p.supplier_id]);
      const available = await getReturnCredit(conn, p.supplier_id);
      if (amountDec.gt(available)) {
        throw new HttpError(400, 'insufficient_return_credit', `Saldo retur ke supplier ini tinggal Rp${available.toFixed(0)}`);
      }
    }

    const paymentId = uuidv4();
    await conn.query(
      `INSERT INTO supplier_payments (id, branch_id, supplier_id, purchase_id, payment_date, method, amount, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [paymentId, BRANCH_ID, p.supplier_id, purchaseId, date, method, amountDec.toFixed(0), (notes || '').trim().slice(0, 255) || null, userId]
    );
    const newPaid = new Decimal(p.amount_paid).plus(amountDec);
    await conn.query(
      `UPDATE purchases SET amount_paid = ?, payment_status = ? WHERE id = ?`,
      [newPaid.toFixed(0), computeStatus(p.grand_total, newPaid), purchaseId]
    );

    if (method !== 'return_credit') {
      const utang = await AccountingService.getAccountByCode(UTANG_USAHA_CODE, conn);
      const kasBank = await AccountingService.getAccountByCode(METHOD_ACCOUNT[method], conn);
      await AccountingService.postJournalEntry(conn, {
        entryDate: date,
        description: `Pelunasan utang ${p.purchase_number}`,
        sourceType: 'supplier_payment',
        sourceUuid: paymentId,
        lines: [
          { accountId: utang.id, debit: amountDec, description: 'Utang usaha dibayar' },
          { accountId: kasBank.id, credit: amountDec, description: method === 'cash' ? 'Dibayar tunai' : 'Dibayar transfer' },
        ],
        createdBy: userId,
      });
    }
    await logActivity(conn, {
      userId,
      action: 'supplier_payment',
      entityType: 'purchase',
      entityUuid: purchaseId,
      description: `Pelunasan utang ${p.purchase_number} Rp${amountDec.toFixed(0)} via ${METHOD_LABEL[method]} (${date})`,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return getPurchasePayable(purchaseId);
}

async function voidPayment({ paymentId, reason, userId }) {
  const trimmed = (reason || '').trim();
  if (!trimmed) throw new HttpError(400, 'bad_request', 'Alasan pembatalan wajib diisi');
  let purchaseId;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[pay]] = await conn.query(`SELECT * FROM supplier_payments WHERE id = ? FOR UPDATE`, [paymentId]);
    if (!pay) throw new HttpError(404, 'payment_not_found', 'Pelunasan tidak ditemukan');
    if (pay.status !== 'active') throw new HttpError(409, 'payment_voided', 'Pelunasan ini sudah dibatalkan');
    purchaseId = pay.purchase_id;
    const [[p]] = await conn.query(`SELECT * FROM purchases WHERE id = ? FOR UPDATE`, [purchaseId]);

    await conn.query(
      `UPDATE supplier_payments SET status = 'voided', voided_at = NOW(), voided_by = ?, void_reason = ? WHERE id = ?`,
      [userId, trimmed.slice(0, 255), paymentId]
    );
    const newPaid = Decimal.max(new Decimal(p.amount_paid).minus(pay.amount), 0);
    await conn.query(
      `UPDATE purchases SET amount_paid = ?, payment_status = ? WHERE id = ?`,
      [newPaid.toFixed(0), computeStatus(p.grand_total, newPaid), purchaseId]
    );
    const [entries] = await conn.query(
      `SELECT id FROM journal_entries WHERE source_type = 'supplier_payment' AND source_uuid = ? AND status = 'posted'`,
      [paymentId]
    );
    for (const e of entries) {
      await AccountingService.reverseJournalEntry(conn, {
        entryId: e.id,
        entryDate: todayLocal(),
        description: `Batal pelunasan utang ${p.purchase_number}`,
        sourceType: 'supplier_payment_void',
        sourceUuid: paymentId,
        createdBy: userId,
      });
    }
    await logActivity(conn, {
      userId,
      action: 'void_supplier_payment',
      entityType: 'purchase',
      entityUuid: purchaseId,
      description: `Batal pelunasan utang ${p.purchase_number} Rp${pay.amount}. Alasan: ${trimmed}`,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return getPurchasePayable(purchaseId);
}

module.exports = { getSummary, listPayablePurchases, getPurchasePayable, recordPayment, voidPayment };
