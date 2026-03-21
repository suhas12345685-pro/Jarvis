module.exports = {
  apps: [
    // Main JARVIS server (Express + BullMQ + webhooks)
    {
      name: 'jarvis',
      script: './dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_file: '.env',
      log_file: `${process.env.HOME}/.jarvis/logs/pm2.log`,
      error_file: `${process.env.HOME}/.jarvis/logs/pm2-error.log`,
      out_file: `${process.env.HOME}/.jarvis/logs/pm2-out.log`,
      time: true,
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 5000,
      // Auto-start on system boot (run: pm2 startup && pm2 save)
    },
    // Ghost Daemon (persistent background CLI worker — Unix socket)
    {
      name: 'jarvis-daemon',
      script: './dist/cli/daemon.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env_file: '.env',
      log_file: `${process.env.HOME}/.jarvis/logs/daemon.log`,
      error_file: `${process.env.HOME}/.jarvis/logs/daemon-error.log`,
      out_file: `${process.env.HOME}/.jarvis/logs/daemon-out.log`,
      time: true,
      kill_timeout: 10000,
      listen_timeout: 8000,
    },
  ],
}
