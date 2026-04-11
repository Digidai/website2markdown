/**
 * Developer Portal — single-page HTML served by the Worker.
 *
 * Routes handled client-side:
 *   /portal/           — login (if no session) or dashboard
 *   /portal/keys       — API key management
 *   /portal/settings   — account settings
 *
 * Auth flow:
 *   1. GET /portal/ → HTML page
 *   2. JS calls /api/me → 401 = show login form, 200 = show dashboard
 *   3. Login form POST /api/auth/magic-link → "check your email"
 *   4. User clicks email link → /api/auth/verify → sets cookie → redirects /portal/
 *   5. Reload → /api/me → 200 → dashboard
 *
 * Design system tokens match src/templates/landing.ts and DESIGN.md.
 */

export function portalPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Developer Portal — md.genedai.me</title>
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #f7f7f4;
  --bg-surface: #f2f1ed;
  --bg-elevated: #eae9e4;
  --text-primary: #26251e;
  --text-secondary: rgba(38,37,30,0.6);
  --text-muted: rgba(38,37,30,0.45);
  --accent: #22d3ee;
  --accent-hover: #06b6d4;
  --accent-text: #0e7490;
  --border: rgba(0,0,0,0.06);
  --danger: #ef4444;
  --success: #22c55e;
  --warning: #f59e0b;
  --font-display: 'Instrument Serif', Georgia, serif;
  --font-body: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --radius: 4px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14120b;
    --bg-surface: #1c1a14;
    --bg-elevated: #191b22;
    --text-primary: #edecec;
    --text-secondary: rgba(237,236,236,0.6);
    --text-muted: rgba(237,236,236,0.3);
    --accent-text: #22d3ee;
    --border: rgba(255,255,255,0.06);
    --danger: #f87171;
    --success: #4ade80;
    --warning: #fbbf24;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--font-body);
  color: var(--text-primary);
  background: var(--bg);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent-text); text-decoration: none; }
a:hover { text-decoration: underline; }
code, .mono { font-family: var(--font-mono); font-size: 0.92em; }
button {
  font-family: inherit;
  font-size: 15px;
  cursor: pointer;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  padding: 8px 16px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-weight: 500;
  min-height: 36px;
  transition: background 0.15s;
}
button:hover { background: var(--bg-surface); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary {
  background: var(--accent);
  color: #0e7490;
  border-color: var(--accent);
}
button.primary:hover { background: var(--accent-hover); }
button.danger {
  background: transparent;
  color: var(--danger);
  border-color: var(--danger);
}
button.danger:hover { background: rgba(239,68,68,0.08); }
input[type="email"], input[type="text"] {
  font-family: inherit;
  font-size: 15px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text-primary);
  width: 100%;
  min-height: 40px;
}
input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

