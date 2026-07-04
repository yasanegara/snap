require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');

const { pool, migrate } = require('./lib/db');
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
  return org && org.plan === 'pro' && org.subscription_expires_at && Number(org.subscription_expires_at) > Date.now();
}

async function getOrg(orgId) {
  const r = await pool.query('SELECT * FROM orgs WHERE id = $1', [orgId]);
  return r.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Custom domain: kalau ada yang buka lewat domain sendiri, langsung sajikan
// halaman yang sudah dipublish buat domain itu (jalan sebelum semua route lain)
// ---------------------------------------------------------------------------
app.use(async (req, res, next) => {
  try {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    if (!host || req.path.startsWith('/api/')) return next();
    const r = await pool.query('SELECT html FROM publishes WHERE LOWER(custom_domain) = $1', [host]);
    if (r.rows[0]) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(r.rows[0].html);
    }
    next();
  } catch (e) { next(); }
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
app.get('/p/:slug', async (req, res) => {
  const r = await pool.query('SELECT html FROM publishes WHERE slug = $1', [req.params.slug]);
  if (!r.rows[0]) return res.status(404).send('<h1 style="font-family:sans-serif">404 - Halaman tidak ditemukan</h1>');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(r.rows[0].html);
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  const { email, password, orgName } = req.body || {};
  if (!email || !password || !orgName) {
    return res.status(400).json({ error: 'Email, password, dan nama tim wajib diisi' });
  }
  const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (existing.rows[0]) return res.status(409).json({ error: 'Email sudah terdaftar' });

  const orgId = genId('org');
  await pool.query(
    'INSERT INTO orgs (id, name, plan, subscription_expires_at, created_at) VALUES ($1,$2,$3,$4,$5)',
    [orgId, orgName, 'free', null, Date.now()]
  );

  const userId = genId('user');
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (id, email, password_hash, org_id, role, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, email, passwordHash, orgId, 'owner', Date.now()]
  );

  createSessionCookie(res, { userId, email, orgId });
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' });

  const r = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  const user = r.rows[0];
  if (!user) return res.status(401).json({ error: 'Email atau password salah' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Email atau password salah' });

  createSessionCookie(res, { userId: user.id, email: user.email, orgId: user.org_id });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const org = await getOrg(req.user.orgId);
  res.json({
    email: req.user.email,
    org: org ? {
      id: org.id,
      name: org.name,
      plan: isOrgPro(org) ? 'pro' : 'free',
      subscriptionExpiresAt: org.subscription_expires_at
    } : null,
    freeSnippetLimit: FREE_SNIPPET_LIMIT
  });
});

// ---------------------------------------------------------------------------
// Snippets (riwayat kode) — dipisah per tim (orgId)
// ---------------------------------------------------------------------------
app.get('/api/snippets', requireAuth, async (req, res) => {
  const r = await pool.query(
    'SELECT id, name, type, code, saved_at AS "savedAt" FROM snippets WHERE org_id = $1 ORDER BY saved_at DESC',
    [req.user.orgId]
  );
  res.json(r.rows);
});

app.post('/api/snippets', requireAuth, async (req, res) => {
  const { name, type, code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code wajib diisi' });

  const org = await getOrg(req.user.orgId);
  const countRes = await pool.query('SELECT COUNT(*)::int AS c FROM snippets WHERE org_id = $1', [req.user.orgId]);
  const currentCount = countRes.rows[0].c;

  if (!isOrgPro(org) && currentCount >= FREE_SNIPPET_LIMIT) {
    return res.status(402).json({
      error: 'Paket gratis cuma bisa nyimpen ' + FREE_SNIPPET_LIMIT + ' project. Upgrade ke Pro buat nyimpen lebih banyak.',
      upgradeRequired: true
    });
  }

  const id = genId('snip');
  const savedAt = Date.now();
  await pool.query(
    'INSERT INTO snippets (id, org_id, name, type, code, saved_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, req.user.orgId, name || 'Tanpa nama', type || 'react', code, savedAt]
  );
  res.json({ id, orgId: req.user.orgId, name: name || 'Tanpa nama', type: type || 'react', code, savedAt });
});

app.delete('/api/snippets/:id', requireAuth, async (req, res) => {
  const r = await pool.query('DELETE FROM snippets WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'tidak ditemukan' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Data live preview (tiruan Firestore), dipisah per tim + per project
// ---------------------------------------------------------------------------
app.get('/api/data/:projectId', requireAuth, async (req, res) => {
  const r = await pool.query(
    'SELECT data FROM project_data WHERE org_id = $1 AND project_id = $2',
    [req.user.orgId, req.params.projectId]
  );
  res.json(r.rows[0] ? r.rows[0].data : {});
});

app.post('/api/data/:projectId', requireAuth, async (req, res) => {
  await pool.query(
    `INSERT INTO project_data (org_id, project_id, data) VALUES ($1,$2,$3)
     ON CONFLICT (org_id, project_id) DO UPDATE SET data = $3`,
    [req.user.orgId, req.params.projectId, req.body || {}]
  );
  res.json({ ok: true });
});

app.delete('/api/data/:projectId', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM project_data WHERE org_id = $1 AND project_id = $2', [req.user.orgId, req.params.projectId]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Publish — jadikan project sebagai halaman publik (punya slug / custom domain)
// ---------------------------------------------------------------------------
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

app.get('/api/publish', requireAuth, async (req, res) => {
  const r = await pool.query(
    'SELECT slug, custom_domain AS "customDomain", type, updated_at AS "updatedAt" FROM publishes WHERE org_id = $1 ORDER BY updated_at DESC',
    [req.user.orgId]
  );
  res.json(r.rows);
});

app.post('/api/publish', requireAuth, async (req, res) => {
  const { slug, customDomain, html, type, initialData } = req.body || {};
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return res.status(400).json({ error: 'Slug gak valid. Pakai huruf kecil, angka, dan tanda "-" aja, misal: exist-detailing' });
  }
  if (!html) return res.status(400).json({ error: 'Gak ada konten buat dipublish' });

  const existingRes = await pool.query('SELECT * FROM publishes WHERE slug = $1', [slug]);
  const existing = existingRes.rows[0];
  if (existing && existing.org_id !== req.user.orgId) {
    return res.status(409).json({ error: 'Slug "' + slug + '" sudah dipakai tim lain. Coba slug lain.' });
  }

  if (customDomain) {
    const domainTaken = await pool.query(
      'SELECT slug FROM publishes WHERE LOWER(custom_domain) = LOWER($1) AND slug != $2',
      [customDomain, slug]
    );
    if (domainTaken.rows[0]) {
      return res.status(409).json({ error: 'Domain "' + customDomain + '" sudah dipakai project lain.' });
    }
  }

  const now = Date.now();
  await pool.query(
    `INSERT INTO publishes (slug, org_id, custom_domain, html, type, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (slug) DO UPDATE SET custom_domain = $3, html = $4, type = $5, updated_at = $7`,
    [slug, req.user.orgId, customDomain || null, html, type || 'react', existing ? existing.created_at : now, now]
  );

  if (!existing && initialData) {
    await pool.query(
      `INSERT INTO public_data (slug, data) VALUES ($1,$2)
       ON CONFLICT (slug) DO NOTHING`,
      [slug, initialData]
    );
  }

  res.json({ ok: true, slug, url: '/p/' + slug });
});

app.delete('/api/publish/:slug', requireAuth, async (req, res) => {
  const r = await pool.query('DELETE FROM publishes WHERE slug = $1 AND org_id = $2', [req.params.slug, req.user.orgId]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'tidak ditemukan' });
  res.json({ ok: true });
});

app.delete('/api/publish/:slug/data', requireAuth, async (req, res) => {
  const ownRes = await pool.query('SELECT slug FROM publishes WHERE slug = $1 AND org_id = $2', [req.params.slug, req.user.orgId]);
  if (!ownRes.rows[0]) return res.status(404).json({ error: 'tidak ditemukan' });
  await pool.query('DELETE FROM public_data WHERE slug = $1', [req.params.slug]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Data live buat halaman yang SUDAH dipublish — publik (tanpa login)
// ---------------------------------------------------------------------------
app.get('/api/public-data/:slug', async (req, res) => {
  const exists = await pool.query('SELECT slug FROM publishes WHERE slug = $1', [req.params.slug]);
  if (!exists.rows[0]) return res.status(404).json({ error: 'slug tidak ditemukan' });
  const r = await pool.query('SELECT data FROM public_data WHERE slug = $1', [req.params.slug]);
  res.json(r.rows[0] ? r.rows[0].data : {});
});

app.post('/api/public-data/:slug', async (req, res) => {
  const exists = await pool.query('SELECT slug FROM publishes WHERE slug = $1', [req.params.slug]);
  if (!exists.rows[0]) return res.status(404).json({ error: 'slug tidak ditemukan' });
  await pool.query(
    `INSERT INTO public_data (slug, data) VALUES ($1,$2)
     ON CONFLICT (slug) DO UPDATE SET data = $2`,
    [req.params.slug, req.body || {}]
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Billing (Midtrans)
// ---------------------------------------------------------------------------
app.get('/api/billing/info', requireAuth, async (req, res) => {
  const org = await getOrg(req.user.orgId);
  res.json({ price: PRO_PRICE, clientKey: CLIENT_KEY, plan: isOrgPro(org) ? 'pro' : 'free' });
});

app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  try {
    const org = await getOrg(req.user.orgId);
    if (!org) return res.status(404).json({ error: 'Tim tidak ditemukan' });
    const result = await createProCheckout({ id: org.id }, req.user);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Gagal membuat transaksi. Cek MIDTRANS_SERVER_KEY di server. Detail: ' + e.message });
  }
});

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
      const parts = String(order_id).split('-');
      const orgId = parts.length >= 3 ? parts.slice(1, -1).join('-') : null;
      if (orgId) {
        await pool.query(
          'UPDATE orgs SET plan = $1, subscription_expires_at = $2 WHERE id = $3',
          ['pro', Date.now() + 30 * 24 * 60 * 60 * 1000, orgId]
        );
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

console.log('Cek DATABASE_URL:', process.env.DATABASE_URL ? 'ADA (' + process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@') + ')' : 'KOSONG / TIDAK ADA');

migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log('Live Preview Studio (SaaS + Postgres) jalan di http://localhost:' + PORT);
    });
  })
  .catch((e) => {
    console.error('Gagal konek/setup database. Detail error:');
    console.error(e);
    process.exit(1);
  });
