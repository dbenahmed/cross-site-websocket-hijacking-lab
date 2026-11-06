# Complete User Guide & Master Reminder of Everything We Discussed

This document is your **all-in-one reference**. It contains:
- **Part 1:** Step-by-step instructions to run the project in your VMs (or on `localhost`).
- **Part 2:** Every single adjustment we made for the VMs (why we switched from `http://` to `https://`, why `secure: true` vs `false` mattered, Firefox's Cookie Jars vs. Chrome, etc.).
- **Part 3:** A complete **Master Reminder of Every Question & Concept We Discussed** so you can read this anytime and remember 100% of the details for your presentation or exam.

---

## Part 1: Step-by-Step Guide to Running the Project

### Step 1: Start Server 1 (Trusted Chat Server — Port `3000`)
On **VM 1 (`192.168.28.131`)** (or Terminal 1 on `localhost`):
```bash
cd vm1-chat-server
npm install
node ./server.js
```
- On the very first run, `server.js` automatically runs `openssl` to generate `key.pem` and `cert.pem` and starts an **HTTPS + WSS** server on `https://0.0.0.0:3000`.

### Step 2: Start Server 2 (External Origin Diagnostic Server — Port `5000`)
On **VM 2 (`192.168.28.132`)** (or Terminal 2 on `localhost`):
```bash
cd vm2-external-server
node ./server.js
```
- On the very first run, `server.js` automatically runs `openssl` to generate `key.pem` and `cert.pem` and starts an **HTTPS** server on `https://0.0.0.0:5000`.

### Step 3: Open the Browser (Chrome Recommended, or Firefox with Shield Off)
1. **Tab 1 (Chat App):**
   - Open **`https://192.168.28.131:3000`** *(make sure it starts with `https://`)*.
   - Click **Advanced → Proceed / Accept the Risk and Continue** (because the certificate is self-signed).
   - Click **Logout** (if an old session exists) and **Login** as `alice@example.com` / `password123`.
   - Verify it says: `WebSocket: Connected (wss://192.168.28.131:3000/chat)`.
2. **Tab 2 (External Origin Page):**
   - Open **`https://192.168.28.132:5000`** *(make sure it ALSO starts with `https://`)*.
   - Click **Advanced → Proceed / Accept the Risk and Continue**.
   - *(If using Firefox instead of Chrome: click the **Shield icon 🛡️** next to `https://192.168.28.132:5000` in the address bar and toggle **Enhanced Tracking Protection OFF**, or set `network.cookie.cookieBehavior = 0` in `about:config`.)*

### Step 4: Test the 4 Modes Live
1. **`1. Vulnerable (Cookie Only)`:** Click `Test Cross-Origin WS Handshake` in Tab 2 → **Succeeds (`101 Switching Protocols`)!** Send messages in Tab 1 and watch Tab 2 intercept them live.
2. **`2. Origin Validation Only`:** Select Mode 2 in Tab 1, then click `Test Cross-Origin WS Handshake` in Tab 2 → **Blocked (`403 Forbidden: Untrusted Origin`)!**
3. **`3. One-Time Ticket Only`:** Select Mode 3 in Tab 1 (notice Tab 1 connects with `?ticket=<uuid>`), then click `Test Cross-Origin WS Handshake` in Tab 2 → **Blocked (`403 Forbidden: Invalid or Expired Ticket`)!**
4. **`4. Both (Origin + Ticket)`:** Select Mode 4 in Tab 1, then test in Tab 2 → **Blocked by both layers!**

---

## Part 2: Reminder — Why We Had to Make Each Technical Adjustment in the VMs

### 1. Why Did We Have to Switch From `http://` to `https://` (`wss://`)?
When you tested across two separate Virtual Machines using raw IP addresses (`192.168.28.131` and `192.168.28.132`):
1. **Two raw IP addresses are Cross-Site:** Because `192.168.28.131` and `192.168.28.132` do not share a domain name (like `.company.com`), the browser treats them as **two completely unrelated websites (Cross-Site)**.
2. **`SameSite=Lax` is blocked across raw IPs:** Under `SameSite=Lax`, browsers refuse to send cookies between two different sites/IPs. So we had to set the cookie to **`SameSite=None`**.
3. **Browsers FORBID `SameSite=None` over plain `http://`:** Modern Chrome and Firefox have a hardcoded rule: if a cookie has `SameSite=None`, it **must** also have `secure: true` AND be served over **`https://`** (except on `localhost`).
4. **What happened when we tried `secure: true` on plain `http://192.168.28.131:3000`?**
   `secure: true` tells the browser: *"Only save this cookie on encrypted `https://` connections!"* When the server was still plain `http://`, the browser threw the cookie in the trash immediately—which is why even Alice and Bob's own chat window said `WebSocket: Closed`!
5. **Why did BOTH `.131:3000` AND `.132:5000` need `https://`?**
   When Tab 1 was `https://192.168.28.131:3000` but Tab 2 was still `http://192.168.28.132:5000` (plain HTTP), the browser blocked attaching `Secure` cookies because the page initiating the request (Tab 2) was an insecure `http://` page! Making **both** servers `https://` solved it completely.

---

### 2. Why Did Firefox Need the Shield Toggled Off (`cookieBehavior = 0`) While Chrome Works by Default?
- **How Firefox's "Total Cookie Protection" (`network.cookie.cookieBehavior = 5` / Shield icon 🛡️) works:**
  To stop ad trackers (like Facebook Ads) from tracking users across websites, Firefox puts a **brick wall** between every website you type into the address bar, creating **separate, isolated Cookie Jars**:
  - When you logged in on `https://192.168.28.131:3000`, Firefox put your cookie in **Jar #1 (for `.131` when viewing `.131`)**.
  - When you opened `https://192.168.28.132:5000`, Firefox looked inside **Jar #2 (for `.131` when viewing `.132`)**—which was **empty**!
- **Why Chrome works out of the box:**
  Google Chrome does **not** partition `SameSite=None; Secure` cookies by default.
- **Why `localhost:3000` + `localhost:5000` (or `chat.company.com` + `blog.company.com`) works even in Firefox with the Shield ON:**
  Because Firefox's Cookie Jar is shared across the **same root domain (`Site`)**! Since `localhost:3000` and `localhost:5000` share `localhost` (and `chat.company.com` + `blog.company.com` share `company.com`), they are placed in the **same Cookie Jar** even when Firefox's Shield is 100% ON!

---

## Part 3: Master Reminder of Every Concept & Question We Discussed

### Reminder 1: Does the Attacker Server (`.132:5000`) Ever See or Steal the JWT Token String?
- **NO!** The `session_token` cookie belongs to `.131:3000` and has `HttpOnly: true`.
- It is **never** sent to `.132:5000`, and JavaScript can **never** read it via `document.cookie`.
- Instead, `.132:5000` runs `new WebSocket("wss://192.168.28.131:3000/chat")` inside the victim's browser. Since the destination of that WebSocket is `.131:3000`, **the victim's own browser attaches the cookie to `.131:3000`**, opening a live two-way communication pipe back to `.132:5000`'s tab—**without `.132:5000` ever knowing the password or JWT string!**

---

### Reminder 2: Is the JWT Token Used at All on WebSockets in Mode 1 (`Vulnerable`)?
- **YES!** Even though the JavaScript code only says `new WebSocket("wss://192.168.28.131:3000/chat")` (with no token in the URL), the browser **invisibly attaches `Cookie: session_token=<JWT>` in the HTTP Upgrade headers**!
- Inside `server.on('upgrade')`, the server reads `req.headers.cookie` and runs `jwt.verify()`. That is how the server knows the connection belongs to **Alice** or **Bob**.
- If you click **Logout** on Tab 1 and try to connect from Tab 2, it fails with `401 Unauthorized: Missing or Invalid Cookie`.

---

### Reminder 3: What Is `server.on('upgrade', (req, socket, head) => { ... })` and When Does It Run?
- **Every WebSocket starts as an HTTP `GET` request** with the header `Upgrade: websocket`.
- `server.on('upgrade')` is the **security guard at the front door** of the WebSocket server:
  - It runs **once** at the exact millisecond a browser calls `new WebSocket(...)`—**before** the WebSocket connection is opened.
  - It does **not** run on normal HTTP `fetch()` calls, and does **not** run when sending chat messages after connecting.
  - **`req`**: Contains `req.url` (`/chat?ticket=...`), `req.headers.origin`, and `req.headers.cookie`.
  - **`socket`**: The raw TCP/TLS network wire. If a check fails, we write `HTTP/1.1 403 Forbidden` directly to `socket` and call `socket.destroy()` to cut the wire immediately.
  - **`head`**: The first packet buffer passed to `wss.handleUpgrade(req, socket, head, ...)` if all security checks pass.

---

### Reminder 4: Why Doesn't Express `app.use(cors(...))` Protect WebSockets? And Why Can't We Use `Authorization: Bearer` Headers?
1. **`app.use(cors(...))` only runs on normal Express HTTP routes (`GET`, `POST`, etc.)**—it **never** runs on `server.on('upgrade')` WebSocket handshakes! Furthermore, browsers do **not** send CORS Preflight (`OPTIONS`) requests or check `Access-Control-Allow-Origin` on `new WebSocket()`.
2. **No custom headers in browser `WebSocket` API:** Unlike `fetch(url, { headers: { Authorization: '...' } })`, the browser's `new WebSocket(url)` API **has no `headers` option**! Developers cannot pass custom `Authorization` headers, which is why they use cookies—or pass a **One-Time Ticket** in the query string (`?ticket=<uuid>`).

---

### Reminder 5: When Do Frontend & Backend Have the "Same Domain (Same-Site)" vs. "Different Domains (Cross-Site)"?
- **Major Tech Companies / Startups With a Custom Domain (`app.company.com` & `api.company.com`):**
  When you buy a private custom domain (`company.com`) and map DNS records to your AWS/Azure servers, they share the root domain `.company.com` → **Same-Site**!
- **Default Cloud Hosting URLs (Without a Custom Domain):**
  - Frontend on `my-ui.vercel.app` or `d123.cloudfront.net` + Backend on `my-api.onrender.com` or `my-api.azurewebsites.net` → **Different Sites (Cross-Site)**!
- **What if BOTH Frontend and Backend are hosted on Netlify (`front.netlify.app` & `back.netlify.app`) or Azure (`front.azurewebsites.net` & `back.azurewebsites.net`)?**
  They are **STILL Cross-Site (Different Sites)**! Why? Because `netlify.app`, `vercel.app`, `onrender.com`, `github.io`, and `azurewebsites.net` are on the browser's **Public Suffix List (PSL)** (`publicsuffix.org`) so strangers hosting apps on Netlify cannot share cookies with your Netlify app!

---

### Reminder 6: "Same-Site" vs "Same-Origin" — Why This Vulnerability Is Still Huge Even When Websites Use `SameSite=Lax` or `SameSite=Strict`!
Whenever you wonder *"Wait—if production websites use the same root domain and `SameSite=Lax` or `Strict`, why does this vulnerability matter?"*, remember these **3 real-world cases**:

1. **Case 1 — Subdomains & Ports on the Same Domain (`SameSite=Lax` & `Strict` FAIL Here!):**
   - **Site** (`SameSite` cookie check) = `scheme + root domain` (**ignores subdomains and ignores ports!**).
   - **Origin** (`fetch` CORS check & `Origin` header) = `scheme + exact subdomain + domain + exact port`.
   - Suppose a university has private staff chat on `https://chat.university.edu` (even with **`SameSite=Strict`**!) and student club pages on `https://club.university.edu`:
     - Does `club.university.edu` get the professor's JWT token? **No!**
     - Can `club.university.edu` call `fetch("https://chat.university.edu/api/messages")`? **NO — blocked by Browser Same-Origin Policy (`club` ≠ `chat`)!**
     - Can `club.university.edu` hijack `new WebSocket("wss://chat.university.edu/chat")`? **YES — EVEN WITH `SameSite=Strict`!** Because both share the root domain `university.edu` (**Same-Site**), the browser attaches the `SameSite=Strict` cookie automatically, and WebSockets skip the Same-Origin Policy!
2. **Case 2 — Embedded Widgets & Separate Cloud Domains (`SameSite=None`):**
   - Customer support live-chat widgets (Intercom, Zendesk, Crisp), Shopify/Slack/Teams plugins, and apps deployed across separate cloud domains (`vercel.app` + `onrender.com`) **must** set `SameSite=None; Secure` to function.
3. **Case 3 — Apps That Don't Use Cookies at All (`localhost` Tools & Corporate Windows Login / Basic Auth):**
   - `SameSite=Strict` **only controls cookies**!
   - In corporate networks using **HTTP Basic Auth** (`WWW-Authenticate: Basic`) or **Windows Active Directory Login (`NTLM` / `Kerberos`)**, or developer tools running on **`ws://localhost:3000`**, there are no cookies. If an employee visits `https://evil.com`, the browser blocks `evil.com` from calling `fetch()`, **but automatically attaches the employee's Basic Auth / Windows credentials to `new WebSocket()`**!

---

### Reminder 7: Mathematical Proof of Why the One-Time Ticket (`Mode 3` & `Mode 4`) Is Unbeatable
1. **Why can't the attacker page reuse the victim's ticket?**
   Because the exact millisecond the victim's tab connects with `?ticket=<uuid>`, the server runs `tickets.delete(ticketId)`—**burning (deleting) the ticket immediately on first use**!
2. **Why can't the attacker page request a brand-new ticket of its own?**
   Because requesting a ticket requires calling `fetch("https://192.168.28.131:3000/api/ws-ticket", { method: "POST" })`. Unlike WebSockets, **`fetch()` is strictly governed by the browser's Same-Origin Policy (CORS)**! Since the attacker page is on a different Origin (`.132:5000` or `club.university.edu`), the browser **blocks** the attacker page from reading the `/api/ws-ticket` response!
3. **Why combine Origin Validation + One-Time Ticket (`Mode 4: Both`)?**
   - **Origin Validation** blocks untrusted `Origin` headers immediately at the door.
   - **One-Time Ticket** ensures that even if a misconfigured reverse proxy (like Nginx or AWS ALB) accidentally overwrites the `Origin` header, no WebSocket can ever open without proving it passed the browser's Same-Origin Policy to obtain a fresh, unused 15-second ticket!