/* ─── Layout ─── */
.app { min-height: 100vh; }
.app.dashboard { display: grid; grid-template-columns: 240px 1fr; }
.sidebar {
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.brand {
  font-family: var(--font-display);
  font-size: 22px;
  font-style: italic;
  margin: 0 0 24px;
  padding: 0 8px;
}
.brand a { color: var(--text-primary); text-decoration: none; }
.nav-item {
  padding: 8px 12px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
  border-left: 2px solid transparent;
  background: transparent;
  border-top: none;
  border-right: none;
  border-bottom: none;
  text-align: left;
  font-size: 14px;
  width: 100%;
  min-height: 36px;
}
.nav-item:hover { background: var(--bg-elevated); }
.nav-item.active {
  color: var(--accent-text);
  border-left-color: var(--accent);
  background: var(--bg-elevated);
  font-weight: 500;
}
.main {
  padding: 32px 40px;
  max-width: 900px;
  width: 100%;
}
.main h1 {
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: normal;
  margin: 0 0 8px;
}
.main .lead {
  color: var(--text-secondary);
  margin: 0 0 32px;
}
.section {
  margin-bottom: 40px;
}
.section h2 {
  font-family: var(--font-body);
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin: 0 0 12px;
  font-weight: 600;
}

/* ─── Cards / Tiles ─── */
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.tile {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 24px;
}
.tile-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.tile-value {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 500;
  color: var(--text-primary);
}
.tile-subvalue {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}
.tier-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tier-badge.free { background: var(--bg-elevated); color: var(--text-secondary); }
.tier-badge.pro { background: var(--accent); color: #0e7490; }

/* ─── Usage bar ─── */
.quota-bar {
  width: 100%;
  height: 8px;
  background: var(--bg-elevated);
  border-radius: var(--radius);
  overflow: hidden;
  margin: 12px 0 8px;
}
.quota-bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s;
}
.quota-bar-fill.warning { background: var(--warning); }
.quota-bar-fill.danger { background: var(--danger); }

/* ─── Key table ─── */
table.keys {
  width: 100%;
  border-collapse: collapse;
}
table.keys th, table.keys td {
  text-align: left;
  padding: 12px 8px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}
table.keys th {
  font-weight: 500;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
table.keys td.mono { font-family: var(--font-mono); font-size: 13px; }
table.keys tbody tr:hover { background: var(--bg-surface); }
.status-active { color: var(--success); font-size: 13px; }
.status-revoked { color: var(--text-muted); font-size: 13px; }

/* ─── Login page ─── */
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.login-card {
  width: 100%;
  max-width: 400px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 40px 32px;
}
.login-card h1 {
  font-family: var(--font-display);
  font-size: 28px;
  margin: 0 0 8px;
  font-weight: normal;
}
.login-card .lead {
  color: var(--text-secondary);
  margin: 0 0 24px;
  font-size: 14px;
}
.login-card label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.login-card button[type="submit"] { width: 100%; margin-top: 12px; }
.login-card .oauth-divider {
  text-align: center;
  margin: 24px 0 16px;
  color: var(--text-muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.login-card .hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 16px;
}

/* ─── Modal ─── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 100;
}
.modal {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px;
  max-width: 520px;
  width: 100%;
}
.modal h2 {
  font-family: var(--font-display);
  font-size: 24px;
  margin: 0 0 8px;
  font-weight: normal;
}
.modal .key-display {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  font-family: var(--font-mono);
  font-size: 13px;
  word-break: break-all;
  margin: 16px 0;
  user-select: all;
}
.modal .warning {
  color: var(--warning);
  font-size: 14px;
  margin: 12px 0 0;
}
.modal .confirm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 0 16px;
  font-size: 14px;
}
.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 16px;
}

/* ─── Feedback / errors ─── */
.banner {
  padding: 12px 16px;
  border-radius: var(--radius);
  font-size: 14px;
  margin-bottom: 16px;
}
.banner.error { background: rgba(239,68,68,0.08); color: var(--danger); border: 1px solid rgba(239,68,68,0.2); }
.banner.success { background: rgba(34,197,94,0.08); color: var(--success); border: 1px solid rgba(34,197,94,0.2); }
.banner.info { background: var(--bg-surface); color: var(--text-secondary); border: 1px solid var(--border); }

/* ─── Empty state ─── */
.empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 14px;
}
.empty p { margin: 0 0 12px; }

/* ─── Responsive ─── */
@media (max-width: 768px) {
  .app.dashboard { grid-template-columns: 1fr; }
  .sidebar {
    position: sticky;
    top: 0;
    flex-direction: row;
    overflow-x: auto;
    padding: 12px 16px;
    gap: 2px;
    z-index: 10;
  }
  .brand { display: none; }
  .nav-item { flex-shrink: 0; }
  .main { padding: 20px; }
  .row { grid-template-columns: 1fr; }
  .main h1 { font-size: 28px; }
}

/* ─── Utility ─── */
.hidden { display: none !important; }
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  vertical-align: middle;
}
@keyframes spin { to { transform: rotate(360deg); } }
.skeleton {
  background: linear-gradient(90deg, var(--bg-surface), var(--bg-elevated), var(--bg-surface));
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
  border-radius: var(--radius);
  height: 20px;
}
@keyframes shimmer { to { background-position: -200% 0; } }
</style>
</head>
<body>
<div id="app"><div class="login-wrap"><div class="skeleton" style="width:200px;height:40px"></div></div></div>

<script>
/* Portal client — single file, no build step, no framework.
   Handles routing, auth state, and API calls. */
(function(){
  const API = {
    me: () => fetch("/api/me", { credentials: "same-origin" }),
    usage: () => fetch("/api/usage", { credentials: "same-origin" }),
    keys: () => fetch("/api/keys", { credentials: "same-origin" }),
    createKey: (name) => fetch("/api/keys", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
    revokeKey: (id) => fetch("/api/keys/" + encodeURIComponent(id), {
      method: "DELETE",
      credentials: "same-origin",
    }),
    sendMagicLink: (email) => fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
    logout: () => fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }),
  };

  const state = {
    session: null,
    view: "dashboard", // dashboard | keys | settings
    keys: [],
    usage: null,
    modalKey: null,
  };

  const app = document.getElementById("app");
  const $ = (html) => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el.firstElementChild;
  };

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function getUrlParam(name) {
    return new URL(location.href).searchParams.get(name);
  }

  // ─── Views ─────────────────────────────────────

  function renderLogin(banner) {
    app.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "login-wrap";
    const card = document.createElement("div");
    card.className = "login-card";
    card.innerHTML = \`
      <h1>Developer <em>Portal</em></h1>
      <p class="lead">Sign in to manage your API keys and view usage.</p>
      <div id="login-banner"></div>
      <form id="magic-form">
        <label for="email">Email</label>
        <input type="email" id="email" required placeholder="you@example.com" autocomplete="email">
        <button type="submit" class="primary" id="magic-submit">Send login link</button>
      </form>
      <div class="oauth-divider">or</div>
      <button disabled title="Coming soon">Sign in with GitHub</button>
      <p class="hint">Already have an API key? You can use it directly in the <code>Authorization: Bearer</code> header without signing in.</p>
    \`;
    wrap.appendChild(card);
    app.appendChild(wrap);

    if (banner) renderBanner("login-banner", banner.type, banner.text);

    document.getElementById("magic-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("email").value.trim();
      if (!email) return;
      const btn = document.getElementById("magic-submit");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Sending...';
      try {
        const resp = await API.sendMagicLink(email);
        const data = await resp.json();
        if (resp.ok) {
          renderBanner("login-banner", "success", "Check your email for the sign-in link. It expires in 15 minutes.");
        } else {
          renderBanner("login-banner", "error", data.error || "Failed to send link");
        }
      } catch (err) {
        renderBanner("login-banner", "error", "Network error. Try again.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Send login link";
      }
    });
  }

  function renderBanner(containerId, type, text) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = \`<div class="banner \${type}">\${escapeHtml(text)}</div>\`;
  }

  function renderShell() {
    app.innerHTML = "";
    const shell = document.createElement("div");
    shell.className = "app dashboard";
    shell.innerHTML = \`
      <aside class="sidebar">
        <h1 class="brand"><a href="/">md.genedai.me</a></h1>
        <button class="nav-item \${state.view === "dashboard" ? "active" : ""}" data-view="dashboard">Dashboard</button>
        <button class="nav-item \${state.view === "keys" ? "active" : ""}" data-view="keys">API Keys</button>
        <button class="nav-item \${state.view === "settings" ? "active" : ""}" data-view="settings">Settings</button>
      </aside>
      <main class="main" id="main"></main>
    \`;
    app.appendChild(shell);

    shell.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.view = btn.dataset.view;
        render();
      });
    });
  }

  function renderDashboard() {
    const main = document.getElementById("main");
    const u = state.usage || { tier: state.session.tier, quota: 0, used: 0, remaining: 0 };
    const pct = u.quota ? Math.min(100, Math.round((u.used / u.quota) * 100)) : 0;
    const barClass = pct >= 90 ? "danger" : pct >= 70 ? "warning" : "";
    main.innerHTML = \`
      <h1>Dashboard</h1>
      <p class="lead">Welcome back, \${escapeHtml(state.session.email)}.</p>
      <div class="section">
        <div class="row">
          <div class="tile">
            <div class="tile-label">Current Tier</div>
            <div class="tile-value"><span class="tier-badge \${u.tier}">\${u.tier}</span></div>
            <div class="tile-subvalue">Quota: \${u.quota.toLocaleString()} credits/mo</div>
          </div>
          <div class="tile">
            <div class="tile-label">Usage This Month</div>
            <div class="tile-value">\${u.used.toLocaleString()} <span style="font-size:14px;color:var(--text-muted)">/ \${u.quota.toLocaleString()}</span></div>
            <div class="quota-bar"><div class="quota-bar-fill \${barClass}" style="width:\${pct}%"></div></div>
            <div class="tile-subvalue">\${u.remaining.toLocaleString()} credits remaining</div>
          </div>
        </div>
      </div>
      <div class="section">
        <h2>Recent Keys</h2>
        <div id="recent-keys"></div>
      </div>
      <div class="section">
        <h2>Quick Start</h2>
        <p style="color:var(--text-secondary);font-size:14px;">Create an API key and start converting URLs:</p>
        <pre style="background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:16px;overflow-x:auto;font-family:var(--font-mono);font-size:13px;line-height:1.5;margin:0;"><code>curl -H "Authorization: Bearer mk_..." \\
  "https://md.genedai.me/https://example.com?raw=true"</code></pre>
      </div>
    \`;
    renderRecentKeys();
  }

  function renderRecentKeys() {
    const c = document.getElementById("recent-keys");
    if (!c) return;
    if (state.keys.length === 0) {
      c.innerHTML = \`
        <div class="empty">
          <p>No API keys yet.</p>
          <button class="primary" id="create-first-key">Create your first key</button>
        </div>
      \`;
      document.getElementById("create-first-key").addEventListener("click", () => {
        state.view = "keys";
        render();
        setTimeout(() => document.getElementById("create-key-btn")?.click(), 50);
      });
      return;
    }
    const recent = state.keys.slice(0, 3);
    c.innerHTML = renderKeyTable(recent);
    attachKeyTableHandlers(c);
  }

  function renderKeysView() {
    const main = document.getElementById("main");
    main.innerHTML = \`
      <h1>API Keys</h1>
      <p class="lead">Up to 10 active keys per account. Revoked keys can be removed.</p>
      <div id="keys-banner"></div>
      <div class="section">
        <button class="primary" id="create-key-btn">+ Create new key</button>
      </div>
      <div class="section">
        <div id="keys-table"></div>
      </div>
    \`;
    document.getElementById("create-key-btn").addEventListener("click", handleCreateKey);
    refreshKeysTable();
  }

  function refreshKeysTable() {
    const c = document.getElementById("keys-table");
    if (!c) return;
    if (state.keys.length === 0) {
      c.innerHTML = \`<div class="empty"><p>No keys yet. Click "Create new key" above.</p></div>\`;
      return;
    }
    c.innerHTML = renderKeyTable(state.keys);
    attachKeyTableHandlers(c);
  }

  function renderKeyTable(keys) {
    return \`
      <table class="keys">
        <thead>
          <tr><th>Name</th><th>Prefix</th><th>Created</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          \${keys.map((k) => \`
            <tr>
              <td>\${escapeHtml(k.name || "—")}</td>
              <td class="mono">\${escapeHtml(k.prefix)}</td>
              <td>\${formatDate(k.created_at)}</td>
              <td>\${k.active ? '<span class="status-active">● Active</span>' : '<span class="status-revoked">Revoked</span>'}</td>
              <td>\${k.active ? \`<button class="danger" data-revoke-id="\${escapeHtml(k.id)}">Revoke</button>\` : ""}</td>
            </tr>
          \`).join("")}
        </tbody>
      </table>
    \`;
  }

  function attachKeyTableHandlers(container) {
    container.querySelectorAll("[data-revoke-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.revokeId;
        if (!confirm("Revoke this key? This cannot be undone.")) return;
        btn.disabled = true;
        const resp = await API.revokeKey(id);
        if (resp.ok) {
          await loadKeys();
          if (state.view === "keys") refreshKeysTable();
          else render();
        } else {
          alert("Failed to revoke key");
          btn.disabled = false;
        }
      });
    });
  }

  async function handleCreateKey() {
    const name = prompt("Name for this key (optional, e.g. 'prod'):") || "";
    const btn = document.getElementById("create-key-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Creating..."; }
    try {
      const resp = await API.createKey(name.trim());
      const data = await resp.json();
      if (!resp.ok) {
        renderBanner("keys-banner", "error", data.message || data.error || "Failed to create key");
        return;
      }
      showKeyModal(data);
      await loadKeys();
      refreshKeysTable();
    } catch (err) {
      renderBanner("keys-banner", "error", "Network error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "+ Create new key"; }
    }
  }

  function showKeyModal(keyData) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = \`
      <div class="modal">
        <h2>Save your API key</h2>
        <p style="color:var(--text-secondary);font-size:14px;">This is the only time you'll see the full key. Store it somewhere safe.</p>
        <div class="key-display" id="key-value">\${escapeHtml(keyData.key)}</div>
        <button id="copy-btn">Copy to clipboard</button>
        <p class="warning">⚠ After closing, you cannot retrieve this key. Revoke and create a new one if you lose it.</p>
        <label class="confirm-row">
          <input type="checkbox" id="confirm-saved">
          I have saved this key securely
        </label>
        <div class="modal-actions">
          <button class="primary" id="modal-close-btn" disabled>Close</button>
        </div>
      </div>
    \`;
    document.body.appendChild(backdrop);

    const copyBtn = backdrop.querySelector("#copy-btn");
    const closeBtn = backdrop.querySelector("#modal-close-btn");
    const confirmBox = backdrop.querySelector("#confirm-saved");

    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(keyData.key);
        copyBtn.textContent = "Copied ✓";
        setTimeout(() => { copyBtn.textContent = "Copy to clipboard"; }, 2000);
      } catch {
        alert("Copy failed — select the key manually");
      }
    });

    confirmBox.addEventListener("change", () => {
      closeBtn.disabled = !confirmBox.checked;
    });

    closeBtn.addEventListener("click", () => {
      document.body.removeChild(backdrop);
    });
  }

  function renderSettings() {
    const main = document.getElementById("main");
    main.innerHTML = \`
      <h1>Settings</h1>
      <div class="section">
        <h2>Account</h2>
        <div class="tile">
          <div class="tile-label">Email</div>
          <div style="font-size:16px;">\${escapeHtml(state.session.email)}</div>
        </div>
      </div>
      <div class="section">
        <h2>Linked Auth</h2>
        <div class="tile">
          <p style="margin:0;color:var(--text-secondary);font-size:14px;">Magic Link (email) is currently your only sign-in method. GitHub OAuth is coming soon.</p>
        </div>
      </div>
      <div class="section">
        <h2>Danger Zone</h2>
        <button class="danger" id="logout-btn">Sign out</button>
      </div>
    \`;
    document.getElementById("logout-btn").addEventListener("click", async () => {
      await API.logout();
      state.session = null;
      renderLogin();
    });
  }

  // ─── Data loading ──────────────────────────────

  async function loadSession() {
    try {
      const resp = await API.me();
      if (resp.ok) {
        state.session = await resp.json();
        return true;
      }
    } catch {}
    return false;
  }

  async function loadUsage() {
    try {
      const resp = await API.usage();
      if (resp.ok) state.usage = await resp.json();
    } catch {}
  }

  async function loadKeys() {
    try {
      const resp = await API.keys();
      if (resp.ok) {
        const data = await resp.json();
        state.keys = data.keys || [];
      }
    } catch {}
  }

  function render() {
    if (!state.session) {
      renderLogin();
      return;
    }
    renderShell();
    if (state.view === "dashboard") renderDashboard();
    else if (state.view === "keys") renderKeysView();
    else if (state.view === "settings") renderSettings();
  }

  // ─── Boot ──────────────────────────────────────

  (async function boot() {
    const error = getUrlParam("error");
    const errorMessages = {
      invalid_token: "This sign-in link is invalid.",
      link_expired: "This sign-in link has expired. Please request a new one.",
      link_already_used: "This sign-in link has already been used.",
      service_unavailable: "Sign-in service is temporarily unavailable.",
      internal_error: "Something went wrong. Please try again.",
    };

    if (await loadSession()) {
      await Promise.all([loadUsage(), loadKeys()]);
      render();
      // Clear ?error from URL if we're now logged in
      if (error) history.replaceState(null, "", "/portal/");
    } else {
      const banner = error ? { type: "error", text: errorMessages[error] || "Sign-in failed." } : null;
      renderLogin(banner);
      if (error) history.replaceState(null, "", "/portal/");
    }
  })();
})();
</script>
</body>
</html>`;
}
