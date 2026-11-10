/* Fashion Builder — invite-only access (Supabase) + plan helpers.
 * Approval is stored server-side. The client caches only the email and re-checks status on load.
 * Pricing UI is hidden for now (PAYMENTS_VISIBLE=false); plan limits stay so a paid plan can return later.
 */
const AuthService = (() => {
  const SUPABASE_URL = 'https://ilekmrkcsopsxckxefns.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsZWttcmtjc29wc3hja3hlZm5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjQyMzMsImV4cCI6MjEwMTYwMDIzM30.jga5TlzxyEFzgV6bsaSdzW_mQOtFo_i7-7dSd4gzvdU';
  const FN_BASE = SUPABASE_URL + '/functions/v1';
  const SESSION_KEY = 'fb-invite-session-v1';
  const DESIGNS_KEY = 'fb-saas-designs-v1';
  const LEGACY_DESIGN_KEY = 'fashion-builder-design-v1';

  /** Paid plan UI is hidden while access is invite-only. Planned later: ~₪30/mo. */
  const PAYMENTS_VISIBLE = false;

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
      name: 'Invited',
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
  let session = loadSession(); // { email, name, status }
  let verified = false; // true only after a successful server status check this page load

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

  function isApproved() { return verified && session?.status === 'approved'; }

  function getPlan() {
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
    };
  }

  async function requestAccess({ email, name } = {}) {
    email = String(email || '').trim().toLowerCase();
    name = String(name || '').trim();
    if (!validEmail(email)) throw new Error('Enter a valid email / הזן אימייל תקין');
    const data = await callFn('request-access', { email, name });
    if (!data.ok) throw new Error(data.error || 'Could not send the request');
    verified = true;
    saveSession({ email, name, status: data.status || 'pending' });
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
    saveSession({ email, name: st.name || '', status: st.status });
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

  function logout() {
    saveSession(null);
    notify();
    return getState();
  }

  async function refreshSession() {
    verified = false;
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
    return requestAccess({ email, name });
  }
  async function redeemCode() { throw new Error('Access is invite-only for now'); }
  function setPlanDemo() { throw new Error('Access is invite-only for now'); }

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
    const host = (typeof location !== 'undefined') ? location.hostname : '';
    if (host !== 'localhost' && host !== '127.0.0.1') throw new Error('Test access is local only');
    verified = true;
    saveSession({ email, name: 'Local test', status: 'approved' });
    notify();
    return getState();
  }

  return {
    PLANS, ACCESS_CODES, PAYMENTS_VISIBLE, SUPABASE_URL,
    getState, getUser, getPlan, isApproved,
    requestAccess, checkStatus, login, logout, refreshSession, init,
    signup, redeemCode, setPlanDemo,
    canUseFont, canAddLayer, canExportVideo, needsWatermark,
    listDesigns, saveNamedDesign, loadNamedDesign, deleteNamedDesign,
    onChange, grantLocalTestAccess,
    LEGACY_DESIGN_KEY,
  };
})();

try { window.AuthService = AuthService; } catch (_) {}
