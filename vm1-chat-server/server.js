// Built-in Node.js HTTP module used to create the underlying HTTP server and intercept 'upgrade' events
const http = require('http');
// Built-in Node.js path module to safely construct file system paths across Windows and Linux VMs
const path = require('path');
// Built-in Node.js crypto module used to generate cryptographically random UUIDs for single-use tickets
const crypto = require('crypto');
// Express framework used for standard REST API routes (/api/login, /api/ws-ticket, etc.) and static HTML serving
const express = require('express');
// Middleware that parses the HTTP Cookie header into req.cookies on standard Express HTTP routes
const cookieParser = require('cookie-parser');
// Library used to sign and verify JSON Web Tokens (JWT) for user authentication
const jwt = require('jsonwebtoken');
// Native Node.js WebSocket library; note that 'ws' does NOT check the Origin header by default
const { WebSocketServer } = require('ws');
// Load our server configuration (ports, allowed origins, ticket expiration, etc.)
const config = require('./config');

// Create the Express application instance for handling HTTP requests
const app = express();
// Wrap the Express app inside a raw Node.js HTTP server so we can manually listen to the 'upgrade' event
const server = http.createServer(app);
// Initialize WebSocketServer with { noServer: true } so we control the HTTP-to-WebSocket upgrade handshake manually
const wss = new WebSocketServer({ noServer: true });

// Enable Express to parse JSON request bodies (used by POST /api/login and POST /api/mode)
app.use(express.json());
// Enable Express to parse incoming cookies into req.cookies on standard HTTP requests
app.use(cookieParser());
// Serve the frontend chat interface (public/index.html) when a user visits http://localhost:3000
app.use(express.static(path.join(__dirname, 'public')));

// Track the currently active defense mode in memory so it can be toggled live during demonstrations
let defenseMode = config.INITIAL_MODE;
// List of allowed defense mode values:
// 1. 'vulnerable' = Cookie only (no Origin check, no Ticket check)
// 2. 'origin'     = Origin header validation + Cookie check
// 3. 'both'       = Origin header validation + Single-Use Ephemeral Ticket check
const VALID_MODES = ['vulnerable', 'origin', 'both'];

// Demo password loaded from environment or defaulted for lab testing
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'password123';
// In-memory list of users so the project runs without needing an external database
const users = [
  { id: 1, email: 'alice@example.com', name: 'Alice', password: DEMO_PASSWORD },
  { id: 2, email: 'bob@example.com', name: 'Bob', password: DEMO_PASSWORD }
];

// In-memory store for single-use WebSocket tickets: maps ticketUUID -> { user, expiresAt }
const tickets = new Map();
// In-memory buffer of recent chat messages sent to newly connected WebSocket clients
const messageHistory = [
  { sender: 'System', text: 'Welcome to the real-time chat server.', timestamp: new Date().toLocaleTimeString() }
];

// Helper function to parse the raw 'Cookie' HTTP header during a WebSocket 'upgrade' request
// (Express middleware like cookie-parser does not run automatically on raw HTTP upgrade requests)
function parseCookies(cookieHeader = '') {
  // Object to hold key-value pairs of parsed cookies
  const list = {};
  // Split the Cookie header string by ';' to iterate through each individual cookie
  cookieHeader.split(';').forEach((entry) => {
    // Split each cookie entry into [name, value] around the '=' character
    const parts = entry.split('=');
    // Extract and trim the cookie name
    const key = parts.shift()?.trim();
    // If a valid cookie name exists, decode and store its value
    if (key) {
      list[key] = decodeURIComponent(parts.join('='));
    }
  });
  // Return the dictionary of parsed cookies
  return list;
}

// Helper function to verify a JWT string and return the decoded user payload (or null if invalid/expired)
function getUserFromToken(token) {
  // If no token was provided, the user is not authenticated
  if (!token) return null;
  try {
    // Verify the token signature and expiration using the server's secret key
    return jwt.verify(token, config.JWT_SECRET);
  } catch {
    // Return null if the token was tampered with or expired
    return null;
  }
}

