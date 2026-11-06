// Built-in Node.js HTTPS module so the external origin runs over https:// (required for Secure Context cookie attachment)
const https = require('https');
// Built-in Node.js File System and Child Process modules to read .env, index.html, and auto-generate TLS certs
const fs = require('fs');
const { execFileSync } = require('child_process');
// Built-in Node.js Path module to resolve file paths across operating systems
const path = require('path');

// Load key=value pairs from vm2-external-server/.env into process.env if the file exists
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

// Automatically generate a self-signed TLS certificate (cert.pem & key.pem) using OpenSSL if not already present
const keyPath = path.join(__dirname, 'key.pem');
const certPath = path.join(__dirname, 'cert.pem');
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.log('[TLS] Generating self-signed HTTPS certificate for External Server (key.pem & cert.pem)...');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath,
    '-out', certPath,
    '-days', '365',
    '-subj', '/CN=192.168.28.132'
  ]);
}

// Bind to 0.0.0.0 so the server is reachable both via localhost:5000 and across a Host-Only VM network
const HOST = process.env.HOST || '0.0.0.0';
// Port 5000 makes this server a completely separate browser Origin (https://192.168.28.132:5000 vs https://192.168.28.131:3000)
const PORT = Number(process.env.PORT) || 5000;

// Helper function to print timestamped logs in the External Server terminal
function logExternal(category, message) {
  console.log(`[${new Date().toLocaleTimeString()}] [${category}] ${message}`);
}

// Create the HTTPS server that serves the Cross-Origin Diagnostic HTML page and logs browser test events
const server = https.createServer({
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
}, (req, res) => {
  // Endpoint called by the diagnostic page to mirror browser test events into this server's terminal console
  if (req.method === 'POST' && req.url === '/api/log') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        logExternal(parsed.level || 'BROWSER-EVENT', parsed.message || '');
      } catch {
        logExternal('BROWSER-EVENT', body);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // Log when a browser loads the external origin page
  logExternal('HTTPS-GET', `Client (${req.socket.remoteAddress}) loaded External Origin page (${req.url})`);

  // Locate public/index.html relative to this server.js file
  const indexPath = path.join(__dirname, 'public', 'index.html');
  // Read the HTML file from disk and send it in the HTTPS response
  fs.readFile(indexPath, (err, content) => {
    if (err) {
      res.writeHead(500);
      return res.end('Error loading index.html');
    }
    // Respond with 200 OK and HTML content-type header
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  });
});

// Start listening for incoming HTTPS connections on port 5000
server.listen(PORT, HOST, () => {
  logExternal('STARTUP', `HTTPS External Origin Diagnostic Server listening on https://${HOST}:${PORT}`);
});
