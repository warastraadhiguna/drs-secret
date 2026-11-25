// Migrasi INKREMENTAL, AMAN dijalankan di database yang sudah berisi data
// sungguhan — cuma ADD COLUMN kalau belum ada. Idempotent.
//
// Fitur: Pesanan Indent — kolom status pemenuhan per baris invoice
// (sale_items.fulfillment_status/fulfilled_at/fulfilled_by). Baris lama
// otomatis 'fulfilled' (default), jadi data yang sudah ada tidak berubah arti.
//
// Usage: node src/db/add-indent.js
require('dotenv').config();
const pool = require('../config/db');

const COLUMNS = [
  ['fulfillment_status', "VARCHAR(10) NOT NULL DEFAULT 'fulfilled'"],
  ['fulfilled_at', 'DATETIME NULL'],
  ['fulfilled_by', 'CHAR(36) NULL'],
];

async function run() {
  const conn = await pool.getConnection();
  try {
    for (const [column, definition] of COLUMNS) {
      const [[row]] = await conn.query(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_items' AND COLUMN_NAME = ?`,
        [column]
      );
      if (Number(row.n) > 0) {
        console.log(`  sale_items.${column}: sudah ada`);
      } else {
        await conn.query(`ALTER TABLE sale_items ADD COLUMN ${column} ${definition}`);
        console.log(`  sale_items.${column}: ditambahkan`);
      }
    }
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
