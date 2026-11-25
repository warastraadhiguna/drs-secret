// Menjalankan schema.sql terhadap MySQL server yang dikonfigurasi di .env.
// Dipisah dari pool utama karena butuh multipleStatements: true.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// schema.sql berisi DROP TABLE utk semua tabel — nama DB WAJIB dari .env
// (placeholder __DB_NAME__), dan pos_branch (DB toko POS lama yang ada di
// komputer yang sama) ditolak mentah-mentah supaya tidak pernah terhapus.
const FORBIDDEN_DB_NAMES = ['pos_branch'];

async function migrate() {
  const dbName = process.env.DB_NAME;
  if (!dbName || !/^[A-Za-z0-9_]+$/.test(dbName)) {
    throw new Error('DB_NAME di .env wajib diisi (huruf/angka/underscore saja)');
  }
  if (FORBIDDEN_DB_NAMES.includes(dbName.toLowerCase())) {
    throw new Error(`DB_NAME=${dbName} ditolak — itu database toko POS lama, migrasi akan menghapus seluruh datanya`);
  }
  const schemaSql = fs
    .readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    .replaceAll('__DB_NAME__', dbName);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  try {
    // Pengaman data asli: schema.sql men-DROP semua tabel. Kalau database ini
    // SUDAH berisi transaksi/produk, tolak — kecuali MIGRATE_FORCE=1 diset
    // sadar (mis. reset DB uji). Perubahan skema di DB berisi data WAJIB lewat
    // skrip src/db/add-*.js (lihat npm run db:upgrade).
    const [[existing]] = await connection.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('sales','products','purchases')`,
      [dbName]
    );
    if (Number(existing.n) > 0 && process.env.MIGRATE_FORCE !== '1') {
      const [[cnt]] = await connection.query(
        // dbName sudah divalidasi /^[A-Za-z0-9_]+$/ di atas — aman disisipkan.
        `SELECT (SELECT COUNT(*) FROM ${dbName}.sales) + (SELECT COUNT(*) FROM ${dbName}.products) + (SELECT COUNT(*) FROM ${dbName}.purchases) AS n`
      );
      if (Number(cnt.n) > 0) {
        throw new Error(`Database ${dbName} sudah berisi data (${cnt.n} baris penjualan/produk/pembelian) — db:migrate DIBATALKAN karena akan menghapus semuanya. Pakai "npm run db:upgrade" utk perubahan skema. (Reset sengaja: MIGRATE_FORCE=1)`);
      }
    }
    console.log('Menjalankan schema.sql ...');
    await connection.query(schemaSql);
    console.log('Schema berhasil dibuat/diperbarui.');
  } finally {
    await connection.end();
  }
}

migrate().catch((err) => {
  console.error('Migrasi gagal:', err);
  process.exit(1);
});
