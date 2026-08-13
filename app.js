/* GM Tutoring - full interactive frontend + Node.js API integration with offline fallback. */
const DATA_KEY = 'gm_tutoring_backend_v1';
const TOKEN_KEY = 'gm_tutoring_access_token';
const OFFLINE_USERS_KEY = 'gm_tutoring_offline_users';
const OFFLINE_SESSION_KEY = 'gm_tutoring_offline_session';
// Detect GitHub Pages / static hosting (no backend available) vs local dev
const isStaticHost = window.location.hostname.includes('github.io') || window.location.protocol === 'file:';
const API_BASE = isStaticHost ? '' : 'http://localhost:4000/api';
const todayISO = new Date().toISOString().slice(0, 10);
let syncTimer = null;
let syncInFlight = Promise.resolve();
let backendOnline = false;
let offlineMode = false;

class NetworkError extends Error { }

// ---------- Offline (localStorage) user store ----------
function loadOfflineUsers() { try { return JSON.parse(localStorage.getItem(OFFLINE_USERS_KEY)) || []; } catch { return []; } }
function saveOfflineUsers(users) { localStorage.setItem(OFFLINE_USERS_KEY, JSON.stringify(users)); }
function loadOfflineSession() { try { return JSON.parse(localStorage.getItem(OFFLINE_SESSION_KEY)) || null; } catch { return null; } }
function saveOfflineSession(session) { if (session) localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(OFFLINE_SESSION_KEY); }
function offlineHash(password) { let h = 5381; for (let i = 0; i < password.length; i++) h = ((h << 5) + h + password.charCodeAt(i)) | 0; return 'h' + (h >>> 0).toString(36); }
function publicUser(u) { if (!u) return null; const x = { ...u }; delete x.passwordHash; return x; }
function seedOfflineUsers() {
  let users = loadOfflineUsers();
  if (users.length) return users;
  const passHash = offlineHash('Welcome123!');
  users = seed.users.map(u => ({ ...u, passwordHash: passHash }));
  saveOfflineUsers(users);
  return users;
}
function offlineRegister(name, email, password, role, phone) {
  const users = seedOfflineUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) throw new Error('An account with that email already exists. Please sign in instead.');
  const user = { id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, email, role, status: 'Active', phone: phone || '', passwordHash: offlineHash(password) };
  users.push(user); saveOfflineUsers(users);
  const token = 'offline_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  saveOfflineSession({ token, userId: user.id });
  return { token, user: publicUser(user) };
}
function offlineLogin(email, password, role) {
  const users = seedOfflineUsers();
  const found = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!found || found.status !== 'Active' || (role && found.role !== role) || found.passwordHash !== offlineHash(password)) throw new Error('Invalid email, password, role, or inactive account.');
  const token = 'offline_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  saveOfflineSession({ token, userId: found.id });
  return { token, user: publicUser(found) };
}
function offlineCurrentUser() {
  const session = loadOfflineSession(); if (!session) return null;
  return loadOfflineUsers().find(u => u.id === session.userId) || null;
}
function offlineLogout() { saveOfflineSession(null); }
function enterApp(user, message) {
  state = Object.assign(clone(seed), loadState());
  const existing = state.users.find(u => u.id === user.id);
  if (existing) Object.assign(existing, { name: user.name, email: user.email, role: user.role, status: user.status, phone: user.phone });
  else state.users.push({ id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, phone: user.phone });
  state.currentRole = user.role;
  state.currentUserId = user.id;
  localStorage.setItem(DATA_KEY, JSON.stringify(state));
  qs('#login-screen').classList.add('hidden');
  qs('#app').classList.remove('hidden');
  route = 'dashboard'; render();
  toast(message);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response;
  try { response = await fetch(API_BASE + path, { ...options, headers, cache: 'no-store' }); }
  catch { throw new NetworkError('Cannot reach the GM Tutoring server. Make sure `node server.js` is running.'); }
  let payload = null;
  try { payload = await response.json(); } catch { }
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return payload;
}

async function checkBackend() {
  if (isStaticHost) { backendOnline = false; offlineMode = true; updateBackendBadge(); return false; }
  try { await api('/health'); backendOnline = true; offlineMode = false; updateBackendBadge(); return true; }
  catch { backendOnline = false; offlineMode = true; updateBackendBadge(); return false; }
}
function updateBackendBadge() { const el = qs('#backend-status'); if (el) { el.textContent = offlineMode ? 'Offline mode' : (backendOnline ? 'Backend connected' : 'Backend offline'); el.className = `backend-status ${backendOnline ? 'online' : 'offline'}`; } }
function scheduleSync() {
  if (!localStorage.getItem(TOKEN_KEY) || offlineMode) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const payload = clone(state);
    syncInFlight = syncInFlight.then(async () => {
      try { const result = await api('/state/sync', { method: 'PUT', body: JSON.stringify(payload) }); backendOnline = true; offlineMode = false; updateBackendBadge(); if (result.state) { state = Object.assign(state, result.state); localStorage.setItem(DATA_KEY, JSON.stringify(state)); } }
      catch (err) { backendOnline = false; offlineMode = true; updateBackendBadge(); toast(err.message, 'error'); }
    });
  }, 120);
}

async function restoreBackendSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const offlineUser = offlineCurrentUser();
  if (!token && !offlineUser) { await checkBackend(); return; }
  if (!isStaticHost && token) {
    try {
      const [result, me] = await Promise.all([api('/state'), api('/me')]);
      state = Object.assign(clone(seed), result);
      state.currentRole = me.user.role;
      state.currentUserId = me.user.id;
      localStorage.setItem(DATA_KEY, JSON.stringify(state));
      backendOnline = true; offlineMode = false;
      qs('#login-screen').classList.add('hidden');
      qs('#app').classList.remove('hidden');
      route = 'dashboard'; render();
      updateBackendBadge();
      return;
    } catch { /* fall through to offline session */ }
  }
  if (offlineUser) {
    enterApp(offlineUser, 'Welcome back.');
    offlineMode = true; backendOnline = false; updateBackendBadge();
    return;
  }
  localStorage.removeItem(TOKEN_KEY);
  offlineMode = true; backendOnline = false; updateBackendBadge();
  await checkBackend();
}

const seed = {
  currentRole: 'admin',
  currentUserId: 'u1',
  users: [
    { id: 'u1', name: 'GM Owner', email: 'owner@gmtutoring.co.za', role: 'admin', status: 'Active', phone: '+27 71 000 0000' },
    { id: 'u2', name: 'Thandi Mokoena', email: 'thandi@gmtutoring.co.za', role: 'tutor', status: 'Active', phone: '+27 72 111 1111' },
    { id: 'u3', name: 'Daniel Naidoo', email: 'daniel@gmtutoring.co.za', role: 'tutor', status: 'Active', phone: '+27 73 222 2222' },
    { id: 'u4', name: 'Lerato Molefe', email: 'lerato@student.co.za', role: 'learner', status: 'Active', phone: '+27 74 333 3333' },
    { id: 'u5', name: 'Sipho Dlamini', email: 'sipho@student.co.za', role: 'learner', status: 'Active', phone: '+27 75 444 4444' },
    { id: 'u6', name: 'Aisha Khan', email: 'aisha@student.co.za', role: 'learner', status: 'Active', phone: '+27 76 555 5555' },
    { id: 'u7', name: 'Neo Ramokgopa', email: 'neo@student.co.za', role: 'learner', status: 'Active', phone: '+27 77 666 6666' }
  ],
  classes: [
    { id: 'c1', name: 'Grade 12 Mathematics', subject: 'Mathematics', grade: 'Grade 12', tutorId: 'u2', learners: ['u4', 'u5', 'u6', 'u7'], progress: 78, next: 'Today · 18:00', status: 'Active' },
    { id: 'c2', name: 'Grade 11 Physical Sciences', subject: 'Physical Sciences', grade: 'Grade 11', tutorId: 'u3', learners: ['u5', 'u7'], progress: 69, next: 'Today · 19:00', status: 'Active' },
    { id: 'c3', name: 'Grade 10 Mathematics', subject: 'Mathematics', grade: 'Grade 10', tutorId: 'u2', learners: ['u6'], progress: 84, next: 'Tomorrow · 16:30', status: 'Active' },
    { id: 'c4', name: 'Grade 8 Mathematics', subject: 'Mathematics', grade: 'Grade 8', tutorId: 'u3', learners: ['u7'], progress: 72, next: 'Wed · 17:00', status: 'Active' },
    { id: 'c5', name: 'Grade 12 Accounting', subject: 'Accounting', grade: 'Grade 12', tutorId: 'u2', learners: ['u4'], progress: 81, next: 'Thu · 18:30', status: 'Active' },
    { id: 'c6', name: 'Grade 11 Mathematics', subject: 'Mathematics', grade: 'Grade 11', tutorId: 'u3', learners: ['u5'], progress: 75, next: 'Fri · 17:30', status: 'Active' }
  ],
  sessions: [
    { id: 's1', classId: 'c1', title: 'Trigonometric identities', date: todayISO, start: '18:00', end: '19:00', tutorId: 'u2', status: 'Scheduled', recording: true },
    { id: 's2', classId: 'c2', title: "Newton's Laws", date: todayISO, start: '19:00', end: '20:00', tutorId: 'u3', status: 'Scheduled', recording: true },
    { id: 's3', classId: 'c3', title: 'Algebraic fractions', date: todayISO, start: '16:30', end: '17:30', tutorId: 'u2', status: 'Scheduled', recording: false }
  ],
  activities: [
    { id: 'a1', title: 'Double Angle Identities', classId: 'c1', due: '2026-08-15', submissions: 18, total: 28, status: 'Open', instructions: 'Complete questions 1–12 and show all working.' },
    { id: 'a2', title: "Newton's Laws Practice", classId: 'c2', due: '2026-08-17', submissions: 12, total: 24, status: 'Open', instructions: 'Answer all force and acceleration questions.' },
    { id: 'a3', title: 'Algebraic Fractions', classId: 'c3', due: '2026-08-20', submissions: 27, total: 31, status: 'Open', instructions: 'Simplify each expression and explain your method.' },
    { id: 'a4', title: 'Financial Statements Quiz', classId: 'c5', due: '2026-08-22', submissions: 8, total: 22, status: 'Draft', instructions: 'Short quiz on financial statement interpretation.' }
  ],
  submissions: [
    { id: 'sub1', activityId: 'a1', learnerId: 'u4', filename: 'lerato_double_angle.pdf', mark: 82, feedback: 'Good working. Check question 9.' },
    { id: 'sub2', activityId: 'a1', learnerId: 'u5', filename: 'sipho_double_angle.pdf', mark: null, feedback: '' }
  ],
  announcements: [
    { id: 'n1', title: 'Grade 12 Mathematics class will take place on Thursday at 18:00.', audience: 'c1', time: '2 hours ago' },
    { id: 'n2', title: 'New revision pack: Trigonometric identities is now available.', audience: 'c1', time: 'Yesterday' },
    { id: 'n3', title: 'Term 3 attendance reports are ready for review.', audience: 'all', time: '2 days ago' }
  ],
  attendance: [
    { id: 'att1', learnerId: 'u4', classId: 'c1', date: '2026-08-12', status: 'Present', tutorId: 'u2' },
    { id: 'att2', learnerId: 'u5', classId: 'c2', date: '2026-08-12', status: 'Present', tutorId: 'u3' },
    { id: 'att3', learnerId: 'u6', classId: 'c3', date: '2026-08-12', status: 'Absent', tutorId: 'u2' },
    { id: 'att4', learnerId: 'u4', classId: 'c1', date: '2026-08-14', status: 'Present', tutorId: 'u2' },
    { id: 'att5', learnerId: 'u5', classId: 'c2', date: '2026-08-14', status: 'Absent', tutorId: 'u3' },
    { id: 'att6', learnerId: 'u6', classId: 'c3', date: '2026-08-14', status: 'Present', tutorId: 'u2' }
  ],
  recordings: [
    { id: 'r1', classId: 'c2', title: "Newton's Laws", date: '2026-08-12', duration: '54 min', tutorId: 'u3' },
    { id: 'r2', classId: 'c1', title: 'Differentiation', date: '2026-08-12', duration: '61 min', tutorId: 'u2' },
    { id: 'r3', classId: 'c3', title: 'Quadratic Functions', date: '2026-08-12', duration: '48 min', tutorId: 'u2' }
  ],
  materials: [
    { id: 'm1', classId: 'c1', name: 'Trigonometric Identities Revision Pack.pdf', type: 'PDF', size: '2.4 MB', date: '2026-08-08' },
    { id: 'm2', classId: 'c1', name: 'Formula Sheet.pdf', type: 'PDF', size: '680 KB', date: '2026-08-07' },
    { id: 'm3', classId: 'c2', name: "Newton's Laws Notes.pdf", type: 'PDF', size: '1.1 MB', date: '2026-08-06' }
  ],
  payments: [
    { id: 'p1', learnerId: 'u4', amount: 950, status: 'Paid', date: '2026-08-01', method: 'EFT' },
    { id: 'p2', learnerId: 'u5', amount: 950, status: 'Outstanding', date: '2026-08-01', method: '—' },
    { id: 'p3', learnerId: 'u6', amount: 950, status: 'Paid', date: '2026-08-02', method: 'Card' }
  ],
  referrals: [
    { id: 'ref1', name: 'Thapelo', code: 'THAP10', learners: 7, commission: 1050, bonusRemaining: 3 },
    { id: 'ref2', name: 'Naledi', code: 'NALEDI5', learners: 4, commission: 600, bonusRemaining: 6 }
  ],
  parents: [
    { id: 'par1', name: 'Mpho Molefe', email: 'mpho@example.com', learnerId: 'u4', status: 'Active' },
    { id: 'par2', name: 'David Dlamini', email: 'david@example.com', learnerId: 'u5', status: 'Active' },
    { id: 'par3', name: 'Ayesha Khan', email: 'ayesha@example.com', learnerId: 'u6', status: 'Pending' }
  ],
  notifications: [
    { id: 'x1', title: 'Attendance report ready', body: 'Term 3 attendance reports are ready for review.', time: '2 hrs ago', read: false },
    { id: 'x2', title: 'New submission', body: 'Lerato Molefe submitted an activity.', time: '3 hrs ago', read: false },
    { id: 'x3', title: 'Announcement posted', body: 'A new classroom announcement was posted.', time: 'Yesterday', read: false }
  ],
  settings: { ownership: true, twoFactor: true, tutorAlerts: true, autoRecord: false, emailNotifications: true, smsNotifications: false, darkMode: false },
  activeSettingTab: 'General'
};

