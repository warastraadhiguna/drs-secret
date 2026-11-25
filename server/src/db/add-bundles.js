// Migrasi INKREMENTAL, AMAN dijalankan di database yang sudah berisi data
// sungguhan — cuma CREATE TABLE IF NOT EXISTS / ADD COLUMN kalau belum ada /
// INSERT IGNORE. Tidak ada DROP/TRUNCATE/DELETE. Idempotent.
//
// Fitur: Paket Promo (bundle) — tabel bundles & bundle_items, kolom paket +
// urutan baris di sale_items, izin bundles.view/create/edit (diberikan ke
// role 'admin').
//
// Usage: node src/db/add-bundles.js
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

const NEW_PERMISSIONS = [
  ['bundles', 'view', 'Lihat paket promo'],
  ['bundles', 'create', 'Tambah paket promo'],
  ['bundles', 'edit', 'Ubah isi/harga paket promo, nonaktifkan'],
];

const SALE_ITEM_COLUMNS = [
  ['line_no', 'INT NULL'],
  ['bundle_id', 'CHAR(36) NULL'],
  ['bundle_group', 'CHAR(36) NULL'],
  ['bundle_name', 'VARCHAR(150) NULL'],
  ['bundle_qty', 'DECIMAL(18,4) NULL'],
  ['bundle_price', 'INT NULL'],
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
    console.log('Membuat tabel bundles & bundle_items (kalau belum ada)...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bundles (
        id            CHAR(36)      NOT NULL PRIMARY KEY,
        code          VARCHAR(50)   NULL UNIQUE,
        name          VARCHAR(150)  NOT NULL,
        price         INT           NOT NULL,
        bv_points     DECIMAL(12,2) NULL,
        notes         TEXT          NULL,
        is_active     TINYINT(1)    NOT NULL DEFAULT 1,
        created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bundle_items (
        id            CHAR(36)      NOT NULL PRIMARY KEY,
        bundle_id     CHAR(36)      NOT NULL,
        product_id    CHAR(36)      NOT NULL,
        unit_id       CHAR(36)      NOT NULL,
        quantity      DECIMAL(18,4) NOT NULL,
        sort_order    INT           NOT NULL DEFAULT 0,
        CONSTRAINT fk_bundle_items_bundle FOREIGN KEY (bundle_id) REFERENCES bundles(id),
        CONSTRAINT fk_bundle_items_product FOREIGN KEY (product_id) REFERENCES products(id),
        CONSTRAINT fk_bundle_items_unit FOREIGN KEY (unit_id) REFERENCES units(id)
      ) ENGINE=InnoDB
    `);
    await conn.query(`CREATE INDEX idx_bundle_items_bundle ON bundle_items(bundle_id)`).catch((err) => {
      if (err.code !== 'ER_DUP_KEYNAME') throw err;
    });

    console.log('Menambah kolom paket & urutan baris di sale_items (kalau belum ada)...');
    for (const [column, definition] of SALE_ITEM_COLUMNS) {
      if (await columnExists(conn, 'sale_items', column)) {
        console.log(`  ${column}: sudah ada`);
      } else {
        await conn.query(`ALTER TABLE sale_items ADD COLUMN ${column} ${definition}`);
        console.log(`  ${column}: ditambahkan`);
      }
    }

    console.log('Menambah izin bundles.* & memberikannya ke role "admin"...');
    for (const [module, action, description] of NEW_PERMISSIONS) {
      await conn.query(
        `INSERT IGNORE INTO permissions (id, module, action, description, is_sensitive) VALUES (?, ?, ?, ?, 0)`,
        [uuidv4(), module, action, description]
      );
    }
    const [result] = await conn.query(`
      INSERT IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p
      WHERE r.name = 'admin' AND p.module = 'bundles'
    `);
    console.log(`  ${result.affectedRows} baris role_permissions ditambahkan.`);

    console.log('\nSelesai — tidak ada data lain yang tersentuh/terhapus.');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migrasi gagal:', err);
  process.exit(1);
});
