# Presentation Slide-by-Slide Plan: Cross-Site WebSocket Hijacking (CSWSH) & Defenses

This 10-slide structure is designed to tell a clear, logical story:
1. **Slides 1–2:** Set the stage (What are WebSockets & how does Cookie/JWT login work?).
2. **Slides 3–5:** Explain the problem simply ("Why does the browser block HTTP `fetch()` automatically, but allow `new WebSocket()`?").
3. **Slide 6:** Show your 3-VM lab architecture.
4. **Slides 7–8:** Explain your two defenses (Origin Validation & Single-Use Tickets).
5. **Slides 9–10:** Live Demonstration & Key Takeaways.

---

## Slide 1: Title & Project Overview
- **Slide Goal:** Introduce the project topic, your name, and the core security problem in one sentence.
- **On-Screen Content:**
  - **Title:** Cross-Site WebSocket Hijacking (CSWSH) and Real-Time Eavesdropping: Detection & Defense Using Origin Validation and Single-Use Tickets
  - **Subtitle:** Securing Real-Time Node.js WebSocket Applications Against Ambient Credential Hijacking
  - **3 Key Pillars (Icons/Boxes):**
    1. **The Problem:** WebSockets bypass the browser's Same-Origin Policy by default.
    2. **The Impact:** Live message eavesdropping & impersonation without stealing the user's token.
    3. **The Solution:** Strict Origin Enforcement + 15-Second Single-Use Cryptographic Tickets.

---

## Slide 2: Background — HTTP vs. WebSockets & Cookie Authentication
- **Slide Goal:** Make sure everyone in the room understands how a WebSocket starts and how cookies work.
- **On-Screen Content:**
  - **What is a WebSocket?** Unlike standard HTTP (request → response → close), a WebSocket starts as an **HTTP `GET` request with `Upgrade: websocket`** and stays open as a permanent 2-way tunnel (`101 Switching Protocols`).
  - **Why Developers Use Cookies for WebSockets:**
    - When a user logs in, the server issues an `HttpOnly` cookie containing a signed **JWT (`session_token`)**.
    - Browser JavaScript `new WebSocket(url)` **does not allow custom `Authorization: Bearer` headers**, so developers rely on the browser automatically attaching cookies during the WebSocket handshake.
- **Visual / Diagram on Slide:**
  ```mermaid
  sequenceDiagram
      participant Browser as User Browser
      participant Server as Chat Server (Node.js + ws)
      Browser->>Server: 1. POST /api/login (email, password)
      Server-->>Browser: 2. Set-Cookie: session_token=<JWT>; HttpOnly
      Browser->>Server: 3. GET /chat (Upgrade: websocket + Cookie auto-attached!)
      Server-->>Browser: 4. 101 Switching Protocols (2-Way Live Stream Open)
  ```

---

## Slide 3: The "Lightbulb Moment" — Why HTTP Is Safe by Default, While WebSockets Are Vulnerable!
- **Slide Goal:** This is the most important slide in the presentation. Show *why* developers fall into this trap!
- **On-Screen Content:**
  - **Suppose a developer writes ZERO Origin-checking code on the server:**
    - **What happens in Normal HTTP (`fetch`)?**
      If an external tab calls `fetch("https://chat-server/api/me", { credentials: "include" })`, the server responds, **but the BROWSER throws the response in the trash automatically** (`Blocked by CORS policy`)!
    - **What happens in WebSockets (`new WebSocket`)?**
      By design (RFC 6455), **the browser does NOT block cross-origin WebSockets**, and Node.js `ws` accepts **all Origins** by default!
- **Visual / Table on Slide:**

| If a Developer Writes ZERO Origin Code... | Normal HTTP (`fetch`) | WebSockets (`new WebSocket`) |
| :--- | :--- | :--- |
| **Does Attacker ever see the JWT string?** | ❌ **No** (`HttpOnly` cookie) | ❌ **No** (`HttpOnly` cookie) |
| **Does Server think it's the real user?** | ✅ **Yes** (Cookie is attached) | ✅ **Yes** (Cookie is attached) |
| **What does the BROWSER do by default?** | 🛡️ **BLOCKS IT AUTOMATICALLY!** (CORS) | 🚨 **ALLOWS IT AUTOMATICALLY!** |
| **What does Node.js (`express` vs `ws`) do?** | 🛡️ **Safe by default** | 🚨 **Vulnerable by default!** |

---

