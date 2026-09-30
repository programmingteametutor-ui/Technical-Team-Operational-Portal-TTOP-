/* ============================================================
   TTOP – auth.js
   Google sign-in gate. Nobody sees the app until they sign in
   with Google AND an admin has approved their account in the
   "Users" sheet (see apps-script/Code.gs).

   ONE-TIME SETUP
   1. Google Cloud Console -> APIs & Services -> Credentials ->
      Create Credentials -> OAuth client ID -> Application type
      "Web application". Under "Authorized JavaScript origins"
      add the URL TTOP will be hosted at (e.g.
      https://yourname.github.io). Copy the Client ID it gives you.
   2. Paste that Client ID as CLIENT_ID below, AND as
      GOOGLE_CLIENT_ID at the top of apps-script/Code.gs — the
      two must match exactly, or sign-in will fail.
   3. In Code.gs, add your own email to ADMIN_EMAILS so you can
      approve everyone else's sign-in requests. Redeploy the
      Apps Script (Deploy -> Manage deployments -> New version).
   ============================================================ */

const Auth = (() => {
  // TODO: paste your OAuth Client ID here (must match GOOGLE_CLIENT_ID in Code.gs)
  const CLIENT_ID = "25189368573-snib59kq3qs7s36m81k7dhd740pqimh2.apps.googleusercontent.com";

  const SESSION_KEY = "ttop_session";
  let onReady = null;
  let session = loadSession();
  let googleReady = false;

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch (e) { return null; }
  }
  function saveSession(s) {
    session = s;
    try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  function getToken() { return (session && session.sessionToken) || ""; }
  function currentUser() { return session ? { email: session.email, name: session.name, role: session.role } : null; }
  function isAdmin() { return !!session && session.role === "admin"; }

  /* ---------------- gate UI ---------------- */

  function showGate(view, data) {
    const overlay = document.getElementById("authGate");
    const card = document.getElementById("authGateCard");
    if (!overlay || !card) return;
    overlay.classList.add("is-open");
    document.body.classList.add("auth-locked");

    if (view === "signin") {
      const misconfigured = CLIENT_ID.indexOf("PASTE-YOUR") === 0;
      card.innerHTML = `
        <div class="auth-card__logo">🛠️</div>
        <h2>TTOP</h2>
        <p class="muted">Sign in with your Google account to continue.</p>
        ${misconfigured
          ? `<p class="auth-card__error">Sign-in isn't configured yet — set CLIENT_ID in js/auth.js and GOOGLE_CLIENT_ID in Code.gs.</p>`
          : `<div id="googleSignInBtn" class="auth-card__google"></div>`}
        ${data && data.error ? `<p class="auth-card__error">${Utils.escapeHtml(data.error)}</p>` : ""}
      `;
      if (!misconfigured) renderGoogleButton();
    } else if (view === "pending") {
      card.innerHTML = `
        <div class="auth-card__logo">⏳</div>
        <h2>Waiting for approval</h2>
        <p class="muted">Signed in as <strong>${Utils.escapeHtml(data.email)}</strong>. An admin needs to approve your account before you can use TTOP.</p>
        <button class="btn btn--ghost" id="authRecheckBtn">Check again</button>
        <button class="btn btn--ghost" id="authSignOutBtn">Sign out</button>
      `;
      document.getElementById("authRecheckBtn")?.addEventListener("click", () => authGoogleRetry());
      document.getElementById("authSignOutBtn")?.addEventListener("click", signOut);
    } else if (view === "rejected") {
      card.innerHTML = `
        <div class="auth-card__logo">🚫</div>
        <h2>Access not available</h2>
        <p class="muted">Signed in as <strong>${Utils.escapeHtml(data.email)}</strong>. ${Utils.escapeHtml(data.status || "Your account isn't approved.")}</p>
        <button class="btn btn--ghost" id="authSignOutBtn">Sign out</button>
      `;
      document.getElementById("authSignOutBtn")?.addEventListener("click", signOut);
    }
  }

  function hideGate() {
    document.getElementById("authGate")?.classList.remove("is-open");
    document.body.classList.remove("auth-locked");
  }

  function renderGoogleButton() {
    if (!window.google || !google.accounts || !google.accounts.id) { setTimeout(renderGoogleButton, 150); return; }
    if (!googleReady) {
      google.accounts.id.initialize({ client_id: CLIENT_ID, callback: handleCredential });
      googleReady = true;
    }
    const host = document.getElementById("googleSignInBtn");
    if (host) google.accounts.id.renderButton(host, { theme: "outline", size: "large", width: 280 });
  }

  async function handleCredential(resp) {
    try {
      const out = await Drive.callRaw({ action: "authGoogle", credential: resp.credential });
      handleAuthResult(out);
    } catch (err) {
      showGate("signin", { error: err.message || "Sign-in failed." });
    }
  }

  // "Check again" on the pending screen re-verifies with the same cached Google credential isn't
  // available, so it just asks the backend whether THIS email has been approved yet via authSession
  // if we have a token, or simply re-prompts sign-in (One Tap / button) which is instant for a
  // returning Google session.
  function authGoogleRetry() {
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.prompt();
    }
    showGate("signin");
  }

  function handleAuthResult(out) {
    if (!out.ok) { showGate("signin", { error: out.error }); return; }
    if (out.status === "approved") {
      saveSession({ email: out.email, name: out.name, role: out.role, sessionToken: out.sessionToken });
      hideGate();
      paintUserChip();
      if (onReady) { const cb = onReady; onReady = null; cb(); }
    } else if (out.status === "pending") {
      saveSession(null);
      showGate("pending", { email: out.email });
    } else {
      saveSession(null);
      showGate("rejected", { email: out.email, status: `Your account is ${out.status}.` });
    }
  }

  /** Quietly re-check an existing cached session against the Users sheet (approvals/revokes apply immediately). */
  async function refresh() {
    if (!session) { showGate("signin"); return; }
    try {
      const out = await Drive.callRaw({ action: "authSession", sessionToken: session.sessionToken });
      if (out.ok) {
        saveSession({ email: out.email, name: out.name, role: out.role, sessionToken: out.sessionToken });
        paintUserChip();
      } else {
        const email = session.email;
        saveSession(null);
        showGate("rejected", { email, status: out.error || "Your session is no longer valid." });
      }
    } catch (err) {
      // network hiccup: keep using the cached session rather than lock the user out
    }
  }

  function signOut() {
    saveSession(null);
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    showGate("signin");
  }

  function paintUserChip() {
    const u = currentUser();
    if (!u) return;
    const nameEl = document.getElementById("currentUserName");
    const avEl = document.getElementById("currentUserAvatar");
    if (nameEl) nameEl.textContent = u.name;
    if (avEl) avEl.textContent = Utils.initials(u.name);
    document.getElementById("navAdminLink")?.classList.toggle("is-hidden", !isAdmin());
  }

  function bindSignOutButton() {
    document.getElementById("signOutBtn")?.addEventListener("click", signOut);
  }

  /** Entry point, called on DOMContentLoaded. `ready` is App.init — run once the user is approved. */
  function init(ready) {
    onReady = ready;
    bindSignOutButton();
    if (session) {
      // Optimistic: show the app right away with the cached session, then quietly re-verify in the
      // background so a revoked/expired session gets caught without making the user wait on load.
      paintUserChip();
      hideGate();
      const cb = onReady; onReady = null;
      cb();
      refresh();
    } else {
      showGate("signin");
    }
  }

  return { init, getToken, currentUser, isAdmin, signOut, refresh };
})();

document.addEventListener("DOMContentLoaded", () => Auth.init(App.init));
