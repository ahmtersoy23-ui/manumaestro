require('dotenv').config({ path: '/var/www/manumaestro/.env' });

module.exports = {
  apps: [{
    name: 'manumaestro',
    script: 'npm',
    args: 'start',
    cwd: '/var/www/manumaestro',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DATABASE_URL: process.env.DATABASE_URL,
      PRODUCT_DB_URL: process.env.PRODUCT_DB_URL,
      SSO_URL: process.env.SSO_URL,
      SSO_APP_CODE: process.env.SSO_APP_CODE
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