## Slide 4: Step-by-Step Anatomy of the CSWSH Attack
- **Slide Goal:** Walk through how the external page hijacks the victim's live chat stream **without ever stealing or knowing the JWT token**.
- **On-Screen Content:**
  1. **Victim (Alice)** is logged into the trusted Chat Server in **Tab 1**.
  2. **Alice** opens an external website in **Tab 2**.
  3. **Tab 2** cannot read `document.cookie` (empty!) and cannot call `fetch()` (blocked by CORS!).
  4. **Tab 2** executes `new WebSocket("wss://chat-server/chat")`.
  5. **Alice's own browser** automatically attaches Alice's cookie to that WebSocket handshake!
  6. The Chat Server upgrades the connection (`101`), streaming Alice's private messages directly to Tab 2 in real time.
- **Visual / Diagram on Slide:**
  ```mermaid
  sequenceDiagram
      participant Tab1 as Tab 1: Trusted Chat App
      participant Tab2 as Tab 2: External Website
      participant Server as Chat Server (Vulnerable Mode)

      Tab1->>Server: Logged in as Alice (Browser stores HttpOnly JWT cookie)
      Note over Tab2: Alice visits External Website in Tab 2
      Tab2->>Server: new WebSocket("wss://chat-server/chat")<br/>Browser auto-attaches Alice's Cookie!
      Note over Server: Server checks Cookie ✅<br/>Ignores Origin: https://external-site ❌
      Server-->>Tab2: 101 Switching Protocols (Live Eavesdropping & Impersonation!)
  ```

---

## Slide 5: Real-World Impact — "Wait, Doesn't `SameSite` Fix This?"
- **Slide Goal:** Preempt the #1 question professors/reviewers ask and show the 3 real-world places where `SameSite=Lax` and `SameSite=Strict` fail.
- **On-Screen Content:**
  - **Key Rule: "Same-Site" ≠ "Same-Origin"!**
    - `SameSite` cookies only check the **root domain** (ignoring subdomains and ports!), whereas `Origin` checks the **exact subdomain and port**.
  - **3 Real-World Scenarios Where CSWSH Happens Today:**
    1. **Sibling Subdomains & Ports (Even with `SameSite=Strict`!):**
       `blog.university.edu` or `club.company.com` can hijack `wss://chat.university.edu/chat` because they share `.university.edu` (Same-Site!), even while `fetch()` is blocked by SOP!
    2. **Cloud Deployments & Embedded Widgets (`SameSite=None`):**
       Customer support chat widgets (Intercom, Zendesk), Shopify/Slack embeds, and decoupled cloud apps (`vercel.app` + `onrender.com`) must use `SameSite=None; Secure`.
    3. **Non-Cookie Auth (`localhost` Tools & Corporate Windows Login):**
       Developer tools on `ws://localhost:port` and corporate apps using HTTP Basic Auth / Windows Active Directory (NTLM/Kerberos) don't use cookies at all!

---

## Slide 6: Our 3-VM Host-Only Lab Architecture
- **Slide Goal:** Show your practical implementation across 3 isolated Virtual Machines.
- **On-Screen Content:**
  - **VM 1 (`192.168.28.131:3000`):** Node.js + Express + `ws` Chat Server (HTTPS / WSS).
  - **VM 2 (`192.168.28.132:5000`):** External Origin Diagnostic Server (HTTPS).
  - **VM 3 (Client VM):** Victim's Browser logged into VM 1 and visiting VM 2.
- **Visual / Diagram on Slide:**
  ```mermaid
  flowchart LR
      subgraph VM3["VM 3: Victim Client Browser"]
          T1["Tab 1: https://192.168.28.131:3000"]
          T2["Tab 2: https://192.168.28.132:5000"]
      end
      subgraph VM1["VM 1: Chat Server (.131:3000)"]
          S1["Express + ws Server\n(4 Switchable Modes)"]
      end
      subgraph VM2["VM 2: External Server (.132:5000)"]
          S2["Cross-Origin Diagnostic Page"]
      end
      T1 -- "1. Login & Legitimate WSS" --> S1
      T2 -- "2. Loads External Page" --> S2
      T2 -- "3. Cross-Origin WSS Handshake" --> S1
  ```

---

