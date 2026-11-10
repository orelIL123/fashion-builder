/* Fashion Builder — beta access (email + one-time code) + invite leftovers + plan helpers.
 * ACCESS_GATE=false: the old invite-approval flow stays off.
 * BETA_GATE=true: testers enter with email + access code. Sessions are re-checked on every load.
 * Pricing UI is hidden for now (PAYMENTS_VISIBLE=false); plan limits stay so a paid plan can return later.
 */
const AuthService = (() => {
  const SUPABASE_URL = 'https://ilekmrkcsopsxckxefns.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsZWttcmtjc29wc3hja3hlZm5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjQyMzMsImV4cCI6MjEwMTYwMDIzM30.jga5TlzxyEFzgV6bsaSdzW_mQOtFo_i7-7dSd4gzvdU';
  const FN_BASE = SUPABASE_URL + '/functions/v1';
  const INVITE_SESSION_KEY = 'fb-invite-session-v1';
  const SESSION_KEY = 'fb-beta-session-v1';
  const DESIGNS_KEY = 'fb-saas-designs-v1';
  const LEGACY_DESIGN_KEY = 'fashion-builder-design-v1';

  /** Paid plan UI is hidden while access is invite/beta only. Planned later: ~₪30/mo. */
  const PAYMENTS_VISIBLE = false;

  /** Set true to require email approval again. Invite/Supabase code below stays intact. */
  const ACCESS_GATE = false;

  /** Beta testers enter with email + a one-time access code. */
  const BETA_GATE = true;

  /** Kept for when pricing returns. */
  const ACCESS_CODES = {
    PRO40: 'pro',
    FRIENDS: 'pro',
    DEMO40: 'pro',
  };

  const PLANS = {
    free: {
      id: 'free',
      name: 'Free',
      priceILS: 0,
      maxLayers: 3,
      maxDesigns: 1,
      videoExport: false,
      watermark: true,
      allFonts: false,
      fonts: ['Anton', 'Bebas Neue', 'Roboto', 'Permanent Marker', 'Heebo', 'Familjen Grotesk'],
    },
    pro: {
      id: 'pro',
      name: 'Beta',
      priceILS: 30,
      maxLayers: Infinity,
      maxDesigns: 50,
      videoExport: true,
      watermark: false,
      allFonts: true,
      fonts: null,
    },
  };

  const listeners = new Set();
  let session = loadSession(); // { email, token, status, reason? }
  let verified = false; // true only after a successful server check this page load (or when no gate)
  let lastReason = null; // 'revoked' | 'invalid' | null

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  function saveSession(s) {
    session = s;
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  function notify() { const snap = getState(); listeners.forEach(fn => { try { fn(snap); } catch (_) {} }); }

  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function requiresGate() {
    return !!(BETA_GATE || ACCESS_GATE);
  }

  function isLocalHost() {
    const host = (typeof location !== 'undefined') ? location.hostname : '';
    return host === 'localhost' || host === '127.0.0.1';
  }

  function isLocalTestSession() {
    return isLocalHost() && session?.token === 'local-test';
  }

  async function callFn(name, body, { method = 'POST' } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(`${FN_BASE}/${name}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data = {};
      try { data = JSON.parse(text); } catch { data = { ok: false, error: text || res.statusText }; }
      if (!res.ok && !data.error) data.error = data.message || `Request failed (${res.status})`;
      data._http = res.status;
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('The server took too long. Try again.');
      throw new Error('Could not reach the server. Check your connection and try again.');
    } finally {
      clearTimeout(t);
    }
  }

  function getUser() {
    if (!session?.email) return null;
    return { email: session.email, name: session.name || '', status: session.status || null };
  }

  function isApproved() {
    if (!requiresGate()) return true;
    if (BETA_GATE) return verified && session?.status === 'ok' && !!session?.token;
    return verified && session?.status === 'approved';
  }

  function getPlan() {
    if (!requiresGate()) return PLANS.pro;
    return PLANS[isApproved() ? 'pro' : 'free'];
  }

  function getState() {
    return {
      user: getUser(),
      plan: getPlan(),
      plans: PLANS,
      paymentsVisible: PAYMENTS_VISIBLE,
      approved: isApproved(),
      codesHint: Object.keys(ACCESS_CODES),
      reason: lastReason,
    };
  }

  async function requestAccess({ email, name } = {}) {
    email = String(email || '').trim().toLowerCase();
    name = String(name || '').trim();
    if (!validEmail(email)) throw new Error('Enter a valid email / הזן אימייל תקין');
    const data = await callFn('request-access', { email, name });
    if (!data.ok) throw new Error(data.error || 'Could not send the request');
    verified = true;
    // Invite leftovers — only used if ACCESS_GATE is turned back on.
    try { localStorage.setItem(INVITE_SESSION_KEY, JSON.stringify({ email, name, status: data.status || 'pending' })); } catch (_) {}
    notify();
    return { ...getState(), email_sent: data.email_sent, email_detail: data.email_detail, already: data.already };
  }

  async function checkStatus(email) {
    email = String(email || session?.email || '').trim().toLowerCase();
    if (!validEmail(email)) throw new Error('Enter a valid email / הזן אימייל תקין');
    const data = await callFn('check-status', { email });
    if (!data.ok && data.status === undefined) throw new Error(data.error || 'Could not check status');
    return { status: data.status || 'unknown', name: data.name || '', email };
  }

  async function login({ email } = {}) {
    email = String(email || '').trim().toLowerCase();
    const st = await checkStatus(email);
    if (st.status === 'unknown') throw new Error('No request found for that email / לא נמצאה בקשה לאימייל הזה');
    verified = true;
    try { localStorage.setItem(INVITE_SESSION_KEY, JSON.stringify({ email, name: st.name || '', status: st.status })); } catch (_) {}
    notify();
    if (st.status === 'pending') {
      const err = new Error('pending');
      err.code = 'pending';
      throw err;
    }
    if (st.status === 'rejected') {
      const err = new Error('rejected');
      err.code = 'rejected';
      throw err;
    }
    return getState();
  }

  async function redeemCode({ email, code } = {}) {
    email = String(email || '').trim().toLowerCase();
    code = String(code || '').trim();
    if (!validEmail(email)) throw new Error('Enter a valid email / הזן אימייל תקין');
    if (!code) throw new Error('Enter an access code / הזן קוד גישה');
    const data = await callFn('redeem-code', { email, code });
    if (!data.ok) {
      const err = new Error(data.error || 'Could not redeem this code');
      err.code = data.code || 'invalid';
      throw err;
    }
    lastReason = null;
    verified = true;
    saveSession({ email, token: data.token, status: 'ok' });
    notify();
    return getState();
  }

  async function validateSession({ email, token } = {}) {
    email = String(email || session?.email || '').trim().toLowerCase();
    token = String(token || session?.token || '');
    const data = await callFn('validate-session', { email, token });
    if (!data.ok && data.valid === undefined) throw new Error(data.error || 'Could not validate session');
    return { valid: !!data.valid, reason: data.reason || (data.valid ? null : 'invalid'), email: data.email || email };
  }

  function logout() {
    lastReason = null;
    verified = true;
    saveSession(null);
    notify();
    return getState();
  }

  async function refreshSession() {
    if (!requiresGate()) {
      /* Ignore stale invite sessions so a leftover pending/rejected key cannot show the gate. */
      verified = true;
      return getState();
    }
    verified = false;
    lastReason = null;
    if (isLocalTestSession()) {
      verified = true;
      return getState();
    }
    if (BETA_GATE) {
      if (!session?.email || !session?.token) { verified = true; return getState(); }
      try {
        const st = await validateSession({ email: session.email, token: session.token });
        if (!st.valid) {
          lastReason = st.reason || 'invalid';
          saveSession(null);
        } else {
          saveSession({ email: session.email, token: session.token, status: 'ok' });
        }
        verified = true;
        notify();
      } catch (_) {
        /* Keep the cached session off the editor until a fresh check succeeds. */
      }
      return getState();
    }
    // ACCESS_GATE path (currently off)
    if (!session?.email) { verified = true; return getState(); }
    try {
      const st = await checkStatus(session.email);
      if (st.status === 'unknown') saveSession(null);
      else saveSession({ email: session.email, name: st.name || session.name || '', status: st.status });
      verified = true;
      notify();
    } catch (_) {
      /* Keep the email on the gate, but do not open the editor without a fresh check. */
    }
    return getState();
  }

  async function init() {
    await refreshSession();
    return getState();
  }

  /** Demo leftovers — kept so a paid plan can return without rewriting callers. */
  async function signup({ email, password, name, inviteCode }) {
    if (BETA_GATE) return redeemCode({ email, code: inviteCode });
    return requestAccess({ email, name });
  }
  function setPlanDemo() { throw new Error('Access is beta-only for now'); }

  function canUseFont(font) {
    const p = getPlan();
    if (p.allFonts) return true;
    return (p.fonts || []).includes(font);
  }
  function canAddLayer(currentCount) { return currentCount < getPlan().maxLayers; }
  function canExportVideo() { return !!getPlan().videoExport; }
  function needsWatermark() { return !!getPlan().watermark; }

  function listDesigns() {
    try {
      const all = JSON.parse(localStorage.getItem(DESIGNS_KEY) || '[]');
      return Array.isArray(all) ? all : [];
    } catch { return []; }
  }
  function saveNamedDesign(name, payload) {
    const plan = getPlan();
    const designs = listDesigns();
    const entry = { id: 'd' + Date.now(), name: name || 'Untitled', updatedAt: Date.now(), data: payload };
    if (plan.maxDesigns <= 1) {
      localStorage.setItem(LEGACY_DESIGN_KEY, JSON.stringify(payload));
      localStorage.setItem(DESIGNS_KEY, JSON.stringify([entry]));
      return entry;
    }
    if (designs.length >= plan.maxDesigns) throw new Error(`Design library is full (${plan.maxDesigns})`);
    designs.unshift(entry);
    localStorage.setItem(DESIGNS_KEY, JSON.stringify(designs.slice(0, plan.maxDesigns)));
    localStorage.setItem(LEGACY_DESIGN_KEY, JSON.stringify(payload));
    return entry;
  }
  function loadNamedDesign(id) {
    const d = listDesigns().find(x => x.id === id);
    if (!d) throw new Error('Design not found');
    return d;
  }
  function deleteNamedDesign(id) {
    const next = listDesigns().filter(x => x.id !== id);
    localStorage.setItem(DESIGNS_KEY, JSON.stringify(next));
    return next;
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /** Localhost-only helper for feature tests. Never grants access on the live site. */
  function grantLocalTestAccess(email = 'local-test@example.com') {
    if (!isLocalHost()) throw new Error('Test access is local only');
    lastReason = null;
    verified = true;
    saveSession({ email, token: 'local-test', status: 'ok' });
    notify();
    return getState();
  }

  return {
    PLANS, ACCESS_CODES, PAYMENTS_VISIBLE, ACCESS_GATE, BETA_GATE, SUPABASE_URL,
    requiresGate, getState, getUser, getPlan, isApproved,
    requestAccess, checkStatus, login, logout, refreshSession, init,
    signup, redeemCode, validateSession, setPlanDemo,
    canUseFont, canAddLayer, canExportVideo, needsWatermark,
    listDesigns, saveNamedDesign, loadNamedDesign, deleteNamedDesign,
    onChange, grantLocalTestAccess,
    LEGACY_DESIGN_KEY,
  };
})();

try { window.AuthService = AuthService; } catch (_) {}
