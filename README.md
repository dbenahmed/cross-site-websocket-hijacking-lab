# Cross-Site WebSocket Hijacking (CSWSH) & Real-Time Defense Lab
### Using Strict Origin Validation and Single-Use Ephemeral Tickets

Welcome! This repository demonstrates **Cross-Site WebSocket Hijacking (CSWSH)**—a critical web security vulnerability in real-time WebSocket applications—and shows how to secure WebSocket servers using **Origin Enforcement** and the **Single-Use Ephemeral Ticket Pattern**.

This guide is written so that **anyone visiting this repository for the first time** can understand the problem, the browser mechanics, every edge case, and the code from scratch.

---

> [!IMPORTANT]
> ### Crucial Lab Note: `SameSite=None`, `secure: false`, and Browser Settings for Plain HTTP VM Testing
>
> When testing across **two different Virtual Machine IP addresses** over plain HTTP (for example, `http://192.168.28.131:3000` and `http://192.168.28.132:5000` without SSL/HTTPS certificates):
>
> 1. **What `SameSite=None` does:**
>    Because two raw IP addresses (`192.168.28.131` and `192.168.28.132`) have no shared domain name, the browser treats them as **two completely different websites (Cross-Site)**. For the browser to attach the login cookie across two different sites/IPs, the cookie must use `sameSite: 'None'`.
> 2. **What `secure: true` vs `secure: false` does:**
>    - **`secure: true`** tells the browser: *"ONLY save and send this cookie over encrypted `https://` (or `wss://`) connections!"* (with a built-in exception for `http://localhost`). If you set `secure: true` while visiting a plain HTTP IP address like `http://192.168.28.131:3000`, the browser **refuses to save the cookie at all**, and even normal login breaks!
>    - **`secure: false`** allows the browser to save and send the cookie over plain **`http://`** and **`ws://`** in a local VM lab without needing HTTPS certificates.
> 3. **Required One-Time Browser Setting for Plain HTTP VM Lab:**
>    By default, modern browsers block `SameSite=None` unless `secure: true` (`https://`) is used. To allow `SameSite=None` with `secure: false` over plain `http://192.168.x.x` in your VM browser:
>    - **In Firefox (e.g., Kali Linux / Ubuntu VM):**
>      1. Open a new tab and go to **`about:config`** (click *Accept the Risk and Continue*).
>      2. Search for **`network.cookie.sameSite.noneRequiresSecure`** and double-click it to set it to **`false`**.
>      3. Search for **`network.cookie.cookieBehavior`** and change its value from `5` to **`0`** (this disables Firefox's "Total Cookie Protection" so cross-IP cookies work in both Normal and Private Browsing windows).
>    - **In Chrome / Chromium / Edge / Brave:**
>      1. Open **`chrome://flags/#unsafely-treat-insecure-origin-as-secure`**.
>      2. Enter your Chat Server URL (e.g. `http://192.168.28.131:3000`), set to **Enabled**, and relaunch.
>    - *(Note: If you run both servers on the same machine via `http://localhost:3000` and `http://localhost:5000`, no browser setting change is needed because `localhost` is already treated as Same-Site and Secure by default.)*

---

## 1. The Big Picture: What Is the Problem? (Explained Simply)

Modern web apps (live chats, financial dashboards, collaborative editors) use **WebSockets** (`ws://` or `wss://`) instead of normal HTTP requests (`fetch`) so the server can push live messages to the browser instantly.

However, there is a dangerous gap between how browsers protect **normal HTTP requests (`fetch`)** and how browsers handle **WebSockets (`new WebSocket()`)**:

1. **When a user logs into a website (e.g., `http://localhost:3000`):**
   - The server creates a signed **JSON Web Token (JWT)** and stores it in the user's browser inside an `HttpOnly` cookie (`session_token`).
   - Whenever the browser connects to `localhost:3000`, the browser **automatically attaches** that cookie.
2. **What happens if the logged-in user opens another website in a second tab (e.g., `http://localhost:5000`)?**
   - **Can the second tab read the cookie with `document.cookie`?**
     ❌ **NO.** The cookie belongs to `localhost:3000` and is marked `HttpOnly`. The external page **never sees the JWT token string**.
   - **Can the second tab steal private data using `fetch("http://localhost:3000/api/...")`?**
     ❌ **NO.** Even if the browser attaches the cookie to the request, the browser's **Same-Origin Policy (SOP / CORS)** sees that the request came from `http://localhost:5000` (a different Origin) and **blocks the second tab from reading the response**.
   - **What if the second tab opens `new WebSocket("ws://localhost:3000/chat")`?**
     ⚠️ **YES — IT SUCCEEDS BY DEFAULT!**
     Why? Because **the browser's Same-Origin Policy does NOT block WebSockets by default**, and standard WebSocket libraries (like Node.js `ws`) accept connections from **any Origin** out of the box!
     - The victim's browser automatically attaches the victim's `session_token` cookie to the WebSocket handshake going to `localhost:3000`.
     - The server checks the cookie, sees it belongs to the logged-in user, and opens a live two-way communication pipe directly to the second tab!
     - Now the external page can **eavesdrop on live private messages** and **send messages pretending to be the victim**—all **without ever knowing the victim's password or JWT token!**

---

## 2. Master Mindmap of the Entire Security Landscape

```mermaid
mindmap
  root((Cross-Site WebSocket Hijacking - CSWSH))
    1. Why It Happens
      WebSockets bypass Browser Same-Origin Policy by default
      Node.js raw 'ws' library does not check Origin header by default
      Browser automatically attaches cookies to WebSocket Upgrade request
      Browser WebSocket API does not support custom Authorization headers
    2. What the External Page Can and Cannot Do
      CANNOT read document.cookie (HttpOnly + scoped to target host)
      CANNOT read HTTP fetch responses (Blocked by Browser SOP / CORS)
      CAN open new WebSocket and read/send live messages if server has no defense
    3. Browser Cookie Rules (Site vs Origin)
      SITE = Scheme + Root Domain (Ignores Subdomains and Ports!)
        Same-Site Examples (Cookie IS sent even with SameSite=Lax or Strict!)
          localhost:5000 to localhost:3000 (Different Ports)
          blog.company.com to chat.company.com (Sibling Subdomains)
        Cross-Site Examples (Cookie only sent if SameSite=None; Secure)
          evil.com to api.onrender.com (Different Domains)
          a.netlify.app to b.netlify.app (Public Suffix List Cloud Domains)
          192.168.28.132 to 192.168.28.131 (Raw IP Addresses)
      ORIGIN = Scheme + Exact Subdomain + Domain + Exact Port
        Used by Browser SOP / CORS and the HTTP Origin Header
    4. Our Two Server-Side Defenses
      Defense 1: Strict Origin Validation
        Inspects req.headers.origin on HTTP Upgrade event
        Browser sets Origin automatically (JavaScript cannot spoof it)
        Rejects untrusted origins immediately with HTTP 403 Forbidden
      Defense 2: Single-Use Ephemeral Ticket (15s TTL)
        Removes cookie authentication from WebSocket upgrade completely
        Client must first call POST /api/ws-ticket via HTTP fetch
        Browser SOP blocks external origins from reading /api/ws-ticket response
        Ticket UUID is deleted immediately upon use to prevent replay
```

---

## 3. Complete Decision Flowchart (Every Edge Case Explained)

Follow this chart from top to bottom to see how the browser and server behave in **every possible scenario**:

```mermaid
flowchart TD
    A["Victim is logged into Chat Server (Tab 1)\nand opens an External Page in Tab 2"] --> B{"Relationship between Tab 2 and Chat Server?"}

    B -- "Case A: Same Root Domain or Same Host\n• http://localhost:5000 -> http://localhost:3000\n• https://blog.company.com -> https://chat.company.com\n• https://club.university.edu -> https://chat.university.edu" --> C["Browser Rule: They are SAME-SITE!\n(Because SameSite ignores ports and subdomains)\n✅ Browser ATTACHES the cookie even if SameSite=Lax or SameSite=Strict!"]

    B -- "Case B: Different Root Domains, Cloud PSL, or Raw IPs\n• https://evil.com -> https://api.onrender.com\n• https://app1.netlify.app -> https://app2.netlify.app\n• http://192.168.28.132:5000 -> http://192.168.28.131:3000" --> D{"How is the cookie configured?"}

    D -- "SameSite=Lax or SameSite=Strict" --> E["🛑 Browser DOES NOT attach cookie across different sites.\n(Note: Localhost services using IP trust or Basic Auth are still vulnerable!)"]
    D -- "SameSite=None; Secure\n(Required when frontend & backend live on different cloud domains,\nor for embedded widgets)" --> F["✅ Browser ATTACHES the cookie across different sites!"]

    C --> G{"What action does Tab 2 attempt?"}
    F --> G

    G -- "Action 1: Read JWT via document.cookie" --> H["🛑 BLOCKED!\nCookie belongs to Chat Server & is HttpOnly.\nTab 2 NEVER sees the raw JWT string."]

    G -- "Action 2: Call HTTP fetch('/api/ws-ticket')" --> I["🛑 BLOCKED BY BROWSER SAME-ORIGIN POLICY (CORS)!\nBecause Exact Origins differ (port 5000 != 3000, or blog != chat),\nthe browser hides the HTTP response from Tab 2."]

    G -- "Action 3: Call new WebSocket('ws://.../chat')" --> J{"Which Server Defense Mode is active?"}

    J -- "Mode 1: Vulnerable (Cookie Only)" --> K["🚨 HIJACKED (101 Switching Protocols)!\nServer trusts the attached cookie and ignores req.headers.origin.\nTab 2 receives live chat history and private messages!"]

    J -- "Mode 2: Origin Validation" --> L["🛡️ BLOCKED (403 Forbidden: Untrusted Origin)!\nServer checks req.headers.origin against ALLOWED_ORIGINS\nand destroys the socket before handshake completes."]

    J -- "Mode 3: Origin Validation + One-Time Ticket" --> M["🛡️🛡️ BLOCKED BY TWO LAYERS (Defense-in-Depth)!\n1. Origin header is rejected (403 Forbidden)\n2. Tab 2 cannot obtain a single-use ?ticket=<uuid> because\nfetch('/api/ws-ticket') is blocked by Browser SOP!"]
```

---

## 4. Critical Concept: "Same-Site" vs "Same-Origin" (Why `SameSite=Strict` Is Not Enough)

One of the most common misunderstandings in web security is thinking that **Site** and **Origin** mean the same thing. **They do not!**

| Feature | **SITE** (Used by `SameSite` Cookies) | **ORIGIN** (Used by `fetch` SOP & `Origin` Header) |
| :--- | :--- | :--- |
| **What parts of the URL are checked?** | `scheme` + `root domain` **ONLY** | `scheme` + **exact subdomain** + `root domain` + **exact port** |
| **Are ports checked?** | ❌ **NO** (Port `3000` and Port `5000` are the **Same Site**) | ✅ **YES** (Port `3000` and Port `5000` are **Different Origins**) |
| **Are subdomains checked?** | ❌ **NO** (`blog.company.com` and `chat.company.com` are the **Same Site**) | ✅ **YES** (`blog.company.com` and `chat.company.com` are **Different Origins**) |
| **What about shared cloud domains (`*.netlify.app`, `*.vercel.app`, `*.azurewebsites.net`)?** | Listed on the **Public Suffix List (PSL)**, so `a.netlify.app` and `b.netlify.app` are treated as **Different Sites** | Treated as **Different Origins** |
| **What about two raw IP addresses (`192.168.28.131` vs `192.168.28.132`)?** | Treated as **Different Sites** (no shared root domain) | Treated as **Different Origins** |

### Why This Matters:
Suppose a company or university hosts its private chat on `chat.company.com` (even with `SameSite=Strict`!) and has a public blog or student page on `blog.company.com`:
1. **Does `blog.company.com` have the user's token?** **No.**
2. **Can `blog.company.com` use `fetch("https://chat.company.com/api/...")`?** **No** — blocked by **Origin** check (Same-Origin Policy).
3. **Can `blog.company.com` hijack `new WebSocket("wss://chat.company.com/chat")`?** **YES!** Because `blog.company.com` and `chat.company.com` share `.company.com` (**Same-Site**), the browser attaches the cookie even when `SameSite=Strict` is set!

---

## 5. How the 3 Modes Work in Code (Step-by-Step)

Our server ([`vm1-chat-server/server.js`](vm1-chat-server/server.js)) lets you switch between **3 modes** live from the browser UI:

### Mode 1: `1. Vulnerable (Cookie Only)`
```mermaid
sequenceDiagram
    participant Tab2 as External Origin (Port 5000)
    participant Server as Chat Server (Port 3000)

    Tab2->>Server: GET /chat (Upgrade: websocket)<br/>Origin: http://localhost:5000<br/>Cookie: session_token=<JWT>
    Note over Server: Checks Cookie only.<br/>Ignores Origin header!
    Server-->>Tab2: HTTP/1.1 101 Switching Protocols
    Server-->>Tab2: Streams chat history & live messages
```
- **Code in `server.js`:** Parses `req.headers.cookie`, verifies the JWT, and calls `wss.handleUpgrade(...)` without checking `req.headers.origin`.

---

### Mode 2: `2. Origin Validation`
```mermaid
sequenceDiagram
    participant Tab2 as External Origin (Port 5000)
    participant Server as Chat Server (Port 3000)

    Tab2->>Server: GET /chat (Upgrade: websocket)<br/>Origin: http://localhost:5000<br/>Cookie: session_token=<JWT>
    Note over Server: Checks req.headers.origin against ALLOWED_ORIGINS.<br/>"http://localhost:5000" is NOT in allowlist!
    Server-->>Tab2: HTTP/1.1 403 Forbidden: Untrusted Origin (Socket Destroyed)
```
- **Code in `server.js`:**
  ```javascript
  const origin = req.headers.origin;
  if (!origin || !config.ALLOWED_ORIGINS.includes(origin)) {
    return rejectUpgrade(socket, 403, 'Forbidden: Untrusted Origin');
  }
  ```
- **Why the attacker cannot bypass this from a browser:** The `Origin` header is set by the browser engine itself and is a forbidden header in JavaScript—client-side scripts cannot spoof or remove it.

---

### Mode 3: `3. Origin + One-Time Ticket` (Defense-in-Depth)
Why add a **One-Time Ticket** on top of Origin Validation?
1. In production, reverse proxies (like Nginx or AWS Load Balancers) are sometimes misconfigured to overwrite the `Origin` header (`proxy_set_header Origin $host`), accidentally bypassing Origin Validation.
2. Relying on automatic cookies ("ambient credentials") for WebSocket upgrades means the server isn't verifying that the page opening the WebSocket can actually pass the browser's **Same-Origin Policy (SOP)**.

```mermaid
sequenceDiagram
    participant Tab1 as Trusted Chat Tab (Port 3000)
    participant Tab2 as External Origin Tab (Port 5000)
    participant Server as Chat Server (Port 3000)

    Note over Tab1,Server: Legitimate Client Flow (Port 3000)
    Tab1->>Server: 1. POST /api/ws-ticket (Same-Origin HTTP request)
    Server-->>Tab1: 2. Returns { ticket: "uuid-1234" } (Valid for 15 seconds)
    Tab1->>Server: 3. GET /chat?ticket=uuid-1234 (Upgrade: websocket)
    Note over Server: Checks Origin == localhost:3000 ✅<br/>Verifies ticket "uuid-1234" & DELETES it immediately ✅
    Server-->>Tab1: 4. HTTP/1.1 101 Switching Protocols

    Note over Tab2,Server: External Origin Flow (Port 5000)
    Tab2->>Server: 1. POST http://localhost:3000/api/ws-ticket
    Server-->>Tab2: 2. Browser SOP / CORS BLOCKS Tab 2 from reading the ticket response!
    Tab2->>Server: 3. GET /chat (Upgrade: websocket without valid ticket)
    Server-->>Tab2: 4. HTTP/1.1 403 Forbidden (Blocked by Origin Check + Ticket Check)
```

- **How it works in code:**
  1. **Ticket Endpoint (`POST /api/ws-ticket` in `server.js`):** Verifies the user's JWT cookie on a normal HTTP POST request, generates a random `crypto.randomUUID()` ticket valid for **15 seconds**, stores `ticket -> { user, expiresAt }` in a server-side `Map`, and returns `{ ticket }`.
  2. **Why external origins cannot get a ticket:** Because `POST /api/ws-ticket` is a normal HTTP request, the browser's **Same-Origin Policy (SOP)** blocks any external origin (`localhost:5000` or `blog.company.com`) from reading the JSON response!
  3. **Single-Use Burning on Upgrade:** When the client connects to `ws://localhost:3000/chat?ticket=<uuid>`, `server.on('upgrade')` first validates `req.headers.origin`, then looks up the ticket in the `Map`, **immediately deletes it (`tickets.delete(ticketId)`)** so it can never be replayed, checks that `Date.now() <= record.expiresAt`, and upgrades the connection without using cookies at all.

---

## 6. Frequently Asked Questions (Reviewer & Exam Q&A)

<details>
<summary><strong>Q1: Why don't developers just send an <code>Authorization: Bearer &lt;JWT&gt;</code> header on WebSockets instead of using cookies?</strong></summary>

Because the browser's built-in JavaScript `new WebSocket(url)` API **does not have a `headers` option**! Unlike `fetch(url, { headers: { Authorization: '...' } })`, browsers do not allow JavaScript to attach custom HTTP headers like `Authorization` to a WebSocket handshake. That is why developers fall back to cookies—or use the **One-Time Ticket pattern** in the URL query string (`?ticket=<uuid>`).
</details>

<details>
<summary><strong>Q2: Why doesn't Express <code>app.use(cors(...))</code> protect WebSockets automatically?</strong></summary>

1. Express middleware (`app.use(cors(...))`) only runs on standard HTTP routes (`GET`, `POST`, etc.)—it **never runs** on raw HTTP `upgrade` events (`server.on('upgrade')`).
2. Browsers do **not** perform CORS preflight (`OPTIONS`) checks or enforce `Access-Control-Allow-Origin` on `new WebSocket()` connections.
</details>

<details>
<summary><strong>Q3: What if a service uses <code>SameSite=Strict</code> on its cookies—is there still any way a WebSocket can be hijacked while HTTP <code>fetch()</code> is blocked?</strong></summary>

Yes, in **two major ways**:
1. **Same-Site Subdomains or Ports:** As shown in the table above, `SameSite=Strict` only checks the root domain (`*.company.com` or `localhost`). Any compromised or user-hosted sibling subdomain (`blog.company.com`) or different port (`localhost:5000`) is considered **Same-Site** by the browser, so `SameSite=Strict` cookies are **still sent** on WebSocket upgrades, while `fetch()` is blocked by the Same-Origin Policy!
2. **Non-Cookie Ambient Auth / Localhost Services:** `SameSite=Strict` only applies to cookies. Localhost developer tools/daemons (`ws://localhost:port`) that trust local connections, or intranet apps using HTTP Basic Auth / Windows Integrated Auth (NTLM/Kerberos) or client TLS certificates, still allow cross-origin WebSocket connections while blocking `fetch()` via SOP.
</details>

---

## 7. Project Structure

```text
cross-site-websocket-eavedropping/
├── README.md                              # Complete project documentation & visual mindmap (this file)
├── USER_GUIDE.md                          # Step-by-step usage guide & all VM/browser adjustments explained
├── visual-mindmap.html                    # Interactive visual cheat-sheet (open in any browser!)
├── SECURITY_CONCEPTS_AND_MINDMAP.md       # Quick revision notes
├── BEYOND_COOKIES_BASIC_AUTH_AND_NTLM.md  # Deep-dive: HTTP Basic Auth, Windows NTLM/Kerberos & Localhost CSWSH
├── CODE_AND_LAB_GUIDE.md                  # Code walkthrough & 3-VM Host-Only setup guide
├── vm1-chat-server/                   # Trusted Chat Application (Port 3000)
│   ├── package.json
│   ├── .env.example
│   ├── config.js                      # Server & defense configuration
│   ├── server.js                      # Express + ws backend with 3 switchable modes
│   └── public/
│       └── index.html                 # Chat UI + live Defense Mode switcher
└── vm2-external-server/               # External Origin Diagnostic Server (Port 5000)
    ├── .env.example
    ├── server.js                      # Zero-dependency HTTP server on port 5000
    └── public/
        └── index.html                 # Diagnostic client testing cross-origin WS & SOP
```

---

## 8. Quick Start (Run Locally or in VMs)

### 1. Start the Chat Server (Port 3000)
```bash
cd vm1-chat-server
npm install
npm start
```

### 2. Start the External Origin Diagnostic Server (Port 5000)
```bash
cd vm2-external-server
node server.js
```

### 3. Test All 3 Modes in Your Browser
1. Open **`http://localhost:3000`** in Tab 1 and log in (`alice@example.com` / `password123`).
2. Open **`http://localhost:5000`** in Tab 2.
3. Switch between **Mode 1 (Vulnerable)**, **Mode 2 (Origin Validation)**, and **Mode 3 (Origin + One-Time Ticket)** in Tab 1, and click **1. Test Cross-Origin WS Handshake** and **2. Test Cross-Origin Ticket Fetch (SOP Test)** in Tab 2 to observe each defense in action!
