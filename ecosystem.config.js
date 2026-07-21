// Process-manager config for a raw VPS deploy (not needed on platforms like
// Render/Railway, which restart crashed processes themselves).
// Usage: npx pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'continental',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
