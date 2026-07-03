const jwt = require('jsonwebtoken');

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

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Belum login' });
  try {
    const payload = jwt.verify(token, SESSION_SECRET);
    req.user = payload; // { userId, email, orgId }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesi tidak valid, silakan login lagi' });
  }
}

// Versi lembut: kalau ada sesi, isi req.user; kalau tidak ada, biarkan lewat (buat halaman publik)
function attachUserIfAny(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    try { req.user = jwt.verify(token, SESSION_SECRET); } catch (e) { /* abaikan */ }
  }
  next();
}

module.exports = { createSessionCookie, clearSessionCookie, requireAuth, attachUserIfAny };
