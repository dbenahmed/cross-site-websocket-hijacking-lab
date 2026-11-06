// Built-in Node.js modules used to load the local .env file without requiring extra npm dependencies
const fs = require('fs');
const path = require('path');

// Load key=value pairs from vm1-chat-server/.env into process.env if the file exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    if (key && process.env[key.trim()] === undefined) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  });
}

// Export all configuration values so server.js can import them from one central file
module.exports = {
  // Listen on 0.0.0.0 (all network interfaces) so other Virtual Machines on the Host-Only network can reach this server
  HOST: process.env.HOST || '0.0.0.0',

  // Port 3000 is where our trusted Chat Application HTTP + WebSocket server runs
  PORT: Number(process.env.PORT) || 3000,

  // Secret key used to sign and verify JSON Web Tokens (JWT) stored inside the session cookie
  JWT_SECRET: process.env.JWT_SECRET || 'placeholder-jwt-secret-for-lab',

  // Name of the HTTP-only cookie that stores the user's signed JWT after logging in
  COOKIE_NAME: 'session_token',

  // Explicit allowlist of trusted Origin headers allowed to open a WebSocket when Origin Validation is enabled
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGIN || 'https://localhost:3000,https://192.168.28.131:3000')
    .split(',')
    .map((origin) => origin.trim()),

  // Lifetime of a single-use WebSocket ticket in milliseconds (15 seconds = 15000 ms)
  TICKET_TTL_MS: Number(process.env.TICKET_TTL_MS) || 15 * 1000,

  // Active security mode configured via .env ('vulnerable' | 'origin' | 'both')
  DEFENSE_MODE: process.env.DEFENSE_MODE || 'vulnerable'
};
