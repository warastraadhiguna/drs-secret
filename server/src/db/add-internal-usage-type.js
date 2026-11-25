// Migrasi INKREMENTAL, AMAN dijalankan di database yang sudah berisi data
// sungguhan — cuma ADD COLUMN kalau belum ada. Idempotent.
//
// Fitur: Prive barang — kolom internal_stock_usages.usage_type
// ('supplies' | 'owner_draw' | 'promotion'). Data lama otomatis 'supplies'
// (= perilaku lama, jurnal ke Beban Perlengkapan Toko), jadi tidak berubah arti.
//
// Usage: node src/db/add-internal-usage-type.js
require('dotenv').config();
const pool = require('../config/db');

async function run() {
  const conn = await pool.getConnection();
  try {
    const [[row]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'internal_stock_usages' AND COLUMN_NAME = 'usage_type'`
    );
    if (Number(row.n) > 0) {
      console.log('internal_stock_usages.usage_type: sudah ada');
    } else {
      await conn.query(
        `ALTER TABLE internal_stock_usages ADD COLUMN usage_type VARCHAR(20) NOT NULL DEFAULT 'supplies' AFTER usage_date`
      );
      console.log('internal_stock_usages.usage_type: ditambahkan');
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
