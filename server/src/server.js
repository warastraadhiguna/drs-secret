require('dotenv').config();
const app = require('./app');
const pool = require('./config/db');
const BackupScheduler = require('./services/BackupScheduler');

const PORT = process.env.PORT || 4001;
const HOST = process.env.HOST || '0.0.0.0'; // dikonfigurasi via env, bukan hardcode (Bagian 8)

async function start() {
  // Di produksi, JWT_SECRET lemah/default = siapa pun bisa memalsukan token login.
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.JWT_SECRET || '';
    if (secret.length < 32 || /change-this/i.test(secret)) {
      throw new Error('JWT_SECRET di .env wajib diisi string acak minimal 32 karakter (openssl rand -base64 48)');
    }
  }
  // Pastikan koneksi DB hidup sebelum server menerima request
  await pool.query('SELECT 1');
  app.listen(PORT, HOST, () => {
    console.log(`DR's Secret server berjalan di http://${HOST}:${PORT}`);
  });
  BackupScheduler.start();
}

start().catch((err) => {
  console.error('Gagal start server:', err.message);
  process.exit(1);
});
