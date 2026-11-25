require('dotenv').config();
const mysql = require('mysql2/promise');

// Mode SQL KETAT dipaksa per koneksi — supaya perilaku di laptop (MySQL WAMP,
// default-nya longgar) SAMA dgn server produksi (MariaDB strict). Tanpa ini,
// nilai yang salah tipe/kepanjangan diam-diam dipotong di lokal tapi DITOLAK
// di server (pernah terjadi di proyek asal: ER_TRUNCATED_WRONG_VALUE).
const SQL_MODE = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

// IP/host & port dibaca dari env, bukan hardcode.
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pos_drs',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: false, // DECIMAL tetap string dari driver, dikonversi via decimal.js — jangan lewat Number JS biasa
});

// `pool.pool` = pool callback-style di balik wrapper promise; event
// 'connection' dipanggil SEKALI per koneksi fisik baru.
pool.pool.on('connection', (conn) => {
  conn.query(`SET SESSION sql_mode = '${SQL_MODE}'`);
});

pool.SQL_MODE = SQL_MODE;
module.exports = pool;
