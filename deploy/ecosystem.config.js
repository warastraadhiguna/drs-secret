// pm2 — jalankan dari /var/www/drs-secret:  pm2 start deploy/ecosystem.config.js
// NODE_ENV & variabel lain dibaca dari server/.env (dotenv); di sini cuma
// memastikan proses jalan dari folder server/ supaya .env-nya ketemu.
module.exports = {
  apps: [
    {
      name: 'drs-secret',
      cwd: '/var/www/drs-secret/server',
      script: 'src/server.js',
      env: { NODE_ENV: 'production' },
      instances: 1,          // WAJIB 1 — BackupScheduler & penguncian nomor invoice mengandalkan satu proses
      exec_mode: 'fork',
      max_memory_restart: '400M',
      time: true,            // cap waktu di log (pm2 logs drs-secret)
    },
  ],
};
