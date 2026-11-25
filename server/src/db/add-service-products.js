// Migrasi INKREMENTAL, AMAN dijalankan di database berisi data — cuma ADD
// COLUMN kalau belum ada. Idempotent.
//
// Fitur: produk jasa / non-stok — kolom products.is_service (default 0, jadi
// produk lama tetap barang biasa).
//
// Usage: node src/db/add-service-products.js
require('dotenv').config();
const pool = require('../config/db');

async function run() {
  const conn = await pool.getConnection();
  try {
    const [[row]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'is_service'`
    );
    if (Number(row.n) > 0) {
      console.log('products.is_service: sudah ada');
    } else {
      await conn.query(`ALTER TABLE products ADD COLUMN is_service TINYINT(1) NOT NULL DEFAULT 0 AFTER bv_points`);
      console.log('products.is_service: ditambahkan');
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
