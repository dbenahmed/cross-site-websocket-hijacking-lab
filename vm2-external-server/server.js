// Built-in Node.js HTTP module to create a minimal web server on port 5000 without any external npm packages
const http = require('http');
// Built-in Node.js File System module to read .env and public/index.html from disk
const fs = require('fs');
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

// Bind to 0.0.0.0 so the server is reachable both via localhost:5000 and across a Host-Only VM network
const HOST = process.env.HOST || '0.0.0.0';
// Port 5000 makes this server a completely separate browser Origin (http://localhost:5000 vs http://localhost:3000)
const PORT = Number(process.env.PORT) || 5000;

// Create the HTTP server that serves the Cross-Origin Diagnostic HTML page
const server = http.createServer((req, res) => {
  // Locate public/index.html relative to this server.js file
  const indexPath = path.join(__dirname, 'public', 'index.html');
  // Read the HTML file from disk and send it in the HTTP response
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

// Start listening for incoming HTTP connections on port 5000
server.listen(PORT, HOST, () => {
  console.log(`External Origin Diagnostic Server listening on http://localhost:${PORT}`);
});