## Slide 7: Defense 1 — Strict Server-Side Origin Validation
- **Slide Goal:** Explain how the first defense works at the HTTP `upgrade` door and why client-side JavaScript cannot fake it.
- **On-Screen Content:**
  - **How It Works:**
    1. Every browser automatically stamps the `Origin` HTTP header on `new WebSocket()` (e.g., `Origin: https://192.168.28.132:5000`).
    2. `Origin` is a **forbidden header** in browser JavaScript—attacker code cannot spoof or remove it.
    3. We initialize `new WebSocketServer({ noServer: true })` and intercept `server.on('upgrade')` **before** completing the handshake.
    4. If `req.headers.origin` is not in `ALLOWED_ORIGINS`, we write `HTTP/1.1 403 Forbidden` directly to the raw socket and destroy it.
- **Code Snippet on Slide:**
  ```javascript
  if (!req.headers.origin || !config.ALLOWED_ORIGINS.includes(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden: Untrusted Origin\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  ```

---

## Slide 8: Defense 2 — Single-Use Ephemeral Ticket Pattern (15s TTL)
- **Slide Goal:** Explain why Origin Validation alone isn't enough (e.g. reverse proxy misconfigurations) and prove why the One-Time Ticket is mathematically unbeatable.
- **On-Screen Content:**
  - **How It Works:**
    1. We **stop trusting cookies** during the WebSocket `upgrade` event completely!
    2. Before connecting, the client must call an HTTP endpoint: `POST /api/ws-ticket`.
    3. The server verifies the user's cookie on that HTTP request, generates a random `crypto.randomUUID()` ticket valid for **15 seconds**, stores it in a `Map`, and returns `{ ticket }`.
    4. The client connects to `wss://.../chat?ticket=<uuid>`, and the server **immediately deletes (`tickets.delete(ticketId)`)** the ticket on first use!
  - **Why the Attacker Can NEVER Get or Reuse a Ticket:**
    - **Cannot request a new ticket:** Because `POST /api/ws-ticket` is a normal HTTP `fetch()` request, the **Browser Same-Origin Policy (CORS)** blocks Tab 2 from reading the response!
    - **Cannot reuse an old ticket:** The ticket is burned the instant Tab 1 connects!
- **Visual / Diagram on Slide:**
  ```mermaid
  flowchart TD
      A["Client wants to open WebSocket"] --> B["Step 1: POST /api/ws-ticket (Standard HTTP)"]
      B --> C{"Is Caller Same-Origin?"}
      C -- "No (External Tab 2)" --> D["🛑 BLOCKED BY BROWSER CORS!\nExternal tab cannot read the ticket UUID!"]
      C -- "Yes (Trusted Tab 1)" --> E["✅ Reads { ticket: 'uuid' } (15s TTL)"]
      E --> F["Step 2: wss://.../chat?ticket=uuid"]
      F --> G["🛡️ Server verifies ticket & DELETES it immediately (Single-Use)!"]
  ```

---

## Slide 9: Live Demonstration Matrix (The 4 Modes)
- **Slide Goal:** Guide the audience through what they are about to see in your live demo (or screenshots).
- **On-Screen Content:**

| Mode | Server Checks Performed | Legitimate Chat Tab (`.131:3000`) | External Tab (`.132:5000`) |
| :--- | :--- | :--- | :--- |
| **1. Vulnerable** | Cookie Only | ✅ Connected (`101`) | 🚨 **HIJACKED (`101`) — Intercepts live chat!** |
| **2. Origin Only** | `req.headers.origin` + Cookie | ✅ Connected (`101`) | 🛡️ **BLOCKED (`403 Forbidden: Untrusted Origin`)** |
| **3. Ticket Only** | 15s Single-Use `?ticket=<uuid>` | ✅ Connected (`101`) | 🛡️ **BLOCKED (`403 Forbidden: Invalid Ticket`)** |
| **4. Both (Defense-in-Depth)** | `Origin` Allowlist **+** Single-Use Ticket | ✅ Connected (`101`) | 🛡️🛡️ **BLOCKED BY BOTH LAYERS (`403`)** |

---

## Slide 10: Conclusion & Key Takeaways
- **Slide Goal:** Leave the audience and grading panel with 3 memorable security lessons.
- **On-Screen Content:**
  1. **Never Assume CORS Protects WebSockets:** Express `cors()` middleware and browser SOP protect `fetch()`, **not** `new WebSocket()`.
  2. **Never Rely on Cookies Alone (`SameSite` ≠ `Same-Origin`):** Subdomains, decoupled cloud apps, and non-cookie auth require explicit handshake validation.
  3. **Defense-in-Depth (`Origin` + `One-Time Ticket`):** Validating `req.headers.origin` stops cross-origin handshakes at the door, and replacing ambient cookies with a SOP-protected, single-use 15-second ticket brings full Same-Origin Policy protection to WebSockets.
