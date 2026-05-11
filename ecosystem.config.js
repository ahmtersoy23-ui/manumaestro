/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config({ path: '/var/www/manumaestro/.env' });

module.exports = {
  apps: [{
    name: 'manumaestro',
    script: 'npm',
    args: 'start',
    cwd: '/var/www/manumaestro',
    // .env'deki tum kayitlari child process'e gec (Sentry, JWT, Prisma, vb.)
    // Eklenen yeni env vars otomatik gecsin diye spread kullanildi.
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: 3000,
    },
    max_memory_restart: '500M',
    error_file: '/var/log/manumaestro/error.log',
    out_file: '/var/log/manumaestro/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
