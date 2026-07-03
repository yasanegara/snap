require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');

const { readJSON, writeJSON } = require('./lib/jsonStore');
const { createSessionCookie, clearSessionCookie, requireAuth, attachUserIfAny } = require('./lib/auth');
const { createProCheckout, CLIENT_KEY, PRO_PRICE } = require('./lib/midtrans');

const app = express();
const PORT = process.env.PORT || 3000;
const FREE_SNIPPET_LIMIT = 3;

app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function genId(prefix) {
  return (prefix ? prefix + '-' : '') + crypto.randomBytes(8).toString('hex');
}

function isOrgPro(org) {
  return org && org.plan === 'pro' && org.subscriptionExpiresAt && org.subscriptionExpiresAt > Date.now();
}

// ---------------------------------------------------------------------------
// Custom domain: kalau ada yang buka lewat domain sendiri, langsung sajikan
// halaman yang sudah dipublish buat domain itu (jalan sebelum semua route lain)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  if (!host || req.path.startsWith('/api/')) return next();
  const publishes = readJSON('publishes');
  const found = Object.values(publishes).find((p) => p.customDomain && p.customDomain.toLowerCase() === host);
  if (found) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(found.html);
  }
  next();
});

// ---------------------------------------------------------------------------
// Halaman (gate login)
// ---------------------------------------------------------------------------
app.get('/', attachUserIfAny, (req, res) => {
  res.redirect(req.user ? '/app' : '/login.html');
});

app.get('/app', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Halaman publik hasil publish
app.get('/p/:slug', (req, res) => {
  const publishes = readJSON('publishes');
  const item = publishes[req.params.slug];
  if (!item) {
    return res.status(404).send('<h1 style="font-family:sans-serif">404 - Halaman tidak ditemukan</h1>');
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(item.html);
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  const { email, password, orgName } = req.body || {};
  if (!email || !password || !orgName) {
    return res.status(400).json({ error: 'Email, password, dan nama tim wajib diisi' });
  }
  const users = readJSON('users');
  const existing = Object.values(users).find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email sudah terdaftar' });

  const orgs = readJSON('orgs');
  const orgId = genId('org');
  orgs[orgId] = {
    id: orgId,
    name: orgName,
    plan: 'free',
    subscriptionExpiresAt: null,
    createdAt: Date.now()
  };
  await writeJSON('orgs', orgs);

  const userId = genId('user');
  const passwordHash = await bcrypt.hash(password, 10);
  users[userId] = { id: userId, email, passwordHash, orgId, role: 'owner', createdAt: Date.now() };
  await writeJSON('users', users);

  createSessionCookie(res, { userId, email, orgId });
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' });

  const users = readJSON('users');
  const user = Object.values(users).find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Email atau password salah' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Email atau password salah' });

  createSessionCookie(res, { userId: user.id, email: user.email, orgId: user.orgId });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const orgs = readJSON('orgs');
  const org = orgs[req.user.orgId];
  res.json({
    email: req.user.email,
    org: org ? {
      id: org.id,
      name: org.name,
      plan: isOrgPro(org) ? 'pro' : 'free',
      subscriptionExpiresAt: org.subscriptionExpiresAt
    } : null,
    freeSnippetLimit: FREE_SNIPPET_LIMIT
  });
});

// ---------------------------------------------------------------------------
// Snippets (riwayat kode) — dipisah per tim (orgId)
// ---------------------------------------------------------------------------
app.get('/api/snippets', requireAuth, (req, res) => {
  const all = readJSON('snippets');
  const list = Object.values(all)
    .filter((s) => s.orgId === req.user.orgId)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  res.json(list);
});

