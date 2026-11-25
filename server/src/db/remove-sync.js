// Migrasi INKREMENTAL — membuang sisa fitur sinkronisasi ke pusat (warisan
// proyek asal; DR's Secret toko tunggal tanpa sync). Yang dihapus HANYA
// data teknis sync, bukan data bisnis:
//  - tabel sync_settings
//  - kolom sync_status di semua tabel (cuma penanda "sudah terkirim ke pusat")
//  - kolom store_settings.branch_code (identitas cabang utk sync)
//  - izin sync.view / sync.manage (+ pemberiannya ke role)
// Idempotent — aman dijalankan berkali-kali.
//
// Usage: node src/db/remove-sync.js
require('dotenv').config();
const pool = require('../config/db');

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`DROP TABLE IF EXISTS sync_settings`);
    console.log('sync_settings: dihapus (kalau ada)');

    const [cols] = await conn.query(
      `SELECT TABLE_NAME AS t FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'sync_status'`
    );
    for (const { t } of cols) {
      await conn.query(`ALTER TABLE \`${t}\` DROP COLUMN sync_status`);
      console.log(`  ${t}.sync_status: dihapus`);
    }
    if (cols.length === 0) console.log('kolom sync_status: tidak ada lagi');

    const [[bc]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_settings' AND COLUMN_NAME = 'branch_code'`
    );
    if (Number(bc.n) > 0) {
      await conn.query(`ALTER TABLE store_settings DROP COLUMN branch_code`);
      console.log('store_settings.branch_code: dihapus');
    }

    const [rp] = await conn.query(
      `DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.module = 'sync'`
    );
    const [perm] = await conn.query(`DELETE FROM permissions WHERE module = 'sync'`);
    console.log(`izin sync: ${perm.affectedRows} izin & ${rp.affectedRows} pemberian dihapus`);

    console.log('\nSelesai — data bisnis tidak tersentuh.');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migrasi gagal:', err);
  process.exit(1);
});
