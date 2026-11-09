/* Fashion Builder — Auth / plan service (front-end demo).
 * Swap this module for Supabase Auth + a plans table later.
 * NOT secure server auth — passwords never leave this browser, hashed with SHA-256+salt for demo only.
 */
const AuthService = (() => {
  const USERS_KEY = 'fb-saas-users-v1';
  const SESSION_KEY = 'fb-saas-session-v1';
  const DESIGNS_KEY = 'fb-saas-designs-v1';
  const LEGACY_DESIGN_KEY = 'fashion-builder-design-v1';

  /** Client-side demo codes that unlock Pro. Replace with server redeem later. */
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
      name: 'Pro',
      priceILS: 40,
      maxLayers: Infinity,
      maxDesigns: 50,
      videoExport: true,
      watermark: false,
      allFonts: true,
      fonts: null,
    },
  };

  const listeners = new Set();

  function loadUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); } catch { return {}; }
  }
  function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  function saveSession(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  function bytesToHex(buf) {
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function randomSalt(n = 16) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return bytesToHex(a);
  }
  async function hashPassword(password, salt) {
    const data = new TextEncoder().encode(`${salt}:${password}`);
    const dig = await crypto.subtle.digest('SHA-256', data);
    return bytesToHex(dig);
  }

  function notify() { const snap = getState(); listeners.forEach(fn => { try { fn(snap); } catch (_) {} }); }

  function getUser() {
    const sess = loadSession();
    if (!sess?.email) return null;
    const users = loadUsers();
    const u = users[sess.email.toLowerCase()];
    if (!u) return null;
    return { email: u.email, name: u.name || '', plan: u.plan === 'pro' ? 'pro' : 'free', createdAt: u.createdAt };
  }

  function getPlan() {
    const u = getUser();
    return PLANS[u?.plan === 'pro' ? 'pro' : 'free'];
  }

  function getState() {
    return { user: getUser(), plan: getPlan(), plans: PLANS, codesHint: Object.keys(ACCESS_CODES) };
  }

  async function signup({ email, password, name, inviteCode }) {
    email = String(email || '').trim().toLowerCase();
    password = String(password || '');
    name = String(name || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email');
    if (password.length < 6) throw new Error('Password must be at least 6 characters');
    const users = loadUsers();
    if (users[email]) throw new Error('An account with this email already exists');
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    let plan = 'free';
    const code = String(inviteCode || '').trim().toUpperCase();
    if (code) {
      if (!ACCESS_CODES[code]) throw new Error('Invalid invite / access code');
      plan = ACCESS_CODES[code];
    }
    users[email] = { email, name, salt, hash, plan, createdAt: Date.now() };
    saveUsers(users);
    saveSession({ email });
    notify();
    return getState();
  }

  async function login({ email, password }) {
    email = String(email || '').trim().toLowerCase();
    password = String(password || '');
    const users = loadUsers();
    const u = users[email];
    if (!u) throw new Error('No account found for that email');
    const hash = await hashPassword(password, u.salt);
    if (hash !== u.hash) throw new Error('Wrong password');
    saveSession({ email });
    notify();
    return getState();
  }

  function logout() {
    saveSession(null);
    notify();
    return getState();
  }

  function redeemCode(code) {
    const u = getUser();
    if (!u) throw new Error('Sign in first to redeem a code');
    code = String(code || '').trim().toUpperCase();
    const plan = ACCESS_CODES[code];
    if (!plan) throw new Error('Invalid access code');
    const users = loadUsers();
    users[u.email].plan = plan;
    saveUsers(users);
    notify();
    return getState();
  }

  /** Demo-only: set plan without payment. Real billing comes later. */
  function setPlanDemo(planId) {
    const u = getUser();
    if (!u) throw new Error('Sign in first');
    if (!PLANS[planId]) throw new Error('Unknown plan');
    const users = loadUsers();
    users[u.email].plan = planId;
    saveUsers(users);
    notify();
    return getState();
  }

  function canUseFont(font) {
    const p = getPlan();
    if (p.allFonts) return true;
    return (p.fonts || []).includes(font);
  }

  function canAddLayer(currentCount) {
    return currentCount < getPlan().maxLayers;
  }

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
    if (designs.length >= plan.maxDesigns) throw new Error(`Pro design library is full (${plan.maxDesigns})`);
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

  return {
    PLANS, ACCESS_CODES,
    getState, getUser, getPlan,
    signup, login, logout, redeemCode, setPlanDemo,
    canUseFont, canAddLayer, canExportVideo, needsWatermark,
    listDesigns, saveNamedDesign, loadNamedDesign, deleteNamedDesign,
    onChange,
    LEGACY_DESIGN_KEY,
  };
})();

// Expose for Playwright / console debugging (demo only)
try { window.AuthService = AuthService; } catch (_) {}