const roleNames = { admin: 'Super Administrator', tutor: 'Tutor', learner: 'Learner' };
const navByRole = {
  admin: [['dashboard', '⌂', 'Dashboard'], ['classes', '▦', 'Classrooms'], ['users', '♙', 'Users'], ['live', '●', 'Live Sessions'], ['activities', '✓', 'Activities'], ['attendance', '◷', 'Attendance'], ['announcements', '◌', 'Announcements'], ['materials', '▤', 'Materials'], ['reports', '▥', 'Reports'], ['payments', 'R', 'Payments'], ['referrals', '↗', 'Referrals'], ['parents', '◎', 'Parents']],
  tutor: [['dashboard', '⌂', 'Dashboard'], ['classes', '▦', 'My Classrooms'], ['learners', '♙', 'My Learners'], ['live', '●', 'Live Sessions'], ['activities', '✓', 'Activities'], ['attendance', '◷', 'Attendance'], ['materials', '▤', 'Materials'], ['announcements', '◌', 'Announcements']],
  learner: [['dashboard', '⌂', 'My Dashboard'], ['classes', '▦', 'My Classroom'], ['live', '●', 'Live Lessons'], ['activities', '✓', 'My Activities'], ['attendance', '◷', 'My Attendance'], ['materials', '▤', 'Learning Materials'], ['announcements', '◌', 'Announcements']]
};

let state = loadState();
let route = 'dashboard';
let currentClassId = null;
let currentActivityId = null;
let currentSessionId = null;
let searchTimers = {};
let liveMediaStream = null;
let screenShareStream = null;
let mediaRecorder = null;
let recordingChunks = [];
let recordingStartedAt = 0;
let liveCameraEnabled = true;
let liveMicEnabled = true;

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function loadState() { try { const saved = JSON.parse(localStorage.getItem(DATA_KEY)); return saved ? Object.assign(clone(seed), saved) : clone(seed); } catch { return clone(seed); } }
function saveState(options = {}) { localStorage.setItem(DATA_KEY, JSON.stringify(state)); if (!options.skipSync) scheduleSync(); }
function qs(s, root = document) { return root.querySelector(s) }
function qsa(s, root = document) { return [...root.querySelectorAll(s)] }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#039;' }[m])) }
function initials(name) { return String(name || 'GM').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() }
function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
function user(id) { return state.users.find(x => x.id === id) }
function cls(id) { return state.classes.find(x => x.id === id) }
function activityById(id) { return state.activities.find(x => x.id === id) }
function currentUser() { return user(state.currentUserId) || state.users.find(x => x.role === state.currentRole) || state.users[0] }
function tutorName(c) { return user(c?.tutorId)?.name || 'Unassigned' }
function className(id) { return cls(id)?.name || 'Unknown classroom' }
function isAdmin() { return state.currentRole === 'admin' }
function toast(msg, type = 'success') { const root = qs('#toast-root'); const el = document.createElement('div'); el.className = `toast ${type}`; el.innerHTML = `<span>${type === 'error' ? '!' : '✓'}</span><div>${esc(msg)}</div>`; root.appendChild(el); setTimeout(() => el.remove(), 3000) }
function formatDate(d) { if (!d) return '—'; const x = new Date(d + 'T00:00:00'); return x.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) }
function currency(n) { return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n) }
function can(action) {
  const allowed = {
    admin: ['create', 'edit', 'delete', 'manage', 'export', 'schedule', 'grade', 'attendance', 'announce', 'material', 'payments', 'referrals', 'parents'],
    tutor: ['manage', 'schedule', 'grade', 'attendance', 'announce', 'material'],
    learner: ['submit', 'join', 'download']
  };
  return allowed[state.currentRole]?.includes(action);
}
function guard(action) { if (!can(action)) { toast('This action is protected by your role permissions.', 'error'); return false } return true }

