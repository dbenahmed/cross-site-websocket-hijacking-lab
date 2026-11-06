# Beyond Cookies: Why `SameSite=Strict` Cannot Stop CSWSH on HTTP Basic Auth, Windows Domain Auth (NTLM/Kerberos), and Localhost Services

A common question during cybersecurity reviews is:
> *"If we set `SameSite=Strict` on our cookies so cookies are never sent across different domains, doesn't that solve Cross-Site WebSocket Hijacking (CSWSH) completely?"*

**The answer is NO.** Even across two completely unrelated domains (like `https://random-game-site.com` and `http://internal-chat:3000`), there is an entire class of real-world applications where **`SameSite=Strict` does nothing at all**, **HTTP `fetch()` is still blocked by the browser**, and **only WebSockets are vulnerable** unless **Origin Validation** and **One-Time Tickets** are used.

---

## 1. Not Every Web Application Uses Cookies to Authenticate!

Public consumer apps (like Netflix or Instagram) usually store a session token inside a **Cookie** (`Set-Cookie: session_token=...`). The `SameSite=Strict` / `Lax` setting **only applies to Cookies**.

However, inside **corporations, banks, hospitals, universities, government networks, and developer machines**, many internal web portals and real-time tools do **not** use cookies. Instead, they use **Browser-Level Ambient Authentication**:

### Example A: HTTP Basic Authentication (`WWW-Authenticate: Basic`)
1. An employee opens an internal company portal or chat server (`http://internal-chat:3000`).
2. Instead of an HTML login form, the server replies with an HTTP header:
   ```http
   HTTP/1.1 401 Unauthorized
   WWW-Authenticate: Basic realm="Internal Corporate Chat"
   ```
3. The browser itself pops up a native system username/password dialog box.
4. Once the employee types their username and password once, **the browser caches those credentials in its internal memory**.
5. For the rest of the browser session, **every time any request is sent to `internal-chat:3000`**, the browser automatically attaches:
   ```http
   Authorization: Basic dXNlcjpwYXNzd29yZA==
   ```
   *(Notice: **There is no cookie!**)*

---

### Example B: Windows Domain Authentication (NTLM / Kerberos / Active Directory)
1. In almost every enterprise network using Microsoft Windows (Active Directory), an employee logs into their Windows laptop in the morning.
2. When they open Chrome or Edge to visit an internal company service (`http://company-intranet/chat`), they do not even see a login screen.
3. Chrome/Edge automatically authenticates them behind the scenes by attaching their Windows Domain ticket:
   ```http
   Authorization: Negotiate <Windows-Kerberos-or-NTLM-Ticket>
   ```
   *(Again: **There is no cookie!**)*

---

### Example C: Client TLS Certificates (mTLS) & Localhost Services (`127.0.0.1`)
1. **mTLS (Mutual TLS):** Corporate laptops often have a client certificate installed in the OS/browser keystore that the browser automatically presents during TLS handshakes.
2. **Localhost Services:** Developer tools, local AI dashboards, Docker/Kubernetes tools, and crypto wallets run local WebSocket servers on `ws://localhost:port` that trust connections coming from the local machine without cookies.

---

## 2. Step-by-Step: How the Breach Happens When `SameSite=Strict` Cannot Help

Imagine an employee is logged into `http://internal-chat:3000` (using HTTP Basic Auth or Windows Domain Auth) and opens a second tab to an external website on the internet: **`https://random-game-site.com`**.

Here is what happens when `random-game-site.com` tries two different methods to access `internal-chat:3000`:

```mermaid
sequenceDiagram
    participant External as Tab 2: https://random-game-site.com
    participant Browser as Employee's Browser
    participant CorpServer as Corporate Server (http://internal-chat:3000)

    Note over External,CorpServer: Method 1: Normal HTTP fetch() -> BLOCKED BY BROWSER SOP!
    External->>Browser: fetch("http://internal-chat:3000/api/messages", { credentials: "include" })
    Browser->>CorpServer: GET /api/messages (with Basic Auth / Windows Ticket)
    CorpServer-->>Browser: Returns JSON response (No CORS header for random-game-site.com)
    Browser--xExternal: BLOCKED BY SAME-ORIGIN POLICY! (External site CANNOT read the response)

    Note over External,CorpServer: Method 2: WebSocket -> SUCCEEDS (If no Origin / Ticket defense)!
    External->>Browser: new WebSocket("ws://internal-chat:3000/chat")
    Browser->>CorpServer: GET /chat (Upgrade: websocket)<br/>Browser AUTOMATICALLY attaches Authorization: Basic / Windows Ticket!
    Note over CorpServer: No cookies exist here, so SameSite=Strict has ZERO effect!
    CorpServer-->>External: HTTP/1.1 101 Switching Protocols
    CorpServer-->>External: Live private chat messages streamed to random-game-site.com!
```

---

## 3. Comparison: Why `fetch()` Fails While `new WebSocket()` Succeeds

| Question | Normal HTTP `fetch()` | `new WebSocket()` (Without Our Defenses) |
| :--- | :--- | :--- |
| **Does `SameSite=Strict` block the credentials?** | ❌ **No** — Basic Auth, NTLM/Kerberos, and mTLS do not use cookies, so `SameSite=Strict` does not exist for them. | ❌ **No** — Browser attaches Basic Auth / NTLM / Kerberos credentials automatically to the WebSocket upgrade. |
| **Does the External Site ever see the user's password or token?** | ❌ **No** — Cached inside the browser engine only. | ❌ **No** — Cached inside the browser engine only. |
| **Does the Browser allow the External Site to read the response?** | 🛑 **NO! Blocked by Browser Same-Origin Policy (SOP / CORS)** because `random-game-site.com` ≠ `internal-chat:3000`. | 🚨 **YES! Hijacked!** Because WebSockets do not enforce the Same-Origin Policy by default! |

---

## 4. How Our Project's Two Defenses Solve This Completely

Even when an application uses HTTP Basic Auth, Windows Domain Auth (NTLM/Kerberos), mTLS, or localhost trust (where `SameSite=Strict` has zero effect):

1. **Defense 1 — Strict Origin Validation (`Mode 2` & `Mode 3`):**
   - When `https://random-game-site.com` initiates `new WebSocket("ws://internal-chat:3000/chat")`, the employee's browser automatically sets the HTTP header:
     ```http
     Origin: https://random-game-site.com
     ```
   - The server checks `req.headers.origin` against `ALLOWED_ORIGINS` (`['http://internal-chat:3000']`), sees that `https://random-game-site.com` is untrusted, and immediately terminates the socket with `HTTP/1.1 403 Forbidden`.

2. **Defense 2 — Single-Use Ephemeral Ticket (`Mode 3`):**
   - To open a WebSocket, the client must first make a standard HTTP `fetch()` call to `POST http://internal-chat:3000/api/ws-ticket` to obtain a 15-second, single-use UUID (`?ticket=<uuid>`).
   - Because `fetch()` **IS** governed by the browser's **Same-Origin Policy (SOP)**, `https://random-game-site.com` is **blocked by the browser** from reading the `/api/ws-ticket` response—even if the browser attached Basic Auth or Windows Domain credentials!
   - Without a valid ticket UUID, the WebSocket upgrade is rejected immediately.
