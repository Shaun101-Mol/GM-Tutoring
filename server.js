'use strict';

// GM Tutoring backend - dependency-free Node.js implementation.
// Uses JSON persistence temporarily. PostgreSQL will replace this store in the next phase.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 4000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const MAX_BODY = 25 * 1024 * 1024;
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const todayISO = new Date().toISOString().slice(0, 10);
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function makePassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(password, encoded) {
  if (!encoded || !encoded.includes(':')) return false;
  const [salt, expected] = encoded.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function seedUser(id, name, email, role, status, phone) { return { id, name, email, role, status, phone, passwordHash: makePassword('Welcome123!') }; }

const seed = {
  users: [
    seedUser('u1', 'GM Owner', 'owner@gmtutoring.co.za', 'admin', 'Active', '+27 71 000 0000'),
    seedUser('u2', 'Thandi Mokoena', 'thandi@gmtutoring.co.za', 'tutor', 'Active', '+27 72 111 1111'),
    seedUser('u3', 'Daniel Naidoo', 'daniel@gmtutoring.co.za', 'tutor', 'Active', '+27 73 222 2222'),
    seedUser('u4', 'Lerato Molefe', 'lerato@student.co.za', 'learner', 'Active', '+27 74 333 3333'),
    seedUser('u5', 'Sipho Dlamini', 'sipho@student.co.za', 'learner', 'Active', '+27 75 444 4444'),
    seedUser('u6', 'Aisha Khan', 'aisha@student.co.za', 'learner', 'Active', '+27 76 555 5555'),
    seedUser('u7', 'Neo Ramokgopa', 'neo@student.co.za', 'learner', 'Active', '+27 77 666 6666')
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
    { id: 'sub1', activityId: 'a1', learnerId: 'u4', filename: 'lerato_double_angle.pdf', mark: 82, feedback: 'Good working. Check question 9.', storedName: null },
    { id: 'sub2', activityId: 'a1', learnerId: 'u5', filename: 'sipho_double_angle.pdf', mark: null, feedback: '', storedName: null }
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
    { id: 'm1', classId: 'c1', name: 'Trigonometric Identities Revision Pack.pdf', type: 'PDF', size: '2.4 MB', date: '2026-08-08', storedName: null },
    { id: 'm2', classId: 'c1', name: 'Formula Sheet.pdf', type: 'PDF', size: '680 KB', date: '2026-08-07', storedName: null },
    { id: 'm3', classId: 'c2', name: "Newton's Laws Notes.pdf", type: 'PDF', size: '1.1 MB', date: '2026-08-06', storedName: null }
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

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) { fs.writeFileSync(STORE_FILE, JSON.stringify(seed, null, 2)); return clone(seed); }
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { fs.writeFileSync(STORE_FILE, JSON.stringify(seed, null, 2)); return clone(seed); }
}
let store = loadStore();
function saveStore() { fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2)); }
function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`; }
function publicUser(u) { if (!u) return null; const x = { ...u }; delete x.passwordHash; return x; }
function publicState() { const x = clone(store); x.users = x.users.map(publicUser); return x; }
function findUser(id) { return store.users.find(u => u.id === id); }
function findClass(id) { return store.classes.find(c => c.id === id); }
function isAdmin(user) { return user?.role === 'admin'; }
function classAccess(user, classId) { if (!user) return false; if (isAdmin(user)) return true; const c = findClass(classId); if (!c) return false; if (user.role === 'tutor') return c.tutorId === user.id; if (user.role === 'learner') return c.learners.includes(user.id); return false; }
function protectedKeys() { return ['classes', 'sessions', 'activities', 'attendance', 'materials', 'announcements', 'payments', 'referrals', 'parents', 'settings']; }
function jsonEqual(a, b) { return JSON.stringify(a ?? []) === JSON.stringify(b ?? []); }

function send(res, status, payload, headers = {}) { const body = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)); res.writeHead(status, { 'Content-Type': typeof payload === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Cache-Control': 'no-store', ...headers }); res.end(body); }
function error(res, status, message) { send(res, status, { error: message }); }
function auth(req) { const h = req.headers.authorization || ''; if (!h.startsWith('Bearer ')) return null; const userId = sessions.get(h.slice(7)); return userId ? findUser(userId) : null; }
function requireAuth(req, res) { const u = auth(req); if (!u) { error(res, 401, 'Authentication required or session expired.'); return null; } return u; }
function requireRole(user, res, roles) { if (!roles.includes(user.role)) { error(res, 403, 'Your role is not permitted to perform this action.'); return false; } return true; }
function readBody(req) { return new Promise((resolve, reject) => { let chunks = []; let size = 0; req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('Request body too large.')); req.destroy(); return; } chunks.push(c); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); }); }
async function readJson(req) { const b = await readBody(req); if (!b.length) return {}; try { return JSON.parse(b.toString('utf8')); } catch { throw new Error('Invalid JSON body.'); } }
function safeFileName(name) { return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_'); }
function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new Error('Multipart boundary missing.');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = []; let start = 0;
  while (true) { const idx = buffer.indexOf(boundary, start); if (idx < 0) break; const next = buffer.indexOf(boundary, idx + boundary.length); if (next < 0) break; let part = buffer.slice(idx + boundary.length, next); start = next; if (part.slice(0, 2).toString() === '--') break; if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2); if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2); const sep = Buffer.from('\r\n\r\n'); const hs = part.indexOf(sep); if (hs < 0) continue; const headerText = part.slice(0, hs).toString('utf8'); const data = part.slice(hs + 4); const headers = {}; for (const line of headerText.split('\r\n')) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); } const disp = headers['content-disposition'] || ''; const nm = /name="([^"]+)"/.exec(disp); if (!nm) continue; const fn = /filename="([^"]*)"/.exec(disp); parts.push({ name: nm[1], filename: fn ? fn[1] : null, data }); }
  const fields = {}; let file = null; for (const p of parts) { if (p.filename !== null) file = p; else fields[p.name] = p.data.toString('utf8'); } return { fields, file };
}
function formatSize(n) { if (n < 1024) return `${n} B`; if (n < 1048576) return `${Math.round(n / 1024)} KB`; return `${(n / 1048576).toFixed(1)} MB`; }
function staticFile(res, filePath) { if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false; const ext = path.extname(filePath).toLowerCase(); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' }; res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); fs.createReadStream(filePath).pipe(res); return true; }

async function handle(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' }); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const p = url.pathname; const method = req.method;
  try {
    if (p === '/api/health' && method === 'GET') return send(res, 200, { ok: true, service: 'GM Tutoring API', persistence: 'JSON temporary store', database: false, time: new Date().toISOString() });
    if (p === '/api/auth/login' && method === 'POST') {
      const body = await readJson(req); const found = store.users.find(u => u.email.toLowerCase() === String(body.email || '').toLowerCase());
      if (!found || found.status !== 'Active' || (body.role && found.role !== body.role) || !checkPassword(String(body.password || ''), found.passwordHash)) return error(res, 401, 'Invalid email, password, role, or inactive account.');
      const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, found.id); return send(res, 200, { token, user: publicUser(found), state: publicState() });
    }
    if (p === '/api/auth/forgot' && method === 'POST') {
      const body = await readJson(req); const email = String(body.email || '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return error(res, 400, 'Please enter a valid email address.');
      const exists = store.users.some(u => u.email.toLowerCase() === email);
      return send(res, 200, { ok: true, accepted: true, accountExists: exists });
    }
    if (p === '/api/auth/register' && method === 'POST') {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        console.error('[REGISTER] invalid JSON body', err.message);
        return error(res, 400, 'Invalid JSON body.');
      }
      try { console.log('[REGISTER] attempt', { time: new Date().toISOString(), ip: req.socket.remoteAddress, headers: { 'content-type': req.headers['content-type'] || '' }, body }); } catch (e) { }
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (name.length < 2) return error(res, 400, 'Please enter your full name.');
      if (!/^\S+@\S+\.\S+$/.test(email)) return error(res, 400, 'Please enter a valid email address.');
      if (password.length < 8) return error(res, 400, 'Password must be at least 8 characters.');
      if (store.users.some(u => u.email.toLowerCase() === email)) return error(res, 409, 'An account with that email already exists. Please sign in instead.');
      const u = { id: uid('u'), name, email, role: 'learner', status: 'Active', phone: String(body.phone || ''), passwordHash: makePassword(password) };
      store.users.push(u); saveStore();
      const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, u.id);
      return send(res, 201, { token, user: publicUser(u), state: publicState() });
    }
    // The web application itself is public; API resources below are authenticated.
    if (!p.startsWith('/api/')) {
      if (p.startsWith('/uploads/')) {
        const fileUser = requireAuth(req, res); if (!fileUser) return;
        const name = path.basename(p.slice('/uploads/'.length)); const file = path.join(UPLOAD_DIR, name);
        if (!name || !fs.existsSync(file)) return error(res, 404, 'File not found.');
        return staticFile(res, file);
      }
      let requested = decodeURIComponent(p); if (requested === '/' || requested === '') requested = '/index.html';
      const filePath = path.normalize(path.join(ROOT, requested));
      if (filePath.startsWith(ROOT) && staticFile(res, filePath)) return;
      return error(res, 404, 'Frontend resource not found.');
    }
    const user = requireAuth(req, res); if (!user) return;
    if (p === '/api/me' && method === 'GET') return send(res, 200, { user: publicUser(user) });
    if (p === '/api/auth/logout' && method === 'POST') { const token = (req.headers.authorization || '').slice(7); sessions.delete(token); return send(res, 200, { ok: true }); }
    if (p === '/api/state' && method === 'GET') return send(res, 200, publicState());
    if (p === '/api/state/sync' && method === 'PUT') {
      const incoming = await readJson(req); const next = clone(incoming); if (!Array.isArray(next.users) || !Array.isArray(next.classes)) return error(res, 400, 'Required state collections are missing.');
      const current = findUser(user.id); const submitted = next.users.find(u => u.id === user.id); if (!submitted) return error(res, 403, 'Authenticated user cannot be removed through sync.');
      next.users = next.users.map(u => ({ ...u, passwordHash: findUser(u.id)?.passwordHash || makePassword('Welcome123!') })); const own = next.users.find(u => u.id === user.id); own.role = current.role; own.status = current.status; own.passwordHash = current.passwordHash;
      if (user.role === 'tutor') {
        for (const key of ['classes', 'payments', 'referrals', 'parents', 'settings']) if (!jsonEqual(next[key], store[key])) return error(res, 403, 'Tutor accounts cannot modify protected platform or business records.');
        const allowed = new Set(store.classes.filter(c => c.tutorId === user.id).map(c => c.id));
        if (next.sessions.some(s => !allowed.has(s.classId) || s.tutorId !== user.id) || next.activities.some(a => !allowed.has(a.classId)) || next.attendance.some(a => !allowed.has(a.classId)) || next.materials.some(m => !allowed.has(m.classId)) || next.announcements.some(n => n.audience !== 'all' && !allowed.has(n.audience))) return error(res, 403, 'Tutor attempted to modify data outside assigned classrooms.');
        const oldUsers = store.users.map(publicUser); const changedForeign = next.users.some(u => u.id !== user.id && !jsonEqual(u, oldUsers.find(x => x.id === u.id))); if (changedForeign) return error(res, 403, 'Tutor accounts cannot modify users.');
      }
      if (user.role === 'learner') {
        for (const key of protectedKeys()) if (!jsonEqual(next[key], store[key])) return error(res, 403, 'Learners can only update their own profile, submissions and notification state.');
        if (next.submissions.some(s => s.learnerId !== user.id)) return error(res, 403, 'Learners cannot modify another learner’s submission.');
      }
      store = next; saveStore(); return send(res, 200, { ok: true, state: publicState() });
    }

    if (p === '/api/users' && method === 'GET') { let x = store.users; if (user.role === 'tutor') x = x.filter(u => u.role === 'learner' && store.classes.some(c => c.tutorId === user.id && c.learners.includes(u.id))); if (user.role === 'learner') x = x.filter(u => u.id === user.id); return send(res, 200, x.map(publicUser)); }
    if (p === '/api/users' && method === 'POST') { if (!requireRole(user, res, ['admin'])) return; const b = await readJson(req); if (!b.name || !b.email || !['tutor', 'learner'].includes(b.role)) return error(res, 400, 'Name, email and valid role are required.'); if (store.users.some(u => u.email.toLowerCase() === b.email.toLowerCase())) return error(res, 409, 'A user with that email already exists.'); const u = { id: uid('u'), name: b.name, email: b.email, role: b.role, status: 'Active', phone: b.phone || '', passwordHash: makePassword('Welcome123!') }; store.users.push(u); saveStore(); return send(res, 201, publicUser(u)); }
    let m = p.match(/^\/api\/users\/([^/]+)$/); if (m && method === 'PATCH') { const id = m[1]; if (!isAdmin(user) && id !== user.id) return error(res, 403, 'You can only edit your own profile.'); const u = findUser(id); if (!u) return error(res, 404, 'User not found.'); const b = await readJson(req); if (b.name) u.name = b.name; if (b.email) u.email = b.email; if (b.phone !== undefined) u.phone = b.phone; if (isAdmin(user) && b.status) u.status = b.status; saveStore(); return send(res, 200, publicUser(u)); }
    m = p.match(/^\/api\/users\/([^/]+)\/status$/); if (m && method === 'PATCH') { if (!requireRole(user, res, ['admin'])) return; const u = findUser(m[1]); if (!u) return error(res, 404, 'User not found.'); if (u.id === 'u1') return error(res, 400, 'The primary administrator cannot be suspended.'); u.status = u.status === 'Active' ? 'Suspended' : 'Active'; saveStore(); return send(res, 200, publicUser(u)); }
    m = p.match(/^\/api\/users\/([^/]+)$/); if (m && method === 'DELETE') { if (!requireRole(user, res, ['admin'])) return; if (m[1] === 'u1') return error(res, 400, 'The primary administrator cannot be deleted.'); store.users = store.users.filter(u => u.id !== m[1]); store.classes.forEach(c => c.learners = c.learners.filter(id => id !== m[1])); saveStore(); return send(res, 200, { ok: true }); }

    if (p === '/api/classes' && method === 'GET') { let x = store.classes; if (user.role === 'tutor') x = x.filter(c => c.tutorId === user.id); if (user.role === 'learner') x = x.filter(c => c.learners.includes(user.id)); return send(res, 200, x); }
    if (p === '/api/classes' && method === 'POST') { if (!requireRole(user, res, ['admin'])) return; const b = await readJson(req); if (!b.name || !b.subject || !b.grade) return error(res, 400, 'Classroom name, subject and grade are required.'); const c = { id: uid('c'), name: b.name, subject: b.subject, grade: b.grade, tutorId: b.tutorId || null, learners: [], progress: 0, next: 'Not scheduled', status: 'Active' }; store.classes.push(c); saveStore(); return send(res, 201, c); }
    m = p.match(/^\/api\/classes\/([^/]+)\/tutor$/); if (m && method === 'PATCH') { if (!requireRole(user, res, ['admin'])) return; const c = findClass(m[1]); const t = findUser((await readJson(req)).tutorId); if (!c || !t || t.role !== 'tutor') return error(res, 400, 'Valid classroom and tutor required.'); c.tutorId = t.id; saveStore(); return send(res, 200, c); }
    m = p.match(/^\/api\/classes\/([^/]+)\/learners$/); if (m && method === 'PATCH') { if (!requireRole(user, res, ['admin'])) return; const c = findClass(m[1]); const b = await readJson(req); if (!c || !Array.isArray(b.learners)) return error(res, 400, 'Valid classroom and learner list required.'); c.learners = [...new Set(b.learners.filter(id => findUser(id)?.role === 'learner'))]; store.activities.filter(a => a.classId === c.id).forEach(a => a.total = c.learners.length); saveStore(); return send(res, 200, c); }
    m = p.match(/^\/api\/classes\/([^/]+)\/archive$/); if (m && method === 'PATCH') { if (!requireRole(user, res, ['admin'])) return; const c = findClass(m[1]); if (!c) return error(res, 404, 'Classroom not found.'); c.status = c.status === 'Active' ? 'Archived' : 'Active'; saveStore(); return send(res, 200, c); }

    if (p === '/api/sessions' && method === 'GET') { let x = store.sessions; if (user.role === 'tutor') x = x.filter(s => s.tutorId === user.id); if (user.role === 'learner') x = x.filter(s => classAccess(user, s.classId)); return send(res, 200, x); }
    if (p === '/api/sessions' && method === 'POST') { if (!requireRole(user, res, ['admin', 'tutor'])) return; const b = await readJson(req); if (!b.classId || !classAccess(user, b.classId) || !b.title || !b.date || !b.start || !b.end || b.start >= b.end) return error(res, 400, 'Invalid lesson details or classroom access.'); const c = findClass(b.classId); const tutorId = user.role === 'admin' ? (b.tutorId || c.tutorId) : user.id; const s = { id: uid('s'), classId: b.classId, title: b.title, date: b.date, start: b.start, end: b.end, tutorId, status: 'Scheduled', recording: Boolean(b.recording) }; store.sessions.push(s); saveStore(); return send(res, 201, s); }
    m = p.match(/^\/api\/sessions\/([^/]+)\/end$/); if (m && method === 'PATCH') { const s = store.sessions.find(x => x.id === m[1]); if (!s) return error(res, 404, 'Session not found.'); if (!classAccess(user, s.classId)) return error(res, 403, 'No access to this classroom.'); s.status = 'Completed'; saveStore(); return send(res, 200, s); }
    m = p.match(/^\/api\/sessions\/([^/]+)\/start$/); if (m && method === 'PATCH') { const s = store.sessions.find(x => x.id === m[1]); if (!s) return error(res, 404, 'Session not found.'); if (!classAccess(user, s.classId)) return error(res, 403, 'No access to this classroom.'); s.status = 'Live'; s.startedAt = s.startedAt || new Date().toISOString(); saveStore(); return send(res, 200, s); }
    m = p.match(/^\/api\/sessions\/([^/]+)\/recording$/); if (m && method === 'POST') {
      const s = store.sessions.find(x => x.id === m[1]); if (!s) return error(res, 404, 'Session not found.'); if (!classAccess(user, s.classId)) return error(res, 403, 'No access to this classroom.');
      const body = await readBody(req); const parsed = parseMultipart(body, req.headers['content-type']); if (!parsed.file || !parsed.file.data.length) return error(res, 400, 'Recording file is required.');
      const storedName = `recording-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeFileName(parsed.file.filename || 'lesson.webm')}`; fs.writeFileSync(path.join(UPLOAD_DIR, storedName), parsed.file.data);
      const rec = { id: uid('r'), classId: s.classId, title: s.title, date: s.date, duration: String(parsed.fields.duration || 'Recorded live'), tutorId: s.tutorId, storedName, filename: parsed.file.filename || 'lesson.webm', size: formatSize(parsed.file.data.length) };
      store.recordings.unshift(rec); s.recording = true; s.recordingId = rec.id; saveStore(); return send(res, 201, rec);
    }

    if (p === '/api/activities' && method === 'GET') { let x = store.activities; if (user.role !== 'admin') x = x.filter(a => classAccess(user, a.classId)); return send(res, 200, x); }
    if (p === '/api/activities' && method === 'POST') { if (!requireRole(user, res, ['admin', 'tutor'])) return; const b = await readJson(req); if (!b.title || !b.classId || !classAccess(user, b.classId)) return error(res, 400, 'Valid title and classroom access are required.'); const a = { id: uid('a'), title: b.title, classId: b.classId, due: b.due || todayISO, submissions: 0, total: findClass(b.classId).learners.length, status: 'Open', instructions: b.instructions || '' }; store.activities.unshift(a); saveStore(); return send(res, 201, a); }
    m = p.match(/^\/api\/activities\/([^/]+)\/submissions$/); if (m && method === 'GET') { const a = store.activities.find(x => x.id === m[1]); if (!a) return error(res, 404, 'Activity not found.'); if (!classAccess(user, a.classId)) return error(res, 403, 'No classroom access.'); let x = store.submissions.filter(s => s.activityId === a.id); if (user.role === 'learner') x = x.filter(s => s.learnerId === user.id); return send(res, 200, x); }
    if (m && method === 'POST') {
      const a = store.activities.find(x => x.id === m[1]); if (!a) return error(res, 404, 'Activity not found.'); if (user.role !== 'learner' || !classAccess(user, a.classId)) return error(res, 403, 'Only an enrolled learner can submit.'); const body = await readBody(req); const parsed = parseMultipart(body, req.headers['content-type']); if (!parsed.file || !parsed.file.data.length) return error(res, 400, 'Answer file is required.'); const storedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeFileName(parsed.file.filename)}`; fs.writeFileSync(path.join(UPLOAD_DIR, storedName), parsed.file.data); let s = store.submissions.find(x => x.activityId === a.id && x.learnerId === user.id); if (!s) { s = { id: uid('sub'), activityId: a.id, learnerId: user.id, filename: parsed.file.filename, storedName, mark: null, feedback: parsed.fields.note || '' }; store.submissions.push(s); a.submissions = Math.min(a.total, a.submissions + 1); } else { s.filename = parsed.file.filename; s.storedName = storedName; s.feedback = parsed.fields.note || s.feedback || ''; } saveStore(); return send(res, 201, s);
    }
    m = p.match(/^\/api\/submissions\/([^/]+)\/mark$/); if (m && method === 'PATCH') { if (!requireRole(user, res, ['admin', 'tutor'])) return; const s = store.submissions.find(x => x.id === m[1]); if (!s) return error(res, 404, 'Submission not found.'); const a = store.activities.find(x => x.id === s.activityId); if (!a || !classAccess(user, a.classId)) return error(res, 403, 'No access to this submission.'); const b = await readJson(req); const mark = Number(b.mark); if (!Number.isFinite(mark) || mark < 0 || mark > 100) return error(res, 400, 'Mark must be between 0 and 100.'); s.mark = mark; s.feedback = String(b.feedback || ''); if (!store.submissions.some(x => x.activityId === a.id && x.mark == null)) a.status = 'Marked'; saveStore(); return send(res, 200, s); }

    if (p === '/api/attendance' && method === 'GET') { let x = store.attendance; if (user.role === 'tutor') x = x.filter(a => a.tutorId === user.id); if (user.role === 'learner') x = x.filter(a => a.learnerId === user.id); return send(res, 200, x); }
    if (p === '/api/attendance' && method === 'POST') { if (!requireRole(user, res, ['admin', 'tutor'])) return; const b = await readJson(req); const c = findClass(b.classId); if (!c || !classAccess(user, c.id) || !c.learners.includes(b.learnerId)) return error(res, 400, 'Invalid classroom access or learner enrollment.'); const a = { id: uid('att'), learnerId: b.learnerId, classId: b.classId, date: b.date, status: b.status, tutorId: c.tutorId }; store.attendance.unshift(a); saveStore(); return send(res, 201, a); }
    m = p.match(/^\/api\/attendance\/([^/]+)$/); if (m && method === 'PATCH') { if (!requireRole(user, res, ['admin', 'tutor'])) return; const a = store.attendance.find(x => x.id === m[1]); if (!a) return error(res, 404, 'Attendance record not found.'); if (!classAccess(user, a.classId)) return error(res, 403, 'No access to this classroom.'); const b = await readJson(req); if (b.date) a.date = b.date; if (b.status) a.status = b.status; saveStore(); return send(res, 200, a); }

    if (p === '/api/announcements' && method === 'POST') { if (!requireRole(user, res, ['admin', 'tutor'])) return; const b = await readJson(req); if (!b.title) return error(res, 400, 'Announcement message is required.'); if (b.audience && b.audience !== 'all' && !classAccess(user, b.audience)) return error(res, 403, 'No access to selected classroom.'); const n = { id: uid('n'), title: b.title, audience: b.audience || 'all', time: 'Just now' }; store.announcements.unshift(n); store.notifications.unshift({ id: uid('x'), title: 'New announcement', body: n.title, time: 'Just now', read: false }); saveStore(); return send(res, 201, n); }
    m = p.match(/^\/api\/announcements\/([^/]+)$/); if (m && method === 'DELETE') { if (!requireRole(user, res, ['admin'])) return; store.announcements = store.announcements.filter(x => x.id !== m[1]); saveStore(); return send(res, 200, { ok: true }); }

    if (p === '/api/materials/upload' && method === 'POST') { if (!requireRole(user, res, ['admin', 'tutor'])) return; const body = await readBody(req); const parsed = parseMultipart(body, req.headers['content-type']); const classId = parsed.fields.classId; const type = parsed.fields.type; if (!parsed.file) return error(res, 400, 'File is required.'); if (!classAccess(user, classId)) return error(res, 403, 'No access to classroom.'); const storedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeFileName(parsed.file.filename)}`; fs.writeFileSync(path.join(UPLOAD_DIR, storedName), parsed.file.data); const m = { id: uid('m'), classId, name: parsed.file.filename, type: type || 'Document', size: formatSize(parsed.file.data.length), date: todayISO, storedName }; store.materials.unshift(m); saveStore(); return send(res, 201, m); }
    m = p.match(/^\/api\/materials\/([^/]+)\/download$/); if (m && method === 'GET') { const material = store.materials.find(x => x.id === m[1]); if (!material) return error(res, 404, 'Material not found.'); if (!classAccess(user, material.classId)) return error(res, 403, 'No access to this material.'); let file = material.storedName ? path.join(UPLOAD_DIR, material.storedName) : null; if (!file || !fs.existsSync(file)) { const fallback = Buffer.from(`GM Tutoring material\n\nName: ${material.name}\nClassroom: ${findClass(material.classId)?.name || 'Unknown'}\nType: ${material.type}\n\nThis is a seeded demonstration resource. The production version will contain the original uploaded file.`); res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeFileName(material.name.replace(/\.[^.]+$/, ''))}_demo.txt"`, 'Access-Control-Allow-Origin': '*', 'Content-Length': fallback.length }); return res.end(fallback); } res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${safeFileName(material.name)}"`, 'Access-Control-Allow-Origin': '*' }); return fs.createReadStream(file).pipe(res); }

    if (p === '/api/recordings' && method === 'GET') { let x = store.recordings; if (user.role !== 'admin') x = x.filter(r => classAccess(user, r.classId)); return send(res, 200, x); }
    m = p.match(/^\/api\/recordings\/([^/]+)\/download$/); if (m && method === 'GET') { const r = store.recordings.find(x => x.id === m[1]); if (!r) return error(res, 404, 'Recording not found.'); if (!classAccess(user, r.classId)) return error(res, 403, 'No access to this recording.'); const file = r.storedName ? path.join(UPLOAD_DIR, r.storedName) : null; if (!file || !fs.existsSync(file)) return error(res, 404, 'Recording file is not available.'); res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Disposition': `attachment; filename=\"${safeFileName(r.filename || 'gm-tutoring-recording.webm')}\"`, 'Access-Control-Allow-Origin': '*' }); return fs.createReadStream(file).pipe(res); }
    if (p === '/api/payments' && method === 'GET') { if (!requireRole(user, res, ['admin'])) return; return send(res, 200, store.payments); }
    if (p === '/api/payments' && method === 'POST') { if (!requireRole(user, res, ['admin'])) return; const b = await readJson(req); if (!findUser(b.learnerId) || findUser(b.learnerId).role !== 'learner') return error(res, 400, 'Valid learner required.'); const pmt = { id: uid('p'), learnerId: b.learnerId, amount: Number(b.amount) || 0, status: b.status || 'Paid', date: todayISO, method: b.method || 'EFT' }; store.payments.unshift(pmt); saveStore(); return send(res, 201, pmt); }
    if (p === '/api/referrals' && method === 'GET') { if (!requireRole(user, res, ['admin'])) return; return send(res, 200, store.referrals); }
    if (p === '/api/referrals' && method === 'POST') { if (!requireRole(user, res, ['admin'])) return; const b = await readJson(req); if (!b.name || !b.code) return error(res, 400, 'Name and referral code required.'); const r = { id: uid('ref'), name: b.name, code: b.code, learners: 0, commission: 0, bonusRemaining: 10 }; store.referrals.push(r); saveStore(); return send(res, 201, r); }
    if (p === '/api/parents' && method === 'GET') { if (!requireRole(user, res, ['admin'])) return; return send(res, 200, store.parents || []); }
    if (p === '/api/parents' && method === 'POST') { if (!requireRole(user, res, ['admin'])) return; const b = await readJson(req); if (!b.name || !b.email || !findUser(b.learnerId) || findUser(b.learnerId).role !== 'learner') return error(res, 400, 'Parent name, email and valid learner are required.'); store.parents = store.parents || []; const parent = { id: uid('par'), name: b.name, email: b.email, learnerId: b.learnerId, status: 'Pending' }; store.parents.push(parent); saveStore(); return send(res, 201, parent); }
    if (p === '/api/reports/summary' && method === 'GET') { if (!requireRole(user, res, ['admin', 'tutor'])) return; const classes = user.role === 'admin' ? store.classes : store.classes.filter(c => c.tutorId === user.id); const ids = new Set(classes.map(c => c.id)); const at = store.attendance.filter(a => ids.has(a.classId)); return send(res, 200, { learners: new Set(classes.flatMap(c => c.learners)).size, tutors: new Set(classes.map(c => c.tutorId).filter(Boolean)).size, classes: classes.length, attendanceRecords: at.length, present: at.filter(a => a.status === 'Present').length, activities: store.activities.filter(a => ids.has(a.classId)).length }); }

    return error(res, 404, 'API route not found.');
  } catch (e) { console.error(e); return error(res, 500, e.message || 'Internal server error.'); }
}

http.createServer(handle).listen(PORT, () => console.log(`GM Tutoring backend running at http://localhost:${PORT}`));