function renderNav() {
  const nav = qs('#main-nav'); nav.innerHTML = navByRole[state.currentRole].map(([r, icon, label]) => `<button class="nav-item ${route === r ? 'active' : ''}" data-route="${r}"><span>${icon}</span>${label}</button>`).join('');
  const u = currentUser();
  qs('#role-label').textContent = roleNames[state.currentRole];
  qs('#side-name').textContent = u.name; qs('#side-email').textContent = u.email; qs('#side-avatar').textContent = initials(u.name); qs('.profile-menu .avatar').textContent = initials(u.name); qs('.profile-menu .desktop-only').textContent = u.name;
  const unread = state.notifications.filter(n => !n.read).length; const badge = qs('.notification-badge'); badge.textContent = unread; badge.style.display = unread ? 'grid' : 'none';
}
function layout(title) { qs('#page-title').textContent = title; renderNav(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function kpi(label, value, trend, icon, clsName = '') { return `<div class="kpi ${clsName}"><div class="kpi-top"><span class="kpi-label">${esc(label)}</span><span class="kpi-icon">${icon}</span></div><strong>${esc(value)}</strong><span class="trend">${esc(trend)}</span></div>` }
function button(label, action, variant = 'light', extra = '') { return `<button type="button" class="btn btn-${variant}" data-action="${action}" ${extra}>${label}</button>` }
function scheduleCard(s) { return `<div class="schedule-item"><time>${esc(s.start)}</time><div><strong>${esc(s.title)}</strong><small>${esc(className(s.classId))} · ${esc(tutorName(cls(s.classId)))}</small></div><span class="badge ${s.status === 'Live' ? 'success' : 'info'}">${esc(s.status)}</span><button class="icon-btn" title="Open session" data-action="session-details" data-id="${s.id}">⋮</button></div>` }
function activityLine(icon, title, sub, time) { return `<div class="activity"><div class="mini-icon">${icon}</div><div style="flex:1"><strong>${esc(title)}</strong><small>${esc(sub)} · ${esc(time)}</small></div></div>` }

function dashboard() {
  if (state.currentRole === 'tutor') return tutorDashboard();
  if (state.currentRole === 'learner') return learnerDashboard();
  const active = state.classes.filter(c => c.status === 'Active').length;
  return `<div class="page-head"><div><span class="eyebrow">OVERVIEW</span><h1>Good afternoon, GM Owner.</h1><p>Central command for classrooms, teaching, learners and business operations.</p></div><div class="head-actions">${button('↓ Export Report', 'export', 'light', 'data-format="csv"')}${button('＋ New Classroom', 'new-class', 'primary')}</div></div>
  <div class="hero-card dashboard-hero"><div><span class="eyebrow">GM TUTORING CONTROL CENTRE</span><h2>Everything under one roof.</h2><p>Classrooms remain owned by GM Tutoring while tutors deliver teaching services inside the platform.</p><div class="hero-actions">${button('Manage classrooms', 'route-classes', 'primary')}${button('Review reports', 'route-reports', 'light')}</div></div><img class="hero-mark" src="assets/gm-tutoring-logo.jpeg" alt="GM Tutoring logo"></div>
  <div class="kpis" style="margin-top:18px">${kpi('Learners', String(state.users.filter(u => u.role === 'learner').length + 143), '↗ 8.4% this term', '♙')}${kpi('Tutors', String(state.users.filter(u => u.role === 'tutor').length + 8), 'All active', '◉')}${kpi('Active Classes', String(active + 9), '2 new this month', '▦')}${kpi('Attendance', '92%', '↗ 4.2% this month', '◷')}${kpi('Pending Assignments', String(state.activities.reduce((n, a) => n + Math.max(0, a.total - a.submissions), 0) + 22), 'Needs review', '✓')}${kpi('Monthly Revenue', 'R48,750', '↗ 12.1%', 'R')}${kpi('Live Today', String(state.sessions.filter(s => s.date === todayISO).length + 2), 'Scheduled', '●')}${kpi('Referrals', '11', '2 awaiting payout', '↗')}</div>
  <div class="grid-2"><div class="card"><div class="card-title"><h3>Attendance Overview</h3><button class="text-link" data-action="route-attendance">VIEW REPORT →</button></div><div class="chart"><div class="bars">${[72, 84, 79, 91, 88, 95, 92].map((n, i) => `<div class="bar" style="height:${n}%"><i>${n}%</i><span>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}</span></div>`).join('')}</div></div></div><div class="card"><div class="card-title"><h3>Class Progress</h3><button class="text-link" data-action="route-classes">ALL CLASSES →</button></div><div class="progress-list">${state.classes.slice(0, 5).map(c => `<div class="progress-row"><div><span>${esc(c.name)}</span><span>${c.progress}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${c.progress}%"></div></div></div>`).join('')}</div></div></div>
  <div class="grid-2" style="margin-top:18px"><div class="card"><div class="card-title"><h3>Today's Schedule</h3><button class="text-link" data-action="route-live">VIEW CALENDAR →</button></div><div class="schedule">${state.sessions.slice(0, 4).map(scheduleCard).join('')}</div></div><div class="card"><div class="card-title"><h3>Recent Activity</h3><button class="text-link" data-action="route-reports">VIEW ALL →</button></div>${activityLine('✓', 'Lerato submitted Double Angle Identities', 'Grade 12 Mathematics', '12 min ago')}${activityLine('◷', 'Attendance recorded', 'Grade 11 Physical Sciences', '42 min ago')}${activityLine('◌', 'New announcement posted', 'All learners', '2 hrs ago')}</div></div>`;
}
function tutorDashboard() {
  const me = currentUser(); const classes = state.classes.filter(c => c.tutorId === me.id); const learners = [...new Set(classes.flatMap(c => c.learners))];
  return `<div class="page-head"><div><span class="eyebrow">TUTOR PORTAL</span><h1>Welcome back, ${esc(me.name.split(' ')[0])}.</h1><p>Your assigned classrooms, learners and teaching workflow.</p></div><div class="head-actions">${button('＋ Schedule Lesson', 'schedule', 'primary')}${button('Take Attendance', 'mark-attendance', 'light')}</div></div>
  <div class="hero-card"><div><span class="eyebrow">NEXT LIVE CLASS</span><h2>${esc(classes[0]?.name || 'No classroom assigned')}</h2><p>${esc(state.sessions.find(s => s.classId === classes[0]?.id)?.title || 'Plan your next lesson')} · Today · 18:00 · ${classes[0]?.learners.length || 0} learners enrolled.</p>${classes[0] ? button('Join Live Class →', 'join-live', 'primary', 'data-id="s1"') : ''}</div><img class="hero-mark" src="assets/gm-tutoring-logo.jpeg" alt="GM Tutoring logo"></div>
  <div class="kpis" style="margin-top:18px">${kpi('My Classrooms', String(classes.length), 'Assigned by GM Tutoring', '▦')}${kpi('My Learners', String(learners.length), 'Protected access', '♙')}${kpi('Assignments to mark', String(state.submissions.filter(s => s.mark === null).length), 'Needs attention', '✓')}${kpi('Attendance', '94%', '↗ this month', '◷')}</div>
  <div class="grid-2"><div class="card"><div class="card-title"><h3>My Classrooms</h3><button class="text-link" data-action="route-classes">VIEW ALL →</button></div>${classes.map(c => `<div class="activity"><div class="mini-icon">▦</div><div style="flex:1"><strong>${esc(c.name)}</strong><small>${c.learners.length} learners · ${c.progress}% progress</small></div>${button('Open', 'class-details', 'light', `data-id="${c.id}"`)}</div>`).join('')}</div><div class="card"><div class="card-title"><h3>Submissions needing review</h3><button class="text-link" data-action="route-activities">VIEW ALL →</button></div>${state.submissions.filter(s => s.mark === null).slice(0, 4).map(s => { const a = activityById(s.activityId); return activityLine('! ', user(s.learnerId)?.name || 'Learner', a?.title || 'Activity', 'Awaiting mark') }).join('') || '<div class="empty"><b>All caught up</b><p>No unmarked submissions.</p></div>'}</div></div>`;
}
function learnerDashboard() {
  const me = currentUser(); const c = state.classes.find(x => x.learners.includes(me.id)) || state.classes[0];
  return `<div class="page-head"><div><span class="eyebrow">LEARNER PORTAL</span><h1>Welcome back, ${esc(me.name.split(' ')[0])}.</h1><p>Your learning space is simple, focused and private.</p></div>${button('Join next lesson', 'join-live', 'primary')}</div>
  <div class="hero-card"><div><span class="eyebrow">MY CLASSROOM</span><h2>${esc(c.name)}</h2><p>${esc(c.subject)} · ${esc(c.grade)} · Tutor: ${esc(tutorName(c))}</p>${button('Join Today’s Lesson →', 'join-live', 'primary')}</div><img class="hero-mark" src="assets/gm-tutoring-logo.jpeg" alt="GM Tutoring logo"></div>
  <div class="kpis" style="margin-top:18px">${kpi('My Progress', '82%', 'Keep going!', '✓')}${kpi('Attendance', '96%', 'Excellent', '◷')}${kpi('Activities', '8/10', '2 remaining', '▤')}${kpi('Average Mark', '78%', '↗ 5% this term', '★')}</div>
  <div class="grid-2"><div class="card"><div class="card-title"><h3>Upcoming Lessons</h3><button class="text-link" data-action="route-live">VIEW ALL →</button></div><div class="schedule">${state.sessions.slice(0, 2).map(scheduleCard).join('')}</div></div><div class="card"><div class="card-title"><h3>My Assignments</h3><button class="text-link" data-action="route-activities">VIEW ALL →</button></div>${state.activities.slice(0, 3).map(a => activityLine('✓', a.title, `${className(a.classId)} · Due ${formatDate(a.due)}`, `${a.submissions}/${a.total} submitted`)).join('')}</div></div>`;
}

function classesPage() {
  let classes = state.classes; if (state.currentRole === 'tutor') classes = classes.filter(c => c.tutorId === currentUser().id); if (state.currentRole === 'learner') classes = classes.filter(c => c.learners.includes(currentUser().id));
  return `<div class="page-head"><div><span class="eyebrow">CLASSROOMS</span><h1>${state.currentRole === 'admin' ? 'All Classrooms' : 'My Classroom'}</h1><p>Every classroom is owned by GM Tutoring and retains its records when tutors change.</p></div>${isAdmin() ? button('＋ Create Classroom', 'new-class', 'primary') : ''}</div>
  <div class="toolbar"><div class="searchbar"><span>⌕</span><input id="class-search" placeholder="Search classrooms..."></div><div class="toolbar-right"><select class="select" id="class-subject-filter"><option value="">All Subjects</option>${[...new Set(state.classes.map(c => c.subject))].map(x => `<option>${esc(x)}</option>`).join('')}</select><select class="select" id="class-status-filter"><option value="">All Statuses</option><option>Active</option><option>Archived</option></select></div></div>
  <div id="class-grid" class="class-grid">${classes.map(classCard).join('')}</div>`;
}
function classCard(c) { return `<div class="class-card" data-search="${esc((c.name + ' ' + c.subject + ' ' + tutorName(c)).toLowerCase())}" data-subject="${esc(c.subject)}" data-status="${esc(c.status)}"><div class="class-banner"><div><span class="subject">${esc(c.subject.toUpperCase())}</span><h3>${esc(c.name)}</h3></div><span class="badge ${c.status === 'Active' ? 'success' : 'dark'}">${esc(c.status)}</span></div><div class="class-body"><div class="class-meta"><div><small>Tutor</small><b>${esc(tutorName(c))}</b></div><div><small>Learners</small><b>${c.learners.length}</b></div><div><small>Progress</small><b>${c.progress}%</b></div><div><small>Next class</small><b>${esc(c.next)}</b></div></div><div class="class-footer"><div class="avatars">${c.learners.slice(0, 3).map(id => `<span class="avatar">${initials(user(id)?.name || 'L')}</span>`).join('')}</div><div class="button-row">${button('Open', 'class-details', 'light', `data-id="${c.id}"`)}${isAdmin() ? button('⋮', 'class-menu', 'light', `data-id="${c.id}"`) : ''}</div></div></div></div>` }

function usersPage(type = 'all') {
  let users = state.users; if (type === 'tutors') users = users.filter(u => u.role === 'tutor'); if (type === 'learners') users = users.filter(u => u.role === 'learner'); if (state.currentRole === 'tutor') users = users.filter(u => u.role === 'learner' && state.classes.some(c => c.tutorId === currentUser().id && c.learners.includes(u.id))); if (state.currentRole === 'learner') users = [];
  const title = type === 'tutors' ? 'Tutors' : type === 'learners' ? 'Learners' : 'Users';
  return `<div class="page-head"><div><span class="eyebrow">PEOPLE & PERMISSIONS</span><h1>${title}</h1><p>Role-based access keeps learner ownership centralised.</p></div>${isAdmin() ? button('＋ Add User', 'new-user', 'primary') : ''}</div><div class="card table-card"><div class="toolbar" style="padding:16px 16px 0"><div class="searchbar"><span>⌕</span><input id="user-search" placeholder="Search users..."></div><div class="tabs"><button class="tab ${type === 'all' ? 'active' : ''}" data-route="users">All</button><button class="tab ${type === 'tutors' ? 'active' : ''}" data-route="tutors">Tutors</button><button class="tab ${type === 'learners' ? 'active' : ''}" data-route="learners">Learners</button></div></div><div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Email</th><th>Access</th><th>Action</th></tr></thead><tbody id="user-table">${users.map(u => `<tr><td><div class="person"><span class="avatar">${initials(u.name)}</span><div><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></div></div></td><td><span class="badge ${u.role === 'admin' ? 'warning' : u.role === 'tutor' ? 'info' : 'dark'}">${roleNames[u.role]}</span></td><td><span class="badge ${u.status === 'Active' ? 'success' : 'danger'}">${u.status}</span></td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? 'Full control' : u.role === 'tutor' ? 'Assigned classes only' : 'Own classes only'}</td><td>${isAdmin() ? `<div class="button-row">${button('Manage', 'edit-user', 'light', `data-id="${u.id}"`)}${u.id !== 'u1' ? button(u.status === 'Active' ? 'Suspend' : 'Activate', 'toggle-user', 'light', `data-id="${u.id}"`) : ''}</div>` : '<span class="muted">Protected</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function learnersPage() { return usersPage('learners') }
function activitiesPage() {
  let acts = state.activities; if (state.currentRole === 'tutor') acts = acts.filter(a => { const c = cls(a.classId); return c?.tutorId === currentUser().id }); if (state.currentRole === 'learner') acts = acts.filter(a => cls(a.classId)?.learners.includes(currentUser().id));
  return `<div class="page-head"><div><span class="eyebrow">TEACHING</span><h1>${state.currentRole === 'learner' ? 'My Activities' : 'Activities & Assignments'}</h1><p>Create, submit, mark and track learning activities.</p></div>${state.currentRole !== 'learner' ? button('＋ New Activity', 'new-activity', 'primary') : ''}</div><div class="grid-3">${acts.map(a => activityCard(a)).join('') || '<div class="card empty"><b>No activities found</b><p>There is nothing to show here yet.</p></div>'}</div>`;
}
function activityCard(a) { const pct = a.total ? Math.round(a.submissions / a.total * 100) : 0; return `<div class="card"><div class="card-title"><span class="badge ${a.status === 'Open' ? 'success' : 'warning'}">${a.status}</span><span class="muted" style="font-size:9px">Due ${formatDate(a.due)}</span></div><h3 class="card-heading">${esc(a.title)}</h3><p class="muted small">${esc(className(a.classId))}</p><div class="progress-track" style="margin:16px 0 9px"><div class="progress-fill" style="width:${pct}%"></div></div><div class="split-small"><span>${a.submissions}/${a.total} submitted</span><span>${pct}%</span></div><div class="button-row" style="margin-top:15px">${button('View', 'activity-details', 'light', `data-id="${a.id}"`)}${state.currentRole === 'learner' ? button('Submit', 'submit-activity', 'primary', `data-id="${a.id}"`) : button('Submissions', 'submissions', 'light', `data-id="${a.id}"`)}</div></div>` }

function attendancePage() {
  let rows = state.attendance; if (state.currentRole === 'tutor') rows = rows.filter(a => cls(a.classId)?.tutorId === currentUser().id); if (state.currentRole === 'learner') rows = rows.filter(a => a.learnerId === currentUser().id);
  const present = rows.filter(a => a.status === 'Present').length; const rate = rows.length ? Math.round(present / rows.length * 100) : 0;
  return `<div class="page-head"><div><span class="eyebrow">ATTENDANCE</span><h1>${state.currentRole === 'learner' ? 'My Attendance' : 'Attendance Register'}</h1><p>Record participation, follow up absences and generate reports.</p></div><div class="head-actions">${button('↓ Export CSV', 'export-attendance', 'light')}${state.currentRole !== 'learner' ? button('＋ Record Attendance', 'mark-attendance', 'primary') : ''}</div></div><div class="kpis">${kpi('Attendance', rate + '%', 'Current view', '◷')}${kpi('Present', String(present), 'Recorded', '✓')}${kpi('Absent', String(rows.length - present), 'Follow up', '!')}${kpi('Records', String(rows.length), 'Total', '▦')}</div><div class="card table-card"><div class="toolbar" style="padding:16px 16px 0"><strong>Attendance history</strong><select class="select" id="attendance-filter"><option value="">All statuses</option><option>Present</option><option>Absent</option></select></div><div class="table-wrap"><table class="table"><thead><tr><th>Learner</th><th>Class</th><th>Date</th><th>Status</th><th>Tutor</th><th>Action</th></tr></thead><tbody>${rows.map(a => `<tr data-att-status="${a.status}"><td><div class="person"><span class="avatar">${initials(user(a.learnerId)?.name || 'L')}</span><strong>${esc(user(a.learnerId)?.name || 'Unknown')}</strong></div></td><td>${esc(className(a.classId))}</td><td>${formatDate(a.date)}</td><td><span class="badge ${a.status === 'Present' ? 'success' : 'danger'}">${a.status}</span></td><td>${esc(tutorName(cls(a.classId)))}</td><td>${state.currentRole === 'learner' ? '<span class="muted">View only</span>' : button('Edit', 'edit-attendance', 'light', `data-id="${a.id}"`)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function announcementsPage() {
  let anns = state.announcements; if (state.currentRole === 'learner') { const my = state.classes.filter(c => c.learners.includes(currentUser().id)).map(c => c.id); anns = anns.filter(a => a.audience === 'all' || my.includes(a.audience)); }
  return `<div class="page-head"><div><span class="eyebrow">COMMUNICATION</span><h1>Announcements</h1><p>Keep learners informed with classroom and global communication.</p></div>${state.currentRole !== 'learner' ? button('＋ Post Announcement', 'new-announcement', 'primary') : ''}</div><div class="grid-2"><div class="card">${anns.map(a => `<div class="activity"><div class="mini-icon">◌</div><div style="flex:1"><strong>${esc(a.title)}</strong><small>${a.audience === 'all' ? 'All GM Tutoring learners' : className(a.audience)} · ${esc(a.time)}</small></div>${isAdmin() ? button('×', 'delete-announcement', 'danger', `data-id="${a.id}"`) : ''}</div>`).join('') || '<div class="empty"><b>No announcements</b><p>Nothing has been posted for this audience.</p></div>'}</div><div class="card"><div class="card-title"><h3>Communication health</h3></div><div class="notice"><strong>Centralised communication.</strong>Global announcements reach all learners; classroom announcements remain scoped to the relevant classroom.</div><div class="progress-list" style="margin-top:18px">${[['Global announcements', 150, 100], ['Grade 12 Mathematics', 28, 74], ['Grade 11 Sciences', 24, 58]].map((x, i) => `<div class="progress-row"><div><span>${x[0]}</span><span>${x[1]} recipients</span></div><div class="progress-track"><div class="progress-fill ${i === 1 ? 'blue' : i === 2 ? 'green' : ''}" style="width:${x[2]}%"></div></div></div>`).join('')}</div></div></div>`;
}

function livePage() {
  let sessions = state.sessions; if (state.currentRole === 'tutor') sessions = sessions.filter(s => s.tutorId === currentUser().id); if (state.currentRole === 'learner') sessions = sessions.filter(s => cls(s.classId)?.learners.includes(currentUser().id));
  return `<div class="page-head"><div><span class="eyebrow">LIVE TEACHING</span><h1>${state.currentRole === 'learner' ? 'Live Lessons' : 'Live Sessions'}</h1><p>Schedule, launch, record and review online lessons.</p></div>${state.currentRole !== 'learner' ? button('＋ Schedule Live Class', 'schedule', 'primary') : ''}</div><div class="grid-2"><div class="card"><div class="card-title"><h3>Upcoming Sessions</h3><span class="badge info">${sessions.length} scheduled</span></div><div class="schedule">${sessions.map(scheduleCard).join('') || '<div class="empty"><b>No sessions</b><p>Your next lesson will appear here.</p></div>'}</div></div><div class="card"><div class="card-title"><h3>Classroom controls</h3></div>${['HD video & audio', 'Screen sharing', 'Live chat', 'Participant list', 'Mute / camera controls', 'Recording management'].map((x, i) => `<div class="setting-row"><div><strong>${x}</strong><small>${['Optimised for online tutoring', 'Present notes and class activities', 'Keep learners engaged', 'Monitor class participation', 'Tutor-controlled classroom', 'Associate recordings with classrooms'][i]}</small></div><span class="badge success">Ready</span></div>`).join('')}</div></div><div class="card" style="margin-top:18px"><div class="card-title"><h3>Recent Recordings</h3><button class="text-link" data-action="route-recordings">VIEW RECORDINGS →</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Lesson</th><th>Classroom</th><th>Date</th><th>Duration</th><th>Action</th></tr></thead><tbody>${state.recordings.map(r => `<tr><td><strong>${esc(r.title)}</strong></td><td>${esc(className(r.classId))}</td><td>${formatDate(r.date)}</td><td>${r.duration}</td><td>${button('▶ Watch', 'watch-recording', 'light', `data-id="${r.id}"`)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function materialsPage() { let ms = state.materials; if (state.currentRole === 'tutor') ms = ms.filter(m => cls(m.classId)?.tutorId === currentUser().id); if (state.currentRole === 'learner') ms = ms.filter(m => cls(m.classId)?.learners.includes(currentUser().id)); return `<div class="page-head"><div><span class="eyebrow">LEARNING LIBRARY</span><h1>Materials</h1><p>Store notes, revision packs and learning resources against the correct classroom.</p></div>${state.currentRole !== 'learner' ? button('＋ Upload Material', 'upload-material', 'primary') : ''}</div><div class="grid-3">${ms.map(m => `<div class="card material-card"><div class="material-icon">${m.type === 'PDF' ? 'PDF' : 'DOC'}</div><span class="badge info">${esc(m.type)}</span><h3 class="card-heading">${esc(m.name)}</h3><p class="muted small">${esc(className(m.classId))} · ${m.size}</p><div class="button-row">${button('Open', 'open-material', 'light', `data-id="${m.id}"`)}${button('Download', 'download-material', 'primary', `data-id="${m.id}"`)}</div></div>`).join('')}</div>` }
function reportsPage() { return `<div class="page-head"><div><span class="eyebrow">INSIGHTS</span><h1>Reports & Analytics</h1><p>Monitor attendance, academic progress, tutor activity and classroom performance.</p></div>${button('↓ Export Report', 'export', 'primary')}</div><div class="kpis">${kpi('Attendance', '92%', '↗ 4.2%', '◷')}${kpi('Avg Progress', '78%', '↗ 3.8%', '✓')}${kpi('Submission Rate', '81%', '↗ 6.2%', '▤')}${kpi('Tutor Activity', '96%', 'Stable', '◉')}</div><div class="grid-2"><div class="card"><div class="card-title"><h3>Class performance</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Classroom</th><th>Progress</th><th>Attendance</th><th>Status</th></tr></thead><tbody>${state.classes.map(c => `<tr><td>${esc(c.name)}</td><td>${c.progress}%</td><td>94%</td><td><span class="badge success">On track</span></td></tr>`).join('')}</tbody></table></div></div><div class="card"><div class="card-title"><h3>Performance trend</h3></div><div class="chart"><div class="bars">${[58, 63, 67, 71, 74, 78, 82].map((n, i) => `<div class="bar" style="height:${n}%"><i>${n}%</i><span>T${i + 1}</span></div>`).join('')}</div></div></div></div>` }
function paymentsPage() { if (!isAdmin()) return restrictedPage('Payments'); return `<div class="page-head"><div><span class="eyebrow">BUSINESS</span><h1>Payments</h1><p>Frontend view for subscriptions, registration fees and outstanding balances.</p></div>${button('＋ Record Payment', 'record-payment', 'primary')}</div><div class="kpis">${kpi('Collected', 'R48,750', 'This month', 'R')}${kpi('Outstanding', 'R9,500', 'Requires follow-up', '!')}${kpi('Paid learners', '137', '92% current', '✓')}${kpi('Payment success', '96%', '↗ 2.1%', '↗')}</div><div class="card table-card"><div class="table-wrap"><table class="table"><thead><tr><th>Learner</th><th>Amount</th><th>Date</th><th>Method</th><th>Status</th><th>Action</th></tr></thead><tbody>${state.payments.map(p => `<tr><td>${esc(user(p.learnerId)?.name || 'Unknown')}</td><td>${currency(p.amount)}</td><td>${formatDate(p.date)}</td><td>${p.method}</td><td><span class="badge ${p.status === 'Paid' ? 'success' : 'danger'}">${p.status}</span></td><td>${button('View', 'payment-details', 'light', `data-id="${p.id}"`)}</td></tr>`).join('')}</tbody></table></div></div>` }
function referralsPage() { if (!isAdmin()) return restrictedPage('Referrals'); return `<div class="page-head"><div><span class="eyebrow">GROWTH</span><h1>Marketing Referrals</h1><p>Track referral codes, recruited learners, commissions and bonus progress.</p></div>${button('＋ Add Agent', 'add-referral', 'primary')}</div><div class="grid-2"><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Agent</th><th>Code</th><th>Learners</th><th>Commission</th><th>Action</th></tr></thead><tbody>${state.referrals.map(r => `<tr><td><strong>${esc(r.name)}</strong></td><td><span class="badge info">${esc(r.code)}</span></td><td>${r.learners}</td><td>${currency(r.commission)}</td><td>${button('Details', 'referral-details', 'light', `data-id="${r.id}"`)}</td></tr>`).join('')}</tbody></table></div></div><div class="card"><div class="card-title"><h3>Bonus progress</h3></div>${state.referrals.map(r => `<div class="progress-row" style="margin-bottom:18px"><div><span>${esc(r.name)}</span><span>${r.bonusRemaining} learners to bonus</span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, r.learners / 10 * 100)}%"></div></div></div>`).join('')}</div></div>` }
function parentsPage() { if (!isAdmin()) return restrictedPage('Parents'); const parents = state.parents || []; return `<div class="page-head"><div><span class="eyebrow">FAMILY PORTAL</span><h1>Parent Accounts</h1><p>Prepared for parent access to attendance, marks, progress, announcements and payments.</p></div>${button('＋ Add Parent', 'add-parent', 'primary')}</div><div class="grid-3">${parents.map((x, i) => `<div class="card"><div class="person"><span class="avatar">${initials(x.name)}</span><div><strong>${esc(x.name)}</strong><small>Parent · ${esc(user(x.learnerId)?.name || 'Unlinked')}</small></div></div><div class="notice" style="margin:15px 0"><strong>${esc(x.status)}</strong><span>${esc(x.email)}</span></div><div class="button-row">${button('Open portal', 'parent-details', 'light', `data-index="${i}"`)}${x.status !== 'Active' ? button('Send Invite', 'send-parent-invite', 'primary', `data-index="${i}"`) : ''}</div></div>`).join('') || '<div class="empty card"><b>No parent accounts</b><p>Add a parent account to get started.</p></div>'}</div>` }
function restrictedPage(name) { return `<div class="empty card"><b>${esc(name)} is restricted</b><p>Your current role does not have access to this business area.</p></div>` }
function profilePage() { const u = currentUser(); return `<div class="page-head"><div><span class="eyebrow">ACCOUNT</span><h1>My Profile</h1><p>Manage your account details.</p></div></div><div class="card profile-card"><div class="person profile-head"><span class="avatar profile-avatar">${initials(u.name)}</span><div><strong>${esc(u.name)}</strong><small>${roleNames[u.role]} · ${esc(u.email)}</small></div></div><div class="form-grid"><div class="field"><label>Full name<input id="profile-name" value="${esc(u.name)}"></label></div><div class="field"><label>Email<input id="profile-email" type="email" value="${esc(u.email)}"></label></div><div class="field"><label>Phone<input id="profile-phone" value="${esc(u.phone || '')}"></label></div><div class="field"><label>Role<input value="${roleNames[u.role]}" disabled></label></div></div>${button('Save Profile', 'save-profile', 'primary')}</div>` }
function settingsPage() { const tab = state.activeSettingTab || 'General'; const tabs = ['General', 'Security & Permissions', 'Notifications', 'Live Classroom', 'Branding']; return `<div class="page-head"><div><span class="eyebrow">PLATFORM CONTROL</span><h1>Settings</h1><p>Configure platform behaviour and security controls.</p></div></div><div class="settings-grid"><div class="card settings-nav">${tabs.map(t => `<button class="settings-tab ${tab === t ? 'active' : ''}" data-setting-tab="${esc(t)}">${esc(t)}</button>`).join('')}</div><div class="card settings-panel">${settingsContent(tab)}</div></div>` }
function settingsContent(tab) { if (tab === 'Branding') return `<h3 class="panel-heading">Branding</h3><div class="brand-preview"><img src="assets/gm-tutoring-logo.jpeg" alt="GM Tutoring logo"><div><strong>GM Tutoring</strong><small>Unleash your inner genius.</small></div></div><div class="notice">Your supplied GM Tutoring artwork is used throughout the platform as the official visual identity.</div>`; if (tab === 'Notifications') return `<h3 class="panel-heading">Notifications</h3>${settingRow('Email notifications', 'Send platform updates by email', 'emailNotifications')}${settingRow('SMS notifications', 'Enable SMS reminders when connected to a provider', 'smsNotifications')} ${button('Save Changes', 'save-settings', 'primary')}`; if (tab === 'Live Classroom') return `<h3 class="panel-heading">Live Classroom</h3>${settingRow('Automatic recording', 'Record scheduled live lessons by default', 'autoRecord')}${settingRow('Participant controls', 'Allow tutors to mute and manage classroom participants', 'ownership')} ${button('Save Changes', 'save-settings', 'primary')}`; if (tab === 'Security & Permissions') return `<h3 class="panel-heading">Security & Permissions</h3>${settingRow('Centralised learner ownership', 'Tutors cannot transfer or delete learner records', 'ownership')}${settingRow('Two-factor authentication', 'Require 2FA for administrator accounts', 'twoFactor')}${settingRow('Tutor account alerts', 'Notify administrators when tutor access changes', 'tutorAlerts')}<div class="notice" style="margin-top:18px"><strong>Protected by role-based access.</strong>Tutors only see assigned classrooms and learners; learners only see their own learning data.</div>`; return `<h3 class="panel-heading">General Settings</h3>${settingRow('Centralised learner ownership', 'GM Tutoring retains classroom and learner records', 'ownership')}${settingRow('Email notifications', 'Send important platform notifications', 'emailNotifications')}${settingRow('Two-factor authentication', 'Require 2FA for administrator accounts', 'twoFactor')}${settingRow('Automatic recording', 'Record scheduled live lessons by default', 'autoRecord')}${button('Save Changes', 'save-settings', 'primary')}` }
function settingRow(title, desc, key) { return `<div class="setting-row"><div><strong>${esc(title)}</strong><small>${esc(desc)}</small></div><button class="toggle ${state.settings[key] ? 'on' : ''}" aria-pressed="${!!state.settings[key]}" data-action="toggle-setting" data-key="${key}"></button></div>` }

function render() {
  const app = qs('#app'); if (app.classList.contains('hidden')) return; renderNav(); let title = 'Dashboard', html = '';
  switch (route) { case 'dashboard': html = dashboard(); break; case 'classes': title = 'Classrooms'; html = classesPage(); break; case 'users': title = 'Users'; html = usersPage('all'); break; case 'tutors': title = 'Tutors'; html = usersPage('tutors'); break; case 'learners': title = 'My Learners'; html = learnersPage(); break; case 'live': title = 'Live Sessions'; html = livePage(); break; case 'activities': title = 'Activities'; html = activitiesPage(); break; case 'attendance': title = 'Attendance'; html = attendancePage(); break; case 'announcements': title = 'Announcements'; html = announcementsPage(); break; case 'materials': title = 'Materials'; html = materialsPage(); break; case 'reports': title = 'Reports'; html = reportsPage(); break; case 'payments': title = 'Payments'; html = paymentsPage(); break; case 'referrals': title = 'Referrals'; html = referralsPage(); break; case 'parents': title = 'Parents'; html = parentsPage(); break; case 'profile': title = 'Profile'; html = profilePage(); break; case 'settings': title = 'Settings'; html = settingsPage(); break; case 'recordings': title = 'Recordings'; html = recordingsPage(); break; default: route = 'dashboard'; html = dashboard(); }
  qs('#page').innerHTML = html; layout(title); bindPageEnhancements();
}
function recordingsPage() { return `<div class="page-head"><div><span class="eyebrow">LESSON LIBRARY</span><h1>Recordings</h1><p>Recordings stay attached to the classroom, not the individual tutor.</p></div></div><div class="grid-3">${state.recordings.map(r => `<div class="card recording-card"><div class="recording-thumb">▶<span>${r.duration}</span></div><h3 class="card-heading">${esc(r.title)}</h3><p class="muted small">${esc(className(r.classId))} · ${formatDate(r.date)}</p>${button('Watch Recording', 'watch-recording', 'primary', `data-id="${r.id}"`)}</div>`).join('')}</div>` }
function bindPageEnhancements() {
  const classSearch = qs('#class-search'); if (classSearch) classSearch.addEventListener('input', filterClasses);
  const subject = qs('#class-subject-filter'); if (subject) subject.addEventListener('change', filterClasses); const status = qs('#class-status-filter'); if (status) status.addEventListener('change', filterClasses);
  const userSearch = qs('#user-search'); if (userSearch) userSearch.addEventListener('input', () => { const q = userSearch.value.toLowerCase(); qsa('#user-table tr').forEach(r => r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none') });
  const att = qs('#attendance-filter'); if (att) att.addEventListener('change', () => qsa('[data-att-status]').forEach(r => r.style.display = !att.value || r.dataset.attStatus === att.value ? '' : 'none'));
}
function filterClasses() { const q = (qs('#class-search')?.value || '').toLowerCase(); const sub = qs('#class-subject-filter')?.value || ''; const status = qs('#class-status-filter')?.value || ''; qsa('.class-card').forEach(c => c.style.display = (!q || c.dataset.search.includes(q)) && (!sub || c.dataset.subject === sub) && (!status || c.dataset.status === status) ? '' : 'none') }

function modal(title, body, foot = '') { qs('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h3>${title}</h3><button class="icon-btn" aria-label="Close" data-action="close-modal">✕</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div></div>`; const first = qs('#modal-root input, #modal-root textarea, #modal-root select'); if (first) setTimeout(() => first.focus(), 50) }
function closeModal() { if (qs('.live-room')) { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop(); if (screenShareStream) { screenShareStream.getTracks().forEach(t => t.stop()); screenShareStream = null; } if (liveMediaStream) { liveMediaStream.getTracks().forEach(t => t.stop()); liveMediaStream = null; } stopLiveTimer(); } qs('#modal-root').innerHTML = '' }
function showSignup() {
  modal('Create Account', `<p class="muted">Create a GM Tutoring account and choose your role. Accounts are stored locally in your browser when the backend is offline.</p><div class="form-grid"><div class="field"><label>Account role<select id="signup-role"><option value="learner">Learner</option><option value="tutor">Tutor</option><option value="admin">Administrator</option></select></label></div><div class="field"><label>Full name<input id="signup-name" required placeholder="Your full name"></label></div><div class="field"><label>Email address<input id="signup-email" type="email" required placeholder="you@example.com"></label></div><div class="field"><label>Password<input id="signup-password" type="password" minlength="8" required placeholder="At least 8 characters"></label></div><div class="field"><label>Confirm password<input id="signup-confirm" type="password" minlength="8" required></label></div><div class="field span-2"><label>Phone (optional)<input id="signup-phone" placeholder="+27 ..."></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Create Account', 'create-account', 'primary')}`);
}
function showNewClass() { modal('Create Classroom', `<div class="form-grid"><div class="field"><label>Classroom name<input id="m-class-name" required placeholder="Grade 12 Mathematics"></label></div><div class="field"><label>Subject<select id="m-class-sub"><option>Mathematics</option><option>Physical Sciences</option><option>Accounting</option><option>English</option><option>Life Sciences</option></select></label></div><div class="field"><label>Grade<select id="m-class-grade"><option>Grade 8</option><option>Grade 9</option><option>Grade 10</option><option>Grade 11</option><option>Grade 12</option></select></label></div><div class="field"><label>Assign tutor<select id="m-class-tutor"><option value="">Unassigned</option>${state.users.filter(u => u.role === 'tutor' && u.status === 'Active').map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Create Classroom', 'create-class', 'primary')}`) }
function showNewUser() { modal('Add User', `<div class="form-grid"><div class="field"><label>Full name<input id="m-user-name" required placeholder="New user"></label></div><div class="field"><label>Email<input id="m-user-email" type="email" required placeholder="user@example.com"></label></div><div class="field"><label>Role<select id="m-user-role"><option value="tutor">Tutor</option><option value="learner">Learner</option></select></label></div><div class="field"><label>Initial password<input id="m-user-pass" type="text" value="Welcome123!"></label></div><div class="field span-2"><label>Phone<input id="m-user-phone" placeholder="+27 ..."></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Create User', 'create-user', 'primary')}`) }
function showNewActivity() { modal('Create Activity', `<div class="form-grid"><div class="field span-2"><label>Activity title<input id="m-act-title" required placeholder="Double Angle Identities"></label></div><div class="field"><label>Classroom<select id="m-act-class">${state.classes.filter(c => state.currentRole === 'admin' || c.tutorId === currentUser().id).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div><div class="field"><label>Due date<input id="m-act-due" type="date" value="2026-08-20"></label></div><div class="field span-2"><label>Instructions<textarea id="m-act-instructions" placeholder="Add instructions for learners..."></textarea></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Publish Activity', 'create-activity', 'primary')}`) }
function showAnnouncement() { modal('Post Announcement', `<div class="form-grid"><div class="field span-2"><label>Message<textarea id="m-ann-text" required placeholder="Write your announcement..."></textarea></label></div><div class="field span-2"><label>Audience<select id="m-ann-audience"><option value="all">All GM Tutoring learners</option>${state.classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Post Announcement', 'create-announcement', 'primary')}`) }
function showSchedule() { modal('Schedule Live Class', `<div class="form-grid"><div class="field"><label>Classroom<select id="m-s-class">${state.classes.filter(c => state.currentRole === 'admin' || c.tutorId === currentUser().id).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div><div class="field"><label>Tutor<select id="m-s-tutor">${state.users.filter(u => u.role === 'tutor' && u.status === 'Active').map(u => `<option value="${u.id}" ${u.id === currentUser().id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label></div><div class="field"><label>Date<input id="m-s-date" type="date" value="${todayISO}"></label></div><div class="field"><label>Start time<input id="m-s-start" type="time" value="18:00"></label></div><div class="field"><label>End time<input id="m-s-end" type="time" value="19:00"></label></div><div class="field"><label>Recording<select id="m-s-record"><option value="true">Record automatically</option><option value="false">Do not record</option></select></label></div><div class="field span-2"><label>Lesson title<input id="m-s-title" value="Live tutoring lesson"></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Schedule Lesson', 'save-schedule', 'primary')}`) }
function showClassDetails(id) { const c = cls(id); if (!c) return; currentClassId = id; const learners = c.learners.map(x => user(x)).filter(Boolean); modal(esc(c.name), `<div class="hero-card mini-hero"><div><span class="eyebrow">${esc(c.subject.toUpperCase())}</span><h2>${esc(c.grade)}</h2><p>Owned by GM Tutoring · Assigned tutor: ${esc(tutorName(c))}</p></div></div><div class="kpis">${kpi('Learners', String(learners.length), 'Enrolled', '♙')}${kpi('Progress', c.progress + '%', 'Current term', '✓')}${kpi('Attendance', '94%', 'This month', '◷')}${kpi('Materials', String(state.materials.filter(m => m.classId === id).length), 'Available', '▤')}</div><div class="card-inner"><h4>Learners</h4>${learners.map(l => `<div class="activity"><span class="avatar">${initials(l.name)}</span><div style="flex:1"><strong>${esc(l.name)}</strong><small>${esc(l.email)}</small></div><span class="badge success">Active</span></div>`).join('') || '<div class="empty"><b>No learners yet</b></div>'}</div><div class="notice"><strong>Tutor replacement is safe.</strong> Replace a tutor without changing learners, activities, attendance, materials, recordings or class history.</div>`, `${button('Close', 'close-modal', 'light')}${isAdmin() ? button('Replace Tutor', 'replace-tutor', 'primary', `data-id="${id}"`) : ''}${isAdmin() ? button('Manage Learners', 'manage-class-learners', 'light', `data-id="${id}"`) : ''}`) }
function showLiveRoom(sessionId) {
  const s = state.sessions.find(x => x.id === sessionId) || state.sessions[0];
  if (!s) { toast('No live session is available.', 'error'); return; }
  currentSessionId = s.id; liveCameraEnabled = true; liveMicEnabled = true; recordingChunks = []; mediaRecorder = null; liveMediaStream = null; screenShareStream = null;
  modal('Live Classroom', `<div class="live-room">
    <div class="live-top"><div><strong>● LIVE · ${esc(className(s.classId))}</strong><small>${esc(s.title)}</small></div><span class="badge success">${s ? cls(s.classId)?.learners.length || 0 : 0} learners</span></div>
    <div class="live-stage"><div class="camera" id="camera-preview"><video id="live-video" autoplay muted playsinline></video><span>GM</span><small id="camera-state">Connecting camera...</small></div><div class="live-overlay"><span class="live-timer">00:00</span><span id="recording-indicator" class="recording-indicator" style="display:none">RECORDING</span></div></div>
    <div class="notice" style="margin:10px 15px"><strong>Device controls</strong><span>Camera and microphone permissions are requested when the room opens. If access is denied, the controls remain usable in the browser fallback mode.</span></div>
    <div class="live-controls">
      <button title="Mute microphone" aria-label="Mute microphone" data-live="mic" class="enabled">🎤</button>
      <button title="Turn camera off" aria-label="Turn camera off" data-live="camera" class="enabled">📷</button>
      <button title="Share screen" aria-label="Share screen" data-live="screen">▣</button>
      <button title="Start recording" aria-label="Start recording" data-live="record">⏺</button>
      <button title="Open chat" aria-label="Open chat" data-live="chat">💬</button>
      <button title="Show participants" aria-label="Show participants" data-live="participants">♙</button>
      <button title="Open whiteboard" aria-label="Open whiteboard" data-live="whiteboard">✎</button>
      <button title="Open reactions" aria-label="Open reactions" data-live="reactions">☺</button>
      <button title="Enter full screen" aria-label="Enter full screen" data-live="fullscreen">⛶</button>
      <button class="end" title="${state.currentRole === 'learner' ? 'Leave classroom' : 'End call'}" data-live="end">☎</button>
    </div>
    <div class="live-panels">
      <div class="live-panel" id="live-chat-panel"><strong>Live chat</strong><div id="chat-messages"><div class="chat-msg"><b>System</b><span>Welcome to the GM Tutoring classroom.</span></div></div><div class="chat-compose"><input id="chat-input" placeholder="Message the class..."><button class="btn btn-primary" data-action="send-chat">Send</button></div></div>
      <div class="live-panel" id="live-participants-panel"><strong>Participants</strong>${(s ? cls(s.classId)?.learners : []).map(id => `<div class="participant-row"><span class="avatar">${initials(user(id)?.name || 'L')}</span><span>${esc(user(id)?.name || 'Learner')}</span><span class="badge success">Online</span></div>`).join('') || '<p class="muted">No participants.</p>'}</div>
      <div class="live-panel whiteboard-panel" id="live-whiteboard-panel"><div class="panel-heading-row"><strong>Whiteboard</strong>${state.currentRole !== 'learner' ? button('Clear board', 'clear-whiteboard', 'light') : ''}</div><canvas id="live-whiteboard" aria-label="Shared whiteboard"></canvas><small class="muted">Write or draw on the board during the lesson.</small></div>
      <div class="live-panel reactions-panel" id="live-reactions-panel"><strong>Reactions</strong><div class="reaction-list">${['👏', '👍', '❤️', '💡', '❓'].map(reaction => `<button type="button" class="reaction-btn" data-reaction="${reaction}" aria-label="Send ${reaction} reaction">${reaction}</button>`).join('')}</div><div id="reaction-feed" class="reaction-feed"></div></div>
    </div></div>`, `${button('Leave classroom', 'close-live', 'light')}`);
  startLiveTimer();
  setupWhiteboard();
  api(`/sessions/${s.id}/start`, { method: 'PATCH' }).then(updated => { const local = state.sessions.find(x => x.id === s.id); if (local) Object.assign(local, updated); }).catch(() => { });
  initialiseLiveMedia();
}
let liveInterval = null; let liveSeconds = 0;
function startLiveTimer() { clearInterval(liveInterval); liveSeconds = 0; liveInterval = setInterval(() => { liveSeconds++; const el = qs('.live-timer'); if (el) { const m = String(Math.floor(liveSeconds / 60)).padStart(2, '0'); const sec = String(liveSeconds % 60).padStart(2, '0'); el.textContent = `${m}:${sec}` } }, 1000) }
function stopLiveTimer() { clearInterval(liveInterval); liveInterval = null }
async function initialiseLiveMedia() {
  if (!navigator.mediaDevices?.getUserMedia) { qs('#camera-state').textContent = 'Camera and microphone unavailable'; updateMediaControl('mic', false); updateMediaControl('camera', false); toast('Camera/microphone APIs are unavailable in this browser.', 'error'); return; }
  try {
    liveMediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const video = qs('#live-video'); if (video) { video.srcObject = liveMediaStream; qs('#camera-preview')?.classList.add('video-ready'); }
    liveMediaStream.getAudioTracks().forEach(track => track.enabled = liveMicEnabled);
    liveMediaStream.getVideoTracks().forEach(track => track.enabled = liveCameraEnabled);
    updateMediaControl('mic', liveMicEnabled); updateMediaControl('camera', liveCameraEnabled); qs('#camera-state').textContent = liveCameraEnabled ? 'Camera on' : 'Camera off';
  } catch (err) {
    liveMediaStream = null; liveMicEnabled = false; liveCameraEnabled = false;
    updateMediaControl('mic', false); updateMediaControl('camera', false);
    const status = qs('#camera-state'); if (status) status.textContent = 'Camera/microphone unavailable';
    toast('Camera/microphone permission was not granted. Enable access in the browser to use them.', 'error');
  }
}
function setLiveButton(name, enabled) { const b = document.querySelector(`[data-live="${name}"]`); if (b) b.classList.toggle('enabled', enabled) }
function updateMediaControl(name, enabled) {
  const button = document.querySelector(`[data-live="${name}"]`); if (!button) return;
  const labels = name === 'mic' ? (enabled ? ['Mute microphone', '🎤'] : ['Unmute microphone', '🔇']) : (enabled ? ['Turn camera off', '📷'] : ['Turn camera on', '🚫']);
  button.title = labels[0]; button.setAttribute('aria-label', labels[0]); button.textContent = labels[1]; button.classList.toggle('enabled', enabled);
}
function setupWhiteboard() {
  const canvas = qs('#live-whiteboard'); if (!canvas) return;
  const context = canvas.getContext('2d'); let drawing = false;
  const resize = () => { const previous = canvas.toDataURL(); const ratio = window.devicePixelRatio || 1; canvas.width = canvas.clientWidth * ratio; canvas.height = canvas.clientHeight * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0); if (previous) { const image = new Image(); image.onload = () => context.drawImage(image, 0, 0, canvas.clientWidth, canvas.clientHeight); image.src = previous; } };
  resize(); window.addEventListener('resize', resize, { once: true });
  const point = e => { const rect = canvas.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top } };
  canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); const p = point(e); context.beginPath(); context.moveTo(p.x, p.y) });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = point(e); context.lineWidth = 3; context.lineCap = 'round'; context.strokeStyle = '#20242b'; context.lineTo(p.x, p.y); context.stroke() });
  canvas.addEventListener('pointerup', () => { drawing = false }); canvas.addEventListener('pointercancel', () => { drawing = false });
  qs('[data-action="clear-whiteboard"]')?.addEventListener('click', () => context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight));
}
function sendReaction(reaction) {
  const feed = qs('#reaction-feed'); if (!feed) return; const item = document.createElement('span'); item.className = 'reaction-pop'; item.textContent = `${reaction} ${currentUser().name.split(' ')[0]}`; feed.appendChild(item); setTimeout(() => item.remove(), 4000);
}
async function toggleFullScreen() {
  const room = qs('.live-room'); if (!room) return;
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await room.requestFullscreen(); } catch { toast('Full-screen mode is unavailable in this browser.', 'error'); }
}
async function toggleScreenShare() {
  if (screenShareStream) { screenShareStream.getTracks().forEach(t => t.stop()); screenShareStream = null; const v = qs('#live-video'); if (v && liveMediaStream) v.srcObject = liveMediaStream; setLiveButton('screen', false); toast('Screen sharing stopped.'); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) { toast('Screen sharing is not available in this browser.', 'error'); return; }
  try { screenShareStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); const v = qs('#live-video'); if (v) v.srcObject = screenShareStream; setLiveButton('screen', true); screenShareStream.getVideoTracks()[0].onended = () => { screenShareStream = null; if (v && liveMediaStream) v.srcObject = liveMediaStream; setLiveButton('screen', false); }; toast('Screen sharing started.'); } catch { toast('Screen sharing was cancelled.', 'error'); }
}
async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); return; }
  let stream = liveMediaStream || screenShareStream;
  if (!stream) { toast('Allow camera/microphone or start screen sharing before recording.', 'error'); return; }
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(x => MediaRecorder.isTypeSupported?.(x)) || '';
  try { mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch { toast('Recording is not supported by this browser.', 'error'); return; }
  recordingChunks = []; recordingStartedAt = Date.now();
  mediaRecorder.ondataavailable = e => { if (e.data?.size) recordingChunks.push(e.data) };
  mediaRecorder.onerror = () => toast('The browser reported a recording error.', 'error');
  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'video/webm' }); const duration = Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000));
    const file = new File([blob], `gm-tutoring-${currentSessionId}-${Date.now()}.webm`, { type: blob.type });
    const fd = new FormData(); fd.append('file', file); fd.append('duration', formatDuration(duration));
    const indicator = qs('#recording-indicator'); if (indicator) indicator.style.display = 'none'; const b = document.querySelector('[data-live="record"]'); b?.classList.remove('recording');
    try { const rec = await api(`/sessions/${currentSessionId}/recording`, { method: 'POST', body: fd }); state.recordings.unshift(rec); const ss = state.sessions.find(x => x.id === currentSessionId); if (ss) { ss.recording = true; ss.recordingId = rec.id; } saveState(); toast(`Recording saved (${formatDuration(duration)}).`); } catch (err) { toast(`Recording could not be saved: ${err.message}`, 'error'); }
  };
  mediaRecorder.start(500); const indicator = qs('#recording-indicator'); if (indicator) indicator.style.display = 'inline-flex'; document.querySelector('[data-live="record"]')?.classList.add('recording'); toast('Recording started.');
}
function formatDuration(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${m}m ${String(s).padStart(2, '0')}s` }
async function cleanupLive() {
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  if (screenShareStream) { screenShareStream.getTracks().forEach(t => t.stop()); screenShareStream = null; }
  if (liveMediaStream) { liveMediaStream.getTracks().forEach(t => t.stop()); liveMediaStream = null; }
  stopLiveTimer();
}
async function handleLiveControl(type) {
  if (type === 'end' || type === 'close-live') {
    if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); await new Promise(r => setTimeout(r, 250)); }
    if (state.currentRole !== 'learner') {
      try { if (currentSessionId) await api(`/sessions/${currentSessionId}/end`, { method: 'PATCH' }); } catch { }
      const ss = state.sessions.find(x => x.id === currentSessionId); if (ss) ss.status = 'Completed';
    }
    await cleanupLive(); closeModal(); render(); toast(state.currentRole === 'learner' ? 'You left the live classroom.' : 'Live session ended successfully.'); return;
  }
  if (type === 'mic') { liveMicEnabled = !liveMicEnabled; liveMediaStream?.getAudioTracks().forEach(t => t.enabled = liveMicEnabled); updateMediaControl('mic', liveMicEnabled); toast(liveMicEnabled ? 'Microphone unmuted' : 'Microphone muted'); return }
  if (type === 'camera') { liveCameraEnabled = !liveCameraEnabled; liveMediaStream?.getVideoTracks().forEach(t => t.enabled = liveCameraEnabled); const st = qs('#camera-state'); if (st) st.textContent = liveCameraEnabled ? 'Camera on' : 'Camera off'; updateMediaControl('camera', liveCameraEnabled); toast(liveCameraEnabled ? 'Camera turned on' : 'Camera turned off'); return }
  if (type === 'screen') { await toggleScreenShare(); return }
  if (type === 'record') { await toggleRecording(); return }
  if (type === 'chat') { qs('#live-chat-panel')?.classList.toggle('show'); return }
  if (type === 'participants') { qs('#live-participants-panel')?.classList.toggle('show'); return }
  if (type === 'whiteboard') { qs('#live-whiteboard-panel')?.classList.toggle('show'); return }
  if (type === 'reactions') { qs('#live-reactions-panel')?.classList.toggle('show'); return }
  if (type === 'fullscreen') { await toggleFullScreen(); return }
}

function showActivity(id) { const a = activityById(id); if (!a) return; currentActivityId = id; const mine = state.submissions.find(s => s.activityId === id && s.learnerId === currentUser().id); modal(esc(a.title), `<div class="notice"><strong>${esc(className(a.classId))}</strong>Due ${formatDate(a.due)} · ${esc(a.instructions || 'Complete the activity and submit your work.')}</div><div class="card-inner"><h4>Submission status</h4><div class="status-grid"><div><small>Submitted</small><strong>${a.submissions}/${a.total}</strong></div><div><small>Your status</small><strong>${mine ? 'Submitted' : 'Not submitted'}</strong></div><div><small>Mark</small><strong>${mine?.mark ?? '—'}${mine?.mark != null ? '%' : ''}</strong></div></div>${mine?.feedback ? `<div class="notice" style="margin-top:15px"><strong>Tutor feedback</strong>${esc(mine.feedback)}</div>` : ''}</div>`, `${button('Close', 'close-modal', 'light')}${state.currentRole === 'learner' ? button(mine ? 'Update Submission' : 'Submit Activity', 'submit-activity', 'primary', `data-id="${id}"`) : button('View Submissions', 'submissions', 'primary', `data-id="${id}"`)}`) }
function showSubmissions(id) { const a = activityById(id); if (!a) return; const subs = state.submissions.filter(s => s.activityId === id); modal(`Submissions · ${esc(a.title)}`, `<div class="table-wrap"><table class="table"><thead><tr><th>Learner</th><th>File</th><th>Mark</th><th>Feedback</th><th>Action</th></tr></thead><tbody>${subs.map(s => `<tr><td>${esc(user(s.learnerId)?.name || 'Learner')}</td><td>${esc(s.filename)}</td><td>${s.mark ?? '—'}</td><td>${esc(s.feedback || '—')}</td><td>${s.mark == null ? button('Mark', 'mark-submission', 'primary', `data-id="${s.id}"`) : button('Edit mark', 'mark-submission', 'light', `data-id="${s.id}"`)}</td></tr>`).join('') || '<tr><td colspan="5">No submissions yet.</td></tr>'}</tbody></table></div>`, button('Close', 'close-modal', 'light')) }
function showEditUser(id) { const u = user(id); if (!u) return; modal('Manage User', `<div class="form-grid"><div class="field"><label>Full name<input id="edit-user-name" value="${esc(u.name)}"></label></div><div class="field"><label>Email<input id="edit-user-email" type="email" value="${esc(u.email)}"></label></div><div class="field"><label>Phone<input id="edit-user-phone" value="${esc(u.phone || '')}"></label></div><div class="field"><label>Status<select id="edit-user-status"><option ${u.status === 'Active' ? 'selected' : ''}>Active</option><option ${u.status === 'Suspended' ? 'selected' : ''}>Suspended</option></select></label></div></div><div class="notice" style="margin-top:15px"><strong>Role: ${roleNames[u.role]}</strong>${u.role === 'tutor' ? 'Tutor access is limited to assigned classrooms.' : 'Learner access is limited to the learner’s own records.'}</div>`, `${button('Cancel', 'close-modal', 'light')}${button('Save User', 'save-user', 'primary', `data-id="${id}"`)}${u.id !== 'u1' ? button('Delete', 'delete-user', 'danger', `data-id="${id}"`) : ''}`) }
function showRecordAttendance() { modal('Record Attendance', `<div class="form-grid"><div class="field"><label>Learner<select id="m-att-learner">${state.users.filter(u => u.role === 'learner').map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label></div><div class="field"><label>Classroom<select id="m-att-class">${state.classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div><div class="field"><label>Date<input id="m-att-date" type="date" value="${todayISO}"></label></div><div class="field"><label>Status<select id="m-att-status"><option>Present</option><option>Absent</option></select></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Save Attendance', 'save-attendance', 'primary')}`) }
function showMarkSubmission(id) { const s = state.submissions.find(x => x.id === id); if (!s) return; modal('Mark Submission', `<div class="notice"><strong>${esc(user(s.learnerId)?.name || 'Learner')}</strong> · ${esc(activityById(s.activityId)?.title || 'Activity')}<br>File: ${esc(s.filename)}</div><div class="form-grid" style="margin-top:15px"><div class="field"><label>Mark (%)<input id="m-mark" type="number" min="0" max="100" value="${s.mark ?? ''}"></label></div><div class="field span-2"><label>Feedback<textarea id="m-feedback">${esc(s.feedback || '')}</textarea></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Save Mark', 'save-mark', 'primary', `data-id="${id}"`)}`) }
function showUploadMaterial() { modal('Upload Learning Material', `<div class="form-grid"><div class="field span-2"><label>File<input id="m-material-file" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xlsx,.jpg,.jpeg,.png"></label></div><div class="field"><label>Classroom<select id="m-material-class">${state.classes.filter(c => state.currentRole === 'admin' || c.tutorId === currentUser().id).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div><div class="field"><label>Resource type<select id="m-material-type"><option>PDF</option><option>Document</option><option>Presentation</option><option>Image</option></select></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Upload', 'save-material', 'primary')}`) }

function downloadText(filename, text, type = 'text/plain') { const blob = new Blob([text], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 500) }
function exportCSV() { const rows = [['Learner', 'Classroom', 'Date', 'Status', 'Tutor'], ...state.attendance.map(a => [user(a.learnerId)?.name, className(a.classId), a.date, a.status, tutorName(cls(a.classId))])]; downloadText('gm-tutoring-attendance.csv', rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n'), 'text/csv'); toast('CSV report downloaded.') }
function exportReport() { const payload = { generatedAt: new Date().toISOString(), learners: state.users.filter(u => u.role === 'learner').length, tutors: state.users.filter(u => u.role === 'tutor').length, classes: state.classes.length, attendance: state.attendance, activities: state.activities }; downloadText('gm-tutoring-report.json', JSON.stringify(payload, null, 2), 'application/json'); toast('Report downloaded.') }

// Global click delegation. Every interactive control is handled here.
document.addEventListener('click', e => {
  const backdrop = e.target.closest('.modal-backdrop'); if (backdrop && e.target === backdrop) { closeModal(); return }
  const reaction = e.target.closest('[data-reaction]'); if (reaction) { sendReaction(reaction.dataset.reaction); return }
  const routeBtn = e.target.closest('[data-route]'); if (routeBtn) { e.preventDefault(); route = routeBtn.dataset.route; closeModal(); qs('.sidebar')?.classList.remove('open'); render(); return }
  const settingTab = e.target.closest('[data-setting-tab]'); if (settingTab) { state.activeSettingTab = settingTab.dataset.settingTab; saveState(); render(); return }
  const live = e.target.closest('[data-live]'); if (live) { handleLiveControl(live.dataset.live); return }
  const action = e.target.closest('[data-action]'); if (!action) return; const a = action.dataset.action;
  if (a === 'logout') { stopLiveTimer(); offlineLogout(); api('/auth/logout', { method: 'POST' }).catch(() => { }).finally(() => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(DATA_KEY); qs('#app').classList.add('hidden'); qs('#login-screen').classList.remove('hidden'); closeModal(); toast('You have been signed out.'); }); return }
  if (a === 'toggle-sidebar') { qs('.sidebar').classList.toggle('open'); return }
  if (a === 'toggle-password') { const p = qs('#login-password'); p.type = p.type === 'password' ? 'text' : 'password'; return }
  if (a === 'signup') { showSignup(); return }
  if (a === 'forgot') { e.preventDefault(); modal('Reset Password', `<p class="muted">Enter your email. In this local build the server records the request; no external email service is used yet.</p><div class="field"><label>Email<input id="reset-email" type="email" value="${esc(qs('#login-email')?.value || '')}"></label></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Send Reset Link', 'send-reset', 'primary')}`); return }
  if (a === 'notifications') { showNotifications(); return }
  if (a === 'close-modal') { closeModal(); return }
  if (a === 'close-live') { handleLiveControl('close-live'); return }
  if (a === 'create-account') { const name = qs('#signup-name')?.value.trim(), email = qs('#signup-email')?.value.trim(), password = qs('#signup-password')?.value, confirm = qs('#signup-confirm')?.value, phone = qs('#signup-phone')?.value.trim(); const role = qs('#signup-role')?.value || 'learner'; if (!name || !email || !password) { toast('Complete the required fields.', 'error'); return } if (password !== confirm) { toast('Passwords do not match.', 'error'); return } if (password.length < 8) { toast('Password must be at least 8 characters.', 'error'); return } const doRegister = () => { if (isStaticHost || offlineMode) { try { const result = offlineRegister(name, email, password, role, phone); enterApp(result.user, 'Account created successfully.'); } catch (err) { toast(err.message, 'error'); } return; } api('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, phone, role }) }).then(result => { localStorage.setItem(TOKEN_KEY, result.token); enterApp(result.user, 'Account created successfully.'); backendOnline = true; offlineMode = false; updateBackendBadge(); }).catch(err => { if (err instanceof NetworkError) { try { const result = offlineRegister(name, email, password, role, phone); enterApp(result.user, 'Account created successfully.'); } catch (e2) { toast(e2.message, 'error'); } } else toast(err.message, 'error'); }); }; doRegister(); return }
  if (a === 'new-class') { if (guard('create')) showNewClass(); return }
  if (a === 'new-user') { if (guard('create')) showNewUser(); return }
  if (a === 'new-activity') { if (guard('create')) showNewActivity(); return }
  if (a === 'new-announcement') { if (guard('announce')) showAnnouncement(); return }
  if (a === 'schedule') { if (guard('schedule')) showSchedule(); return }
  if (a === 'join-live') { showLiveRoom(action.dataset.id || state.sessions[0]?.id); return }
  if (a === 'session-details') { showSessionDetails(action.dataset.id); return }
  if (a === 'class-details') { showClassDetails(action.dataset.id); return }
  if (a === 'class-menu') { showClassMenu(action.dataset.id); return }
  if (a === 'watch-recording') { showRecording(action.dataset.id); return }
  if (a === 'route-classes') { route = 'classes'; render(); return } if (a === 'route-reports') { route = 'reports'; render(); return } if (a === 'route-live') { route = 'live'; render(); return } if (a === 'route-attendance') { route = 'attendance'; render(); return } if (a === 'route-activities') { route = 'activities'; render(); return } if (a === 'route-recordings') { route = 'recordings'; render(); return }
  if (a === 'export') { if (!guard('export')) return; exportReport(); return } if (a === 'export-attendance') { exportCSV(); return }
  if (a === 'activity-details') { showActivity(action.dataset.id); return } if (a === 'submissions') { if (guard('grade')) showSubmissions(action.dataset.id); return } if (a === 'mark-submission') { if (guard('grade')) showMarkSubmission(action.dataset.id); return } if (a === 'submit-activity') { if (!guard('submit')) return; showSubmitActivity(action.dataset.id); return }
  if (a === 'mark-attendance') { if (!guard('attendance')) return; showRecordAttendance(); return } if (a === 'edit-attendance') { if (guard('attendance')) showEditAttendance(action.dataset.id); return }
  if (a === 'delete-announcement') { if (guard('delete')) { state.announcements = state.announcements.filter(x => x.id !== action.dataset.id); saveState(); render(); toast('Announcement deleted.') } return }
  if (a === 'toggle-setting') { const key = action.dataset.key; if (key) { state.settings[key] = !state.settings[key]; saveState(); action.classList.toggle('on', state.settings[key]); action.setAttribute('aria-pressed', state.settings[key]); toast(`${key} ${state.settings[key] ? 'enabled' : 'disabled'}.`) } return }
  if (a === 'save-settings') { saveState(); toast('Settings saved successfully.'); return }
  if (a === 'save-profile') { const u = currentUser(); u.name = qs('#profile-name').value.trim() || u.name; u.email = qs('#profile-email').value.trim() || u.email; u.phone = qs('#profile-phone').value.trim(); saveState(); render(); toast('Profile updated successfully.'); return }
  if (a === 'edit-user') { showEditUser(action.dataset.id); return } if (a === 'toggle-user') { if (!guard('edit')) return; const u = user(action.dataset.id); u.status = u.status === 'Active' ? 'Suspended' : 'Active'; saveState(); render(); toast(`${u.name} is now ${u.status}.`); return }
  if (a === 'save-user') { if (!guard('edit')) return; const u = user(action.dataset.id); u.name = qs('#edit-user-name').value.trim() || u.name; u.email = qs('#edit-user-email').value.trim() || u.email; u.phone = qs('#edit-user-phone').value.trim(); u.status = qs('#edit-user-status').value; saveState(); closeModal(); render(); toast('User updated successfully.'); return }
  if (a === 'delete-user') { if (!guard('delete')) return; const id = action.dataset.id; if (id === 'u1') return; state.users = state.users.filter(u => u.id !== id); state.classes.forEach(c => c.learners = c.learners.filter(x => x !== id)); saveState(); closeModal(); render(); toast('User removed and classroom records preserved.'); return }
  if (a === 'replace-tutor') { if (!guard('edit')) return; const c = cls(action.dataset.id); modal('Replace Tutor', `<div class="notice"><strong>Safe tutor replacement.</strong>The classroom and all learner records stay with GM Tutoring.</div><div class="field" style="margin-top:15px"><label>New tutor<select id="replacement">${state.users.filter(u => u.role === 'tutor' && u.status === 'Active').map(u => `<option value="${u.id}" ${u.id === c.tutorId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Replace Tutor', 'confirm-replace', 'primary', `data-id="${c.id}"`)}`); return }
  if (a === 'confirm-replace') { const c = cls(action.dataset.id); c.tutorId = qs('#replacement').value; saveState(); closeModal(); render(); toast('Tutor replaced. Classroom history and learner records were preserved.'); return }
  if (a === 'manage-class-learners') { showManageLearners(action.dataset.id); return }
  if (a === 'create-class') { if (!guard('create')) return; const name = qs('#m-class-name').value.trim(); if (!name) { toast('Please enter a classroom name.', 'error'); return } const tutorId = qs('#m-class-tutor').value || null; state.classes.push({ id: uid('c'), name, subject: qs('#m-class-sub').value, grade: qs('#m-class-grade').value, tutorId, learners: [], progress: 0, next: 'Not scheduled', status: 'Active' }); saveState(); closeModal(); render(); toast('Classroom created successfully.'); return }
  if (a === 'create-user') { if (!guard('create')) return; const name = qs('#m-user-name').value.trim(), email = qs('#m-user-email').value.trim(); if (!name || !email) { toast('Complete the required fields.', 'error'); return } if (state.users.some(u => u.email.toLowerCase() === email.toLowerCase())) { toast('A user with that email already exists.', 'error'); return } state.users.push({ id: uid('u'), name, email, role: qs('#m-user-role').value, status: 'Active', phone: qs('#m-user-phone').value.trim() }); saveState(); closeModal(); render(); toast('User created and access assigned.'); return }
  if (a === 'create-activity') { if (!guard('create')) return; const title = qs('#m-act-title').value.trim(); if (!title) { toast('Enter an activity title.', 'error'); return } const classId = qs('#m-act-class').value; state.activities.unshift({ id: uid('a'), title, classId, due: qs('#m-act-due').value || todayISO, submissions: 0, total: cls(classId)?.learners.length || 0, status: 'Open', instructions: qs('#m-act-instructions').value.trim() }); saveState(); closeModal(); render(); toast('Activity published successfully.'); return }
  if (a === 'create-announcement') { if (!guard('announce')) return; const text = qs('#m-ann-text').value.trim(); if (!text) { toast('Write an announcement first.', 'error'); return } state.announcements.unshift({ id: uid('n'), title: text, audience: qs('#m-ann-audience').value, time: 'Just now' }); state.notifications.unshift({ id: uid('x'), title: 'New announcement', body: text, time: 'Just now', read: false }); saveState(); closeModal(); render(); toast('Announcement posted successfully.'); return }
  if (a === 'save-schedule') { if (!guard('schedule')) return; const start = qs('#m-s-start').value, end = qs('#m-s-end').value; if (start >= end) { toast('End time must be after start time.', 'error'); return } state.sessions.push({ id: uid('s'), classId: qs('#m-s-class').value, title: qs('#m-s-title').value.trim() || 'Live tutoring lesson', date: qs('#m-s-date').value, start, end, tutorId: qs('#m-s-tutor').value, status: 'Scheduled', recording: qs('#m-s-record').value === 'true' }); saveState(); closeModal(); render(); toast('Live lesson scheduled successfully.'); return }
  if (a === 'send-reset') { const email = qs('#reset-email')?.value.trim(); if (!email) { toast('Enter your email address.', 'error'); return } api('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }).then(() => { closeModal(); toast('Password reset request accepted. In this development build no external email is sent.'); }).catch(err => toast(err.message, 'error')); return }
  if (a === 'send-chat') { const input = qs('#chat-input'); if (!input?.value.trim()) return; const box = qs('#chat-messages'); box.insertAdjacentHTML('beforeend', `<div class="chat-msg"><b>${esc(currentUser().name)}</b><span>${esc(input.value.trim())}</span></div>`); input.value = ''; box.scrollTop = box.scrollHeight; return }
  if (a === 'clear-whiteboard') { return }
  if (a === 'save-attendance') { const learnerId = qs('#m-att-learner').value, classId = qs('#m-att-class').value; state.attendance.unshift({ id: uid('att'), learnerId, classId, date: qs('#m-att-date').value, status: qs('#m-att-status').value, tutorId: cls(classId)?.tutorId }); saveState(); closeModal(); render(); toast('Attendance saved.'); return }
  if (a === 'save-mark') { const s = state.submissions.find(x => x.id === action.dataset.id); const mark = Number(qs('#m-mark').value); if (!Number.isFinite(mark) || mark < 0 || mark > 100) { toast('Enter a mark between 0 and 100.', 'error'); return } s.mark = mark; s.feedback = qs('#m-feedback').value.trim(); const aobj = activityById(s.activityId); if (aobj && !state.submissions.some(x => x.activityId === s.activityId && x.mark == null)) aobj.status = 'Marked'; saveState(); closeModal(); showSubmissions(s.activityId); toast('Mark and feedback saved.'); return }
  if (a === 'upload-material') { if (guard('material')) showUploadMaterial(); return }
  if (a === 'save-material') { if (!guard('material')) return; const file = qs('#m-material-file').files[0]; if (!file) { toast('Choose a file first.', 'error'); return } const fd = new FormData(); fd.append('file', file); fd.append('classId', qs('#m-material-class').value); fd.append('type', qs('#m-material-type').value); api('/materials/upload', { method: 'POST', body: fd }).then(m => { state.materials.unshift(m); saveState(); closeModal(); render(); toast('Material uploaded successfully to the backend.'); }).catch(err => toast(err.message, 'error')); return }
  if (a === 'open-material') { const m = state.materials.find(x => x.id === action.dataset.id); modal('Learning Material', `<div class="material-preview"><div class="material-icon large">${esc(m.type)}</div><h3>${esc(m.name)}</h3><p class="muted">${esc(className(m.classId))} · ${m.size} · ${formatDate(m.date)}</p><div class="notice"><strong>Preview.</strong>Use the download button to open the secure stored file for this classroom resource.</div></div>`, button('Close', 'close-modal', 'light')); return }
  if (a === 'download-material') { const m = state.materials.find(x => x.id === action.dataset.id); if (!m) return; fetch(API_BASE + `/materials/${m.id}/download`, { headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` } }).then(async response => { if (!response.ok) { let msg = 'Download failed.'; try { msg = (await response.json()).error || msg } catch { } throw new Error(msg) } return response.blob() }).then(blob => { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = m.name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 500); toast('Material download started.') }).catch(err => toast(err.message, 'error')); return }
  if (a === 'record-payment') { if (guard('payments')) showRecordPayment(); return } if (a === 'payment-details') { showPayment(action.dataset.id); return }
  if (a === 'add-referral') { if (guard('referrals')) showAddReferral(); return } if (a === 'referral-details') { showReferral(action.dataset.id); return }
  if (a === 'add-parent') { showParentForm(); return } if (a === 'parent-details') { const p = (state.parents || [])[Number(action.dataset.index)]; modal('Parent Portal', `<div class="status-grid"><div><small>Parent</small><strong>${esc(p?.name || 'Parent')}</strong></div><div><small>Learner</small><strong>${esc(user(p?.learnerId)?.name || '—')}</strong></div><div><small>Email</small><strong>${esc(p?.email || '—')}</strong></div><div><small>Status</small><strong>${esc(p?.status || 'Active')}</strong></div></div>`, button('Close', 'close-modal', 'light')); return } if (a === 'send-parent-invite') { const p = (state.parents || [])[Number(action.dataset.index)]; if (p) { p.status = 'Invite sent'; saveState(); render(); toast(`Invitation sent to ${p.email}.`); } return }
});

function showNotifications() { state.notifications.forEach(n => n.read = true); saveState(); modal('Notifications', state.notifications.map(n => `<div class="activity"><div class="mini-icon">${n.read ? '✓' : '!'}</div><div><strong>${esc(n.title)}</strong><small>${esc(n.body)} · ${esc(n.time)}</small></div></div>`).join('') || '<div class="empty">No notifications.</div>', button('Close', 'close-modal', 'light')); renderNav() }
function showSessionDetails(id) { const s = state.sessions.find(x => x.id === id); if (!s) return; modal('Session Details', `<div class="status-grid"><div><small>Classroom</small><strong>${esc(className(s.classId))}</strong></div><div><small>Lesson</small><strong>${esc(s.title)}</strong></div><div><small>Date</small><strong>${formatDate(s.date)}</strong></div><div><small>Time</small><strong>${s.start}–${s.end}</strong></div></div><div class="notice" style="margin-top:15px"><strong>Recording: ${s.recording ? 'Enabled' : 'Disabled'}</strong>Participants receive access through their classroom.</div>`, `${button('Close', 'close-modal', 'light')}${button('Launch Live Room', 'join-live', 'primary', `data-id="${s.id}"`)}`) }
function showRecording(id) { const r = state.recordings.find(x => x.id === id); modal('Recording Player', `<div class="recording-player"><div class="recording-thumb huge" id="recording-placeholder">▶</div><video id="recording-video" controls playsinline style="display:none;width:100%;height:260px;background:#111;border-radius:13px"></video><h3>${esc(r?.title || 'Lesson recording')}</h3><p class="muted">${esc(className(r?.classId))} · ${formatDate(r?.date)} · ${r?.duration || '—'}</p><div class="progress-track"><div class="progress-fill" style="width:38%"></div></div><div class="player-controls"><button class="icon-btn" data-action="play-recording" data-id="${esc(id)}">▶</button><span id="recording-time">Ready · ${esc(r?.duration || '—')}</span><button class="icon-btn" data-action="volume-recording" data-id="${esc(id)}">🔊</button></div><div class="notice" style="margin-top:12px">${r?.storedName ? 'This recording is stored by the GM Tutoring backend. Play it below or use the browser video controls.' : 'This recording is saved in the platform when it is created from a live classroom session.'}</div></div>`, button('Close', 'close-modal', 'light')); }
function showClassMenu(id) { modal('Classroom Actions', `<div class="action-list">${button('Replace Tutor', 'replace-tutor', 'light', `data-id="${id}"`)}${button('Manage Learners', 'manage-class-learners', 'light', `data-id="${id}"`)}${button('Archive Classroom', 'archive-class', 'danger', `data-id="${id}"`)}</div>`, button('Cancel', 'close-modal', 'light')) }
function showManageLearners(id) { const c = cls(id); if (!c) return; modal('Manage Learners', `<div class="field"><label>Search learners<input id="learner-picker-search" placeholder="Search by name"></label></div><div id="learner-picker" class="picker-list" style="margin-top:12px">${state.users.filter(u => u.role === 'learner').map(u => `<label class="picker-row" data-name="${esc(u.name.toLowerCase())}"><input type="checkbox" value="${u.id}" ${c.learners.includes(u.id) ? 'checked' : ''}><span>${esc(u.name)}</span><small>${esc(u.email)}</small></label>`).join('')}</div>`, `${button('Cancel', 'close-modal', 'light')}${button('Save Learners', 'save-class-learners', 'primary', `data-id="${id}"`)}`); qs('#learner-picker-search')?.addEventListener('input', e => qsa('.picker-row').forEach(r => r.style.display = r.dataset.name.includes(e.target.value.toLowerCase()) ? 'grid' : 'none')) }
function showSubmitActivity(id) { const a = activityById(id); modal('Submit Activity', `<div class="notice"><strong>${esc(a.title)}</strong> · Due ${formatDate(a.due)}</div><div class="field" style="margin-top:15px"><label>Upload answer<input id="submission-file" type="file" accept=".pdf,.doc,.docx,.jpg,.png"></label></div><div class="field" style="margin-top:15px"><label>Optional note<textarea id="submission-note" placeholder="Add a note for your tutor..."></textarea></label></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Submit Work', 'save-submission', 'primary', `data-id="${id}"`)}`) }
function showEditAttendance(id) { const a = state.attendance.find(x => x.id === id); modal('Edit Attendance', `<div class="form-grid"><div class="field"><label>Learner<input value="${esc(user(a.learnerId)?.name)}" disabled></label></div><div class="field"><label>Classroom<input value="${esc(className(a.classId))}" disabled></label></div><div class="field"><label>Date<input id="edit-att-date" type="date" value="${a.date}"></label></div><div class="field"><label>Status<select id="edit-att-status"><option ${a.status === 'Present' ? 'selected' : ''}>Present</option><option ${a.status === 'Absent' ? 'selected' : ''}>Absent</option></select></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Save', 'save-edit-attendance', 'primary', `data-id="${id}"`)}`) }
function showRecordPayment() { modal('Record Payment', `<div class="form-grid"><div class="field"><label>Learner<select id="m-pay-learner">${state.users.filter(u => u.role === 'learner').map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label></div><div class="field"><label>Amount<input id="m-pay-amount" type="number" value="950"></label></div><div class="field"><label>Method<select id="m-pay-method"><option>EFT</option><option>Card</option><option>Cash</option></select></label></div><div class="field"><label>Status<select id="m-pay-status"><option>Paid</option><option>Outstanding</option></select></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Save Payment', 'save-payment', 'primary')}`) }
function showPayment(id) { const p = state.payments.find(x => x.id === id); modal('Payment Details', `<div class="status-grid"><div><small>Learner</small><strong>${esc(user(p.learnerId)?.name)}</strong></div><div><small>Amount</small><strong>${currency(p.amount)}</strong></div><div><small>Status</small><strong>${p.status}</strong></div><div><small>Method</small><strong>${p.method}</strong></div></div>`, button('Close', 'close-modal', 'light')) }
function showAddReferral() { modal('Add Marketing Agent', `<div class="form-grid"><div class="field"><label>Name<input id="m-ref-name" placeholder="Agent name"></label></div><div class="field"><label>Referral code<input id="m-ref-code" placeholder="AGENT10"></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Add Agent', 'save-referral', 'primary')}`) }
function showReferral(id) { const r = state.referrals.find(x => x.id === id); modal('Referral Details', `<div class="status-grid"><div><small>Agent</small><strong>${esc(r.name)}</strong></div><div><small>Code</small><strong>${esc(r.code)}</strong></div><div><small>Learners recruited</small><strong>${r.learners}</strong></div><div><small>Commission</small><strong>${currency(r.commission)}</strong></div></div><div class="notice" style="margin-top:15px"><strong>Bonus progress</strong>${r.bonusRemaining} learners remaining for the next bonus milestone.</div>`, button('Close', 'close-modal', 'light')) }
function showParentForm() { modal('Add Parent Account', `<div class="form-grid"><div class="field"><label>Parent name<input id="m-parent-name"></label></div><div class="field"><label>Email<input id="m-parent-email" type="email"></label></div><div class="field span-2"><label>Link learner<select id="m-parent-learner">${state.users.filter(u => u.role === 'learner').map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label></div></div>`, `${button('Cancel', 'close-modal', 'light')}${button('Create & Send Invite', 'save-parent', 'primary')}`) }
function formatBytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; return (n / 1048576).toFixed(1) + ' MB' }

// Modal action extensions.
document.addEventListener('click', e => {
  const action = e.target.closest('[data-action]'); if (!action) return; const a = action.dataset.action;
  if (a === 'save-submission') { const file = qs('#submission-file').files[0]; if (!file) { toast('Choose your answer file first.', 'error'); return } const fd = new FormData(); fd.append('file', file); fd.append('note', qs('#submission-note')?.value || ''); api(`/activities/${action.dataset.id}/submissions`, { method: 'POST', body: fd }).then(s => { const act = activityById(action.dataset.id); const existing = state.submissions.find(x => x.id === s.id); if (existing) Object.assign(existing, s); else { state.submissions.push(s); if (act) act.submissions = Math.min(act.total, act.submissions + 1); } saveState(); closeModal(); render(); toast('Assignment submitted successfully.'); }).catch(err => toast(err.message, 'error')); return }
  if (a === 'save-edit-attendance') { const x = state.attendance.find(y => y.id === action.dataset.id); x.date = qs('#edit-att-date').value; x.status = qs('#edit-att-status').value; saveState(); closeModal(); render(); toast('Attendance updated.'); return }
  if (a === 'save-payment') { state.payments.unshift({ id: uid('p'), learnerId: qs('#m-pay-learner').value, amount: Number(qs('#m-pay-amount').value) || 0, status: qs('#m-pay-status').value, date: todayISO, method: qs('#m-pay-method').value }); saveState(); closeModal(); render(); toast('Payment recorded.'); return }
  if (a === 'save-referral') { const name = qs('#m-ref-name').value.trim(), code = qs('#m-ref-code').value.trim(); if (!name || !code) { toast('Complete agent name and referral code.', 'error'); return } state.referrals.push({ id: uid('ref'), name, code, learners: 0, commission: 0, bonusRemaining: 10 }); saveState(); closeModal(); render(); toast('Marketing agent added.'); return }
  if (a === 'save-parent') { const name = qs('#m-parent-name').value.trim(), email = qs('#m-parent-email').value.trim(), learnerId = qs('#m-parent-learner')?.value; if (!name || !email) { toast('Complete parent details.', 'error'); return } api('/parents', { method: 'POST', body: JSON.stringify({ name, email, learnerId }) }).then(p => { state.parents = state.parents || []; state.parents.push(p); saveState(); closeModal(); render(); toast('Parent account created and invite queued.'); }).catch(err => toast(err.message, 'error')); return }
  if (a === 'play-recording') { const id = action.dataset.id; const v = qs('#recording-video'); if (!v) { toast('Recording player is unavailable.', 'error'); return } if (!v.src) { fetch(API_BASE + `/recordings/${id}/download`, { headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` } }).then(async response => { if (!response.ok) throw new Error('This seeded recording has no stored video file yet.'); const blob = await response.blob(); v.src = URL.createObjectURL(blob); v.style.display = 'block'; qs('#recording-placeholder')?.remove(); return v.play(); }).then(() => toast('Recording playback started.')).catch(err => toast(err.message, 'error')); } else { v.paused ? v.play() : v.pause(); } return } if (a === 'volume-recording') { const v = qs('#recording-video'); if (v) { v.muted = !v.muted; toast(v.muted ? 'Recording muted' : 'Recording volume restored'); } else toast('Volume is available when a stored recording is loaded.'); return }
  if (a === 'archive-class') { if (!guard('edit')) return; const c = cls(action.dataset.id); c.status = c.status === 'Active' ? 'Archived' : 'Active'; saveState(); closeModal(); render(); toast(`Classroom ${c.status.toLowerCase()}.`); return }
  if (a === 'save-class-learners') { if (!guard('edit')) return; const c = cls(action.dataset.id); c.learners = qsa('#learner-picker input:checked').map(x => x.value); state.activities.forEach(x => { if (x.classId === c.id) x.total = c.learners.length }); saveState(); closeModal(); render(); toast('Classroom learners updated.'); return }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape' && qs('#modal-root').innerHTML) closeModal(); if (e.key === 'Enter' && e.target.id === 'chat-input') qs('[data-action="send-chat"]')?.click() });

qs('#login-form').addEventListener('submit', async e => { e.preventDefault(); const email = qs('#login-email').value.trim(); const password = qs('#login-password').value; const role = qs('#login-role')?.value || ''; try { if (isStaticHost || offlineMode) { const result = offlineLogin(email, password, role); enterApp(result.user, `Signed in as ${roleNames[result.user.role]}.`); return; } const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, role: role || undefined }) }); localStorage.setItem(TOKEN_KEY, result.token); enterApp(result.user, `Signed in as ${roleNames[result.user.role]}.`); backendOnline = true; offlineMode = false; updateBackendBadge(); } catch (err) { if (err instanceof NetworkError) { try { const result = offlineLogin(email, password, role); enterApp(result.user, `Signed in as ${roleNames[result.user.role]}.`); } catch { toast(err.message, 'error'); } } else { toast(err.message, 'error'); } } });


restoreBackendSession();
