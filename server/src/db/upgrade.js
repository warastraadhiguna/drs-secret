// Menjalankan SEMUA migrasi inkremental proyek ini berurutan — dipakai setiap
// kali update kode ke server yang SUDAH berisi data (BUKAN db:migrate, yang
// menghapus semua tabel). Tiap skrip idempoten: yang sudah pernah jalan cuma
// melapor "sudah ada". Instalasi baru dari schema.sql juga aman menjalankan
// ini (semua langkah jadi no-op).
//
// Fitur baru yang mengubah skema: buat src/db/add-<fitur>.js (idempoten),
// update schema.sql, lalu TAMBAHKAN namanya di akhir daftar ini.
//
// Usage: npm run db:upgrade
const { spawnSync } = require('child_process');
const path = require('path');

const STEPS = [
  'add-bundles.js',
  'add-indent.js',
  'add-internal-usage-type.js',
  'add-supplier-payments.js',
  'add-service-products.js',
  'remove-sync.js',
];

for (const step of STEPS) {
  console.log(`\n=== ${step} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, step)], { stdio: 'inherit', cwd: path.join(__dirname, '../..') });
  if (result.status !== 0) {
    console.error(`\nUpgrade BERHENTI di ${step} (exit ${result.status}). Langkah sesudahnya tidak dijalankan.`);
    process.exit(result.status || 1);
  }
}
console.log('\nSemua migrasi inkremental selesai.');
