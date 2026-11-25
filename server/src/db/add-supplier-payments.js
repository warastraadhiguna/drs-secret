// Migrasi INKREMENTAL, AMAN dijalankan di database yang sudah berisi data
// sungguhan — CREATE TABLE IF NOT EXISTS / ADD COLUMN kalau belum ada /
// INSERT IGNORE. Tidak ada DROP/DELETE. Idempotent.
//
// Fitur: Pembayaran utang ke supplier — kolom purchases.due_date/
// amount_paid/payment_status, tabel supplier_payments, izin
// supplier_payments.view/create/void (diberikan ke role 'admin').
// Backfill (HANYA saat kolom payment_status baru ditambahkan): pembelian
// tunai -> 'paid' (amount_paid = grand_total), pembelian kredit -> 'unpaid'.
//
// Usage: node src/db/add-supplier-payments.js
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

const NEW_PERMISSIONS = [
  ['supplier_payments', 'view', 'Lihat utang supplier & riwayat pelunasan'],
  ['supplier_payments', 'create', 'Catat pelunasan utang ke supplier'],
  ['supplier_payments', 'void', 'Batalkan pelunasan utang supplier — sensitif', 1],
];

async function columnExists(conn, table, column) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row.n) > 0;
}

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (!(await columnExists(conn, 'purchases', 'due_date'))) {
      await conn.query(`ALTER TABLE purchases ADD COLUMN due_date DATE NULL AFTER grand_total`);
      console.log('purchases.due_date: ditambahkan');
    }
    if (!(await columnExists(conn, 'purchases', 'amount_paid'))) {
      await conn.query(`ALTER TABLE purchases ADD COLUMN amount_paid INT NOT NULL DEFAULT 0 AFTER due_date`);
      console.log('purchases.amount_paid: ditambahkan');
    }
    if (!(await columnExists(conn, 'purchases', 'payment_status'))) {
      await conn.query(`ALTER TABLE purchases ADD COLUMN payment_status VARCHAR(10) NOT NULL DEFAULT 'paid' AFTER amount_paid`);
      const [cash] = await conn.query(
        `UPDATE purchases p JOIN purchase_payments pp ON pp.purchase_id = p.id
         SET p.payment_status = 'paid', p.amount_paid = p.grand_total WHERE pp.payment_type = 'cash'`
      );
      const [credit] = await conn.query(
        `UPDATE purchases p JOIN purchase_payments pp ON pp.purchase_id = p.id
         SET p.payment_status = 'unpaid', p.amount_paid = 0 WHERE pp.payment_type = 'credit'`
      );
      console.log(`purchases.payment_status: ditambahkan (backfill ${cash.affectedRows} tunai, ${credit.affectedRows} kredit)`);
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS supplier_payments (
        id              CHAR(36)     NOT NULL PRIMARY KEY,
        branch_id       INT          NOT NULL DEFAULT 1,
        supplier_id     CHAR(36)     NOT NULL,
        purchase_id     CHAR(36)     NOT NULL,
        payment_date    DATE         NOT NULL,
        method          VARCHAR(20)  NOT NULL,
        amount          INT          NOT NULL,
        notes           VARCHAR(255) NULL,
        status          VARCHAR(10)  NOT NULL DEFAULT 'active',
        created_by      CHAR(36)     NOT NULL,
        created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        voided_at       DATETIME     NULL,
        voided_by       CHAR(36)     NULL,
        void_reason     VARCHAR(255) NULL,
        CONSTRAINT fk_supplier_payments_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        CONSTRAINT fk_supplier_payments_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
        CONSTRAINT fk_supplier_payments_user FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
    for (const [name, col] of [['idx_supplier_payments_purchase', 'purchase_id'], ['idx_supplier_payments_supplier', 'supplier_id']]) {
      await conn.query(`CREATE INDEX ${name} ON supplier_payments(${col})`).catch((err) => {
        if (err.code !== 'ER_DUP_KEYNAME') throw err;
      });
    }
    console.log('supplier_payments: siap');

    for (const [module, action, description, sensitive] of NEW_PERMISSIONS) {
      await conn.query(
        `INSERT IGNORE INTO permissions (id, module, action, description, is_sensitive) VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), module, action, description, sensitive ? 1 : 0]
      );
    }
    const [result] = await conn.query(`
      INSERT IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p
      WHERE r.name = 'admin' AND p.module = 'supplier_payments'
    `);
    console.log(`izin supplier_payments.*: ${result.affectedRows} baris role_permissions ditambahkan`);

    await conn.commit();
    console.log('\nSelesai — tidak ada data lain yang tersentuh/terhapus.');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migrasi gagal:', err);
  process.exit(1);
});
