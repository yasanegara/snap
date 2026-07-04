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

module.exports = { createSessionCookie, clearSessionCookie, requireAuth, requireAuthPage, attachUserIfAny };

