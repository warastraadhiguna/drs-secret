function notFoundHandler(req, res) {
  res.status(404).json({ error: 'not_found', message: `Route ${req.method} ${req.path} tidak ditemukan` });
}

// eslint-disable-next-line no-unused-vars
// Error terduga (HttpError, status < 500) dikirim apa adanya — pesannya memang
// utk pengguna. Error TAK terduga (500: bug, error SQL mentah, dst) di
// produksi TIDAK dikirim detailnya ke browser (bisa membocorkan nama tabel/
// kolom/query) — cukup dicatat di log server (pm2 logs).
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  console.error(err);
  if (status >= 500 && process.env.NODE_ENV === 'production') {
    return res.status(status).json({
      error: 'internal_error',
      message: 'Terjadi kesalahan pada server. Coba lagi, atau hubungi admin kalau berulang.',
    });
  }
  res.status(status).json({
    error: err.code || 'internal_error',
    message: err.message || 'Terjadi kesalahan pada server',
  });
}

module.exports = { notFoundHandler, errorHandler };