app.post('/api/snippets', requireAuth, async (req, res) => {
  const { name, type, code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code wajib diisi' });

  const orgs = readJSON('orgs');
  const org = orgs[req.user.orgId];
  const all = readJSON('snippets');
  const currentCount = Object.values(all).filter((s) => s.orgId === req.user.orgId).length;

  if (!isOrgPro(org) && currentCount >= FREE_SNIPPET_LIMIT) {
    return res.status(402).json({
      error: 'Paket gratis cuma bisa nyimpen ' + FREE_SNIPPET_LIMIT + ' project. Upgrade ke Pro buat nyimpen lebih banyak.',
      upgradeRequired: true
    });
  }

  const id = genId('snip');
  const item = { id, orgId: req.user.orgId, name: name || 'Tanpa nama', type: type || 'react', code, savedAt: Date.now() };
  all[id] = item;
  await writeJSON('snippets', all);
  res.json(item);
});

app.delete('/api/snippets/:id', requireAuth, async (req, res) => {
  const all = readJSON('snippets');
  const item = all[req.params.id];
  if (!item || item.orgId !== req.user.orgId) return res.status(404).json({ error: 'tidak ditemukan' });
  delete all[req.params.id];
  await writeJSON('snippets', all);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Data live preview (tiruan Firestore), dipisah per tim + per project
// ---------------------------------------------------------------------------
app.get('/api/data/:projectId', requireAuth, (req, res) => {
  const store = readJSON('store');
  const orgStore = store[req.user.orgId] || {};
  res.json(orgStore[req.params.projectId] || {});
});

app.post('/api/data/:projectId', requireAuth, async (req, res) => {
  const store = readJSON('store');
  if (!store[req.user.orgId]) store[req.user.orgId] = {};
  store[req.user.orgId][req.params.projectId] = req.body || {};
  await writeJSON('store', store);
  res.json({ ok: true });
});

app.delete('/api/data/:projectId', requireAuth, async (req, res) => {
  const store = readJSON('store');
  if (store[req.user.orgId]) delete store[req.user.orgId][req.params.projectId];
  await writeJSON('store', store);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Publish — jadikan project sebagai halaman publik (punya slug / custom domain)
// ---------------------------------------------------------------------------
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

app.get('/api/publish', requireAuth, (req, res) => {
  const all = readJSON('publishes');
  const list = Object.values(all)
    .filter((p) => p.orgId === req.user.orgId)
    .map((p) => ({ slug: p.slug, customDomain: p.customDomain, type: p.type, updatedAt: p.updatedAt }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(list);
});

app.post('/api/publish', requireAuth, async (req, res) => {
  const { slug, customDomain, html, type } = req.body || {};
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return res.status(400).json({ error: 'Slug gak valid. Pakai huruf kecil, angka, dan tanda "-" aja, misal: exist-detailing' });
  }
  if (!html) return res.status(400).json({ error: 'Gak ada konten buat dipublish' });

  const all = readJSON('publishes');
  const existing = all[slug];
  if (existing && existing.orgId !== req.user.orgId) {
    return res.status(409).json({ error: 'Slug "' + slug + '" sudah dipakai tim lain. Coba slug lain.' });
  }

  if (customDomain) {
    const domainTaken = Object.values(all).find(
      (p) => p.customDomain && p.customDomain.toLowerCase() === customDomain.toLowerCase() && p.slug !== slug
    );
    if (domainTaken) {
      return res.status(409).json({ error: 'Domain "' + customDomain + '" sudah dipakai project lain.' });
    }
  }

  all[slug] = {
    slug,
    orgId: req.user.orgId,
    customDomain: customDomain || null,
    html,
    type: type || 'react',
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now()
  };
  await writeJSON('publishes', all);

  res.json({ ok: true, slug, url: '/p/' + slug });
});

app.delete('/api/publish/:slug', requireAuth, async (req, res) => {
  const all = readJSON('publishes');
  const item = all[req.params.slug];
  if (!item || item.orgId !== req.user.orgId) return res.status(404).json({ error: 'tidak ditemukan' });
  delete all[req.params.slug];
  await writeJSON('publishes', all);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Billing (Midtrans)
// ---------------------------------------------------------------------------
app.get('/api/billing/info', requireAuth, (req, res) => {
  const orgs = readJSON('orgs');
  const org = orgs[req.user.orgId];
  res.json({ price: PRO_PRICE, clientKey: CLIENT_KEY, plan: isOrgPro(org) ? 'pro' : 'free' });
});

app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  try {
    const orgs = readJSON('orgs');
    const org = orgs[req.user.orgId];
    if (!org) return res.status(404).json({ error: 'Tim tidak ditemukan' });
    const result = await createProCheckout(org, req.user);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Gagal membuat transaksi. Cek MIDTRANS_SERVER_KEY di server. Detail: ' + e.message });
  }
});

// Midtrans akan kirim notifikasi ke sini tiap ada perubahan status pembayaran
app.post('/api/billing/webhook', async (req, res) => {
  try {
    const notif = req.body || {};
    const { order_id, status_code, gross_amount, signature_key, transaction_status } = notif;
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    const expectedSignature = crypto
      .createHash('sha512')
      .update(order_id + status_code + gross_amount + serverKey)
      .digest('hex');

    if (signature_key !== expectedSignature) {
      return res.status(403).json({ error: 'Signature tidak valid' });
    }

    if (transaction_status === 'capture' || transaction_status === 'settlement') {
      // order_id formatnya: PRO-<orgId>-<timestamp>
      const parts = String(order_id).split('-');
      const orgId = parts.length >= 3 ? parts.slice(1, -1).join('-') : null;
      if (orgId) {
        const orgs = readJSON('orgs');
        if (orgs[orgId]) {
          orgs[orgId].plan = 'pro';
          orgs[orgId].subscriptionExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
          await writeJSON('orgs', orgs);
        }
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('Live Preview Studio (SaaS) jalan di http://localhost:' + PORT);
});