// HTTP Route: Authenticate a user with email and password and issue a JWT cookie
app.post('/api/login', (req, res) => {
  // Read email and password from the JSON request body
  const { email, password } = req.body;
  // Look up matching user in our in-memory user list
  const user = users.find((u) => u.email === email && u.password === password);

  // If credentials do not match, return 401 Unauthorized
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Create the public user payload to embed inside the JWT (never include the password)
  const payload = { id: user.id, email: user.email, name: user.name };
  // Sign the JWT so it expires in 2 hours
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '2h' });

  // Attach the JWT as an HTTP-only cookie with SameSite=None so it is sent across different domains/IPs
  // secure: true is required by modern browsers whenever sameSite is set to 'None'
  res.cookie(config.COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'None',
    secure: true,
    maxAge: 2 * 60 * 60 * 1000
  });

  // Return the logged-in user details and current server defense mode to the frontend
  res.json({ user: payload, mode: defenseMode });
});

// HTTP Route: Log out the current user by deleting the session cookie
app.post('/api/logout', (req, res) => {
  // Instruct the browser to clear the session_token cookie
  res.clearCookie(config.COOKIE_NAME);
  // Respond with success
  res.json({ ok: true });
});

// HTTP Route: Check who is currently logged in and which defense mode is active
app.get('/api/me', (req, res) => {
  // Read the session_token cookie from req.cookies and verify the JWT
  const user = getUserFromToken(req.cookies[config.COOKIE_NAME]);
  // Return the user object (or null) and active defense mode
  res.json({ user, mode: defenseMode });
});

