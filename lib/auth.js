const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const SESSION_SECRET = process.env.SESSION_SECRET || 'ganti-ini-di-production-jangan-dipakai-default';
const COOKIE_NAME = 'session';

function createSessionCookie(res, payload) {
  const token = jwt.sign(payload, SESSION_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Belum login' });
  let payload;
  try {
    payload = jwt.verify(token, SESSION_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Sesi tidak valid, silakan login lagi' });
  }

  // Pastikan tim (org) di sesi login ini BENERAN masih ada di database.
  // Ini mencegah kasus sesi "nyangkut" ke tim yang datanya sudah gak ada
  // (misal database sempat direset/diganti).
  try {
    const r = await pool.query('SELECT id FROM orgs WHERE id = $1', [payload.orgId]);
    if (!r.rows[0]) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Sesi login kamu sudah gak valid (tim tidak ditemukan). Silakan login/daftar ulang.' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Gagal memeriksa sesi login: ' + e.message });
  }

  req.user = payload; // { userId, email, orgId }
  next();
}

// Versi lembut: kalau ada sesi, isi req.user; kalau tidak ada, biarkan lewat (buat halaman publik)
function attachUserIfAny(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    try { req.user = jwt.verify(token, SESSION_SECRET); } catch (e) { /* abaikan */ }
  }
  next();
}

// Versi khusus buat halaman (bukan API): kalau sesi gak valid, redirect ke /login.html
// daripada nampilin teks JSON mentah di layar.
async function requireAuthPage(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.redirect('/login.html');
  let payload;
  try {
    payload = jwt.verify(token, SESSION_SECRET);
  } catch (e) {
    return res.redirect('/login.html');
  }
  try {
    const r = await pool.query('SELECT id FROM orgs WHERE id = $1', [payload.orgId]);
    if (!r.rows[0]) {
      clearSessionCookie(res);
      return res.redirect('/login.html');
    }
  } catch (e) {
    return res.redirect('/login.html');
  }
  req.user = payload;
  next();
}

function isSuperAdminEmail(email) {
  const list = (process.env.SUPERADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}

// Akses Studio (/app) dan alat-alat pembuatan situs lainnya dibatasi cuma buat "tim" —
// superadmin otomatis dapet akses, plus siapa pun yang emailnya didaftarin di ALLOWED_STUDIO_EMAILS.
// Kalau ALLOWED_STUDIO_EMAILS gak di-set sama sekali (kosong), gak ada pembatasan tambahan
// (biar gak keblokir semua kalau env var-nya lupa di-set).
function isAllowedStudioEmail(email) {
  if (!email) return false;
  if (isSuperAdminEmail(email)) return true;
  const raw = process.env.ALLOWED_STUDIO_EMAILS || '';
  if (!raw.trim()) return true; // belum di-set = gak dibatasi (default lama, biar aman)
  const list = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

// Buat halaman Studio & alat pembuatan situs: kalau bukan tim, tendang ke halaman depan
function requireStudioAccessPage(req, res, next) {
  if (!req.user || !isAllowedStudioEmail(req.user.email)) {
    return res.redirect('/akses-terbatas.html');
  }
  next();
}

// Buat endpoint API panel superadmin: tolak kalau bukan email yang terdaftar sebagai superadmin
function requireSuperAdmin(req, res, next) {
  if (!req.user || !isSuperAdminEmail(req.user.email)) {
    return res.status(403).json({ error: 'Kamu gak punya akses ke halaman ini.' });
  }
  next();
}

// Buat halaman panel superadmin: redirect ke /app kalau bukan superadmin
function requireSuperAdminPage(req, res, next) {
  if (!req.user || !isSuperAdminEmail(req.user.email)) {
    return res.redirect('/app');
  }
  next();
}

module.exports = { createSessionCookie, clearSessionCookie, requireAuth, requireAuthPage, attachUserIfAny, isSuperAdminEmail, requireSuperAdmin, requireSuperAdminPage, isAllowedStudioEmail, requireStudioAccessPage };

