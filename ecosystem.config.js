const path = require('node:path')

module.exports = {
  apps: [{
    name: 'madar-erp',
    cwd: path.join(__dirname, 'system'),
    script: 'index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    kill_timeout: 10000,
    env: {
      NODE_ENV: 'production',
    },
  }],
}