// HTTP Route: Switch the active server defense mode at runtime (for live demonstration)
app.post('/api/mode', (req, res) => {
  // Extract the requested mode from the JSON body
  const { mode } = req.body;
  // Reject unknown mode names
  if (!VALID_MODES.includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  // Update the server's active defense mode
  defenseMode = mode;
  // Return the newly active defense mode
  res.json({ mode: defenseMode });
});

// HTTP Route (Defense 2): Generate a short-lived (15s), single-use ticket for WebSocket connection
// Because this is a standard HTTP POST endpoint without permissive CORS headers, the browser's
// Same-Origin Policy (SOP) blocks external origins (like localhost:5000) from reading this response!
app.post('/api/ws-ticket', (req, res) => {
  // Verify the caller is logged in by checking their JWT session cookie
  const user = getUserFromToken(req.cookies[config.COOKIE_NAME]);
  // Reject unauthenticated callers with 401 Unauthorized
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Generate a cryptographically random UUID v4 string to serve as the one-time ticket
  const ticket = crypto.randomUUID();
  // Save the ticket in memory mapped to the user and an expiration timestamp 15 seconds in the future
  tickets.set(ticket, {
    user: { id: user.id, email: user.email, name: user.name },
    expiresAt: Date.now() + config.TICKET_TTL_MS
  });

  // Send the ticket back to the same-origin frontend so it can connect to ws://.../chat?ticket=<uuid>
  res.json({ ticket, expiresInSeconds: config.TICKET_TTL_MS / 1000 });
});

// Helper function to immediately terminate an unauthorized HTTP-to-WebSocket upgrade request
function rejectUpgrade(socket, statusCode, message) {
  // Write a raw HTTP error response directly to the underlying TCP socket
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  // Close and destroy the TCP socket so the WebSocket handshake cannot proceed
  socket.destroy();
}

// Intercept every raw HTTP 'upgrade' request before the WebSocket connection is established
server.on('upgrade', (req, socket, head) => {
  // Parse the incoming request URL so we can inspect the path (/chat) and query parameters (?ticket=...)
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  // Only allow WebSocket upgrades on the '/chat' path
  if (requestUrl.pathname !== '/chat') {
    return rejectUpgrade(socket, 404, 'Not Found');
  }

  // Determine which security checks are enabled based on the current defenseMode
  const requiresOriginCheck = defenseMode === 'origin' || defenseMode === 'both';
  const requiresTicketCheck = defenseMode === 'both';

  // --- DEFENSE 1: ORIGIN VALIDATION ---
  if (requiresOriginCheck) {
    // Read the Origin header automatically attached by the browser to the WebSocket handshake
    const origin = req.headers.origin;
    // If the Origin header is missing or is not in our ALLOWED_ORIGINS list, reject with 403 Forbidden
    if (!origin || !config.ALLOWED_ORIGINS.includes(origin)) {
      return rejectUpgrade(socket, 403, 'Forbidden: Untrusted Origin');
    }
  }

  // Variable to hold the authenticated user identity for this WebSocket connection
  let authenticatedUser = null;

  // --- DEFENSE 2: ONE-TIME EPHEMERAL TICKET ---
  if (requiresTicketCheck) {
    // Extract the '?ticket=<uuid>' query parameter from the WebSocket connection URL
    const ticketId = requestUrl.searchParams.get('ticket');
    // Look up the ticket in our server-side Map
    const record = tickets.get(ticketId);

    // Immediately delete (burn) the ticket so it can only ever be used once (prevents replay attacks)
    if (ticketId) {
      tickets.delete(ticketId);
    }

    // If the ticket did not exist or has passed its 15-second expiration time, reject with 403 Forbidden
    if (!record || Date.now() > record.expiresAt) {
      return rejectUpgrade(socket, 403, 'Forbidden: Invalid or Expired Ticket');
    }

    // Bind the WebSocket connection to the user who requested the ticket
    authenticatedUser = record.user;
  } else {
    // --- VULNERABLE / AMBIENT COOKIE AUTHENTICATION ---
    // When ticket defense is off, authenticate using the browser's automatically attached Cookie header
    const cookies = parseCookies(req.headers.cookie);
    // Verify the JWT inside the session_token cookie
    authenticatedUser = getUserFromToken(cookies[config.COOKIE_NAME]);

    // If no valid session cookie is present, reject the handshake with 401 Unauthorized
    if (!authenticatedUser) {
      return rejectUpgrade(socket, 401, 'Unauthorized: Missing or Invalid Cookie');
    }
  }

  // All enabled checks passed: complete the WebSocket handshake (101 Switching Protocols)
  wss.handleUpgrade(req, socket, head, (ws) => {
    // Attach the authenticated user's profile to the WebSocket instance
    ws.user = authenticatedUser;
    // Emit the 'connection' event so our message handler below takes over
    wss.emit('connection', ws, req);
  });
});

// Handle active WebSocket connections after the upgrade handshake has succeeded
wss.on('connection', (ws, req) => {
  // Send an initial welcome packet containing the user profile, origin, active mode, and chat history
  ws.send(JSON.stringify({
    type: 'init',
    user: ws.user,
    origin: req.headers.origin || 'unknown',
    mode: defenseMode,
    history: messageHistory
  }));

  // Listen for incoming chat messages sent over this WebSocket connection
  ws.on('message', (raw) => {
    // Parse the incoming JSON message string safely
    let parsed;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Ignore empty or non-string messages
    if (!parsed.text || typeof parsed.text !== 'string') return;

    // Construct the chat message object tagged with the authenticated user's name and timestamp
    const entry = {
      sender: ws.user.name,
      email: ws.user.email,
      text: parsed.text.slice(0, 300),
      timestamp: new Date().toLocaleTimeString()
    };

    // Store the message in memory (keeping the most recent 50 messages)
    messageHistory.push(entry);
    if (messageHistory.length > 50) {
      messageHistory.shift();
    }

    // Broadcast the new message in real time to every currently connected WebSocket client
    const payload = JSON.stringify({ type: 'message', data: entry });
    wss.clients.forEach((client) => {
      // readyState === 1 (WebSocket.OPEN) means the connection is open and ready to receive data
      if (client.readyState === 1) {
        client.send(payload);
      }
    });
  });
});

// Start the HTTP + WebSocket server on the configured host and port
server.listen(config.PORT, config.HOST, () => {
  console.log(`Chat Server listening on http://localhost:${config.PORT} (mode: ${defenseMode})`);
});
