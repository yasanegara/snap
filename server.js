require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');

const { pool, migrate } = require('./lib/db');
const { createSessionCookie, clearSessionCookie, requireAuth, requireAuthPage, attachUserIfAny, requireSuperAdmin, requireSuperAdminPage, requireStudioAccessPage } = require('./lib/auth');
const { createProCheckout, CLIENT_KEY, PRO_PRICE } = require('./lib/midtrans');
const { generateHtmlFromPrompt, generateHtmlFromPromptStream, extractCode, stripStrayFences, extractJSONObject, getSetting, setSetting, getAiConfig, estimateCostUSD, PRICING, ANTHROPIC_MODELS } = require('./lib/ai');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Ambil batasan paket (workspace/halaman/member/AI) sesuai paket tim (free/pro)
async function getPlanLimits(org) {
  const planName = isOrgPro(org) ? 'pro' : 'free';
  const r = await pool.query('SELECT * FROM plans WHERE name = $1', [planName]);
  return r.rows[0] || { max_workspaces: 3, max_pages_per_workspace: 3, max_members_per_workspace: 2, max_ai_generations: 3, included_tokens: 50000 };
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
// Buka alamat ini lewat browser buat cek status koneksi database
app.get('/api/health-check', async (req, res) => {
  const info = {
    databaseUrlAda: !!process.env.DATABASE_URL,
    databaseUrlSekilas: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@') : null
  };
  try {
    await pool.query('SELECT 1');
    info.koneksiDatabase = 'OK, berhasil konek';
  } catch (e) {
    info.koneksiDatabase = 'GAGAL';
    info.errorMessage = e.message;
    info.errorCode = e.code || null;
  }
  res.json(info);
});

app.get('/', attachUserIfAny, (req, res) => {
  if (req.user) return res.redirect('/dashboard.html');
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/app', requireAuthPage, requireStudioAccessPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/prompt-generator.html', requireAuthPage, requireStudioAccessPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'private-pages', 'prompt-generator.html'));
});

app.get('/superadmin.html', requireAuthPage, requireSuperAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'private-pages', 'superadmin.html'));
});

// Halaman daftar khusus (bebas daftar sendiri, gak lewat WhatsApp) — link ini gak dipromosikan publik
app.get('/amelt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register-internal.html'));
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
  const freePlan = await pool.query('SELECT included_tokens FROM plans WHERE name = $1', ['free']);
  const initialTokens = freePlan.rows[0] ? freePlan.rows[0].included_tokens : 50000;
  await pool.query(
    'INSERT INTO orgs (id, name, plan, subscription_expires_at, created_at, token_balance) VALUES ($1,$2,$3,$4,$5,$6)',
    [orgId, orgName, 'free', null, Date.now(), initialTokens]
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
  const limits = await getPlanLimits(org);
  const userRow = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.userId]);
  res.json({
    email: req.user.email,
    role: userRow.rows[0] ? userRow.rows[0].role : 'member',
    org: org ? {
      id: org.id,
      name: org.name,
      plan: isOrgPro(org) ? 'pro' : 'free',
      subscriptionExpiresAt: org.subscription_expires_at,
      tokenBalance: org ? Number(org.token_balance) : 0
    } : null,
    limits: {
      maxWorkspaces: limits.max_workspaces,
      maxPagesPerWorkspace: limits.max_pages_per_workspace,
      maxMembersPerWorkspace: limits.max_members_per_workspace,
      maxAiGenerations: limits.max_ai_generations,
      includedTokens: Number(limits.included_tokens)
    }
  });
});

// ---------------------------------------------------------------------------
// Workspace — tiap tim bisa punya beberapa workspace, tiap workspace isinya halaman-halaman
// ---------------------------------------------------------------------------
app.get('/api/workspaces', requireAuth, async (req, res) => {
  const r = await pool.query(
    `SELECT w.id, w.name, w.created_at AS "createdAt", w.custom_domain AS "customDomain",
      COUNT(s.id)::int AS "pageCount",
      COUNT(s.id) FILTER (WHERE s.last_published_slug IS NOT NULL)::int AS "publishedCount",
      COUNT(s.id) FILTER (WHERE s.last_published_slug IS NULL)::int AS "draftCount"
     FROM workspaces w LEFT JOIN snippets s ON s.workspace_id = w.id
     WHERE w.org_id = $1 GROUP BY w.id ORDER BY w.created_at ASC`,
    [req.user.orgId]
  );
  res.json(r.rows);
});

// Simpan/ubah domain kustom buat 1 workspace (dipakai buat auto-isi pas publish, sekaligus catatan terpusat)
app.put('/api/workspaces/:id/domain', requireAuth, async (req, res) => {
  const { customDomain } = req.body || {};
  const cleaned = (customDomain || '').trim().toLowerCase() || null;

  if (cleaned) {
    const taken = await pool.query(
      'SELECT id FROM workspaces WHERE LOWER(custom_domain) = $1 AND id != $2',
      [cleaned, req.params.id]
    );
    if (taken.rows[0]) return res.status(409).json({ error: 'Domain itu udah dipakai workspace lain.' });
  }

  const r = await pool.query(
    'UPDATE workspaces SET custom_domain = $2 WHERE id = $1 AND org_id = $3 RETURNING id',
    [req.params.id, cleaned, req.user.orgId]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'Workspace tidak ditemukan' });
  res.json({ ok: true, customDomain: cleaned });
});

app.post('/api/workspaces', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama workspace wajib diisi' });

  const org = await getOrg(req.user.orgId);
  const limits = await getPlanLimits(org);
  const countRes = await pool.query('SELECT COUNT(*)::int AS c FROM workspaces WHERE org_id = $1', [req.user.orgId]);
  if (countRes.rows[0].c >= limits.max_workspaces) {
    return res.status(402).json({
      error: 'Paket kamu cuma bisa bikin ' + limits.max_workspaces + ' workspace. Upgrade ke Pro buat bikin lebih banyak.',
      upgradeRequired: true
    });
  }

  const id = genId('ws');
  const createdAt = Date.now();
  await pool.query(
    'INSERT INTO workspaces (id, org_id, name, created_at) VALUES ($1,$2,$3,$4)',
    [id, req.user.orgId, name.trim(), createdAt]
  );
  // pembuat workspace otomatis jadi member pertama
  await pool.query(
    'INSERT INTO workspace_members (workspace_id, user_id, added_at) VALUES ($1,$2,$3)',
    [id, req.user.userId, createdAt]
  );
  res.json({ id, name: name.trim(), createdAt, pageCount: 0 });
});

app.delete('/api/workspaces/:id', requireAuth, async (req, res) => {
  const r = await pool.query('DELETE FROM workspaces WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'tidak ditemukan' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Anggota Workspace — undang orang lain buat kerja bareng di 1 workspace
// ---------------------------------------------------------------------------
app.get('/api/workspaces/:id/members', requireAuth, async (req, res) => {
  const wsCheck = await pool.query('SELECT id FROM workspaces WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
  if (!wsCheck.rows[0]) return res.status(404).json({ error: 'Workspace tidak ditemukan' });

  const r = await pool.query(
    `SELECT u.id, u.email, u.role, wm.added_at AS "addedAt"
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY wm.added_at ASC`,
    [req.params.id]
  );
  res.json(r.rows);
});

app.post('/api/workspaces/:id/members', requireAuth, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' });

  const wsCheck = await pool.query('SELECT id FROM workspaces WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
  if (!wsCheck.rows[0]) return res.status(404).json({ error: 'Workspace tidak ditemukan' });

  const org = await getOrg(req.user.orgId);
  const limits = await getPlanLimits(org);
  const memberCountRes = await pool.query('SELECT COUNT(*)::int AS c FROM workspace_members WHERE workspace_id = $1', [req.params.id]);
  if (memberCountRes.rows[0].c >= limits.max_members_per_workspace) {
    return res.status(402).json({
      error: 'Paket kamu cuma bisa punya ' + limits.max_members_per_workspace + ' member per workspace. Upgrade ke Pro buat nambah lebih banyak.',
      upgradeRequired: true
    });
  }

  // Cek dulu, mungkin orangnya udah punya akun di tim yang sama (tinggal ditambahin ke workspace ini)
  let existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  let userId;

  if (existing.rows[0]) {
    const userCheck = await pool.query('SELECT org_id FROM users WHERE id = $1', [existing.rows[0].id]);
    if (userCheck.rows[0].org_id !== req.user.orgId) {
      return res.status(409).json({ error: 'Email itu sudah dipakai tim lain.' });
    }
    userId = existing.rows[0].id;
  } else {
    userId = genId('user');
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (id, email, password_hash, org_id, role, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, email, passwordHash, req.user.orgId, 'member', Date.now()]
    );
  }

  const already = await pool.query('SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [req.params.id, userId]);
  if (already.rows[0]) return res.status(409).json({ error: 'Orang ini sudah jadi member di workspace ini.' });

  await pool.query(
    'INSERT INTO workspace_members (workspace_id, user_id, added_at) VALUES ($1,$2,$3)',
    [req.params.id, userId, Date.now()]
  );
  res.json({ ok: true, userId, email });
});

app.delete('/api/workspaces/:id/members/:userId', requireAuth, async (req, res) => {
  const wsCheck = await pool.query('SELECT id FROM workspaces WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
  if (!wsCheck.rows[0]) return res.status(404).json({ error: 'Workspace tidak ditemukan' });
  await pool.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Snippets (halaman web) — dipisah per tim & per workspace
// ---------------------------------------------------------------------------
app.get('/api/snippets', requireAuth, async (req, res) => {
  const { workspaceId } = req.query;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId wajib diisi' });
  const r = await pool.query(
    'SELECT id, name, type, code, saved_at AS "savedAt", last_published_slug AS "lastPublishedSlug", last_published_domain AS "lastPublishedDomain" FROM snippets WHERE org_id = $1 AND workspace_id = $2 ORDER BY saved_at DESC',
    [req.user.orgId, workspaceId]
  );
  res.json(r.rows);
});

app.post('/api/snippets', requireAuth, async (req, res) => {
  const { name, type, code, workspaceId } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code wajib diisi' });
  if (!workspaceId) return res.status(400).json({ error: 'Pilih workspace dulu sebelum menyimpan' });

  const wsCheck = await pool.query('SELECT id FROM workspaces WHERE id = $1 AND org_id = $2', [workspaceId, req.user.orgId]);
  if (!wsCheck.rows[0]) return res.status(404).json({ error: 'Workspace tidak ditemukan' });

  const org = await getOrg(req.user.orgId);
  const limits = await getPlanLimits(org);
  const countRes = await pool.query('SELECT COUNT(*)::int AS c FROM snippets WHERE workspace_id = $1', [workspaceId]);
  const currentCount = countRes.rows[0].c;

  if (currentCount >= limits.max_pages_per_workspace) {
    return res.status(402).json({
      error: 'Paket kamu cuma bisa nyimpen ' + limits.max_pages_per_workspace + ' halaman per workspace. Upgrade ke Pro buat nyimpen lebih banyak, atau bikin workspace baru.',
      upgradeRequired: true
    });
  }

  const id = genId('snip');
  const savedAt = Date.now();
  await pool.query(
    'INSERT INTO snippets (id, org_id, workspace_id, name, type, code, saved_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, req.user.orgId, workspaceId, name || 'Tanpa nama', type || 'react', code, savedAt]
  );
  res.json({ id, orgId: req.user.orgId, workspaceId, name: name || 'Tanpa nama', type: type || 'react', code, savedAt });
});

app.delete('/api/snippets/:id', requireAuth, async (req, res) => {
  const r = await pool.query('DELETE FROM snippets WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'tidak ditemukan' });
  res.json({ ok: true });
});

// Update project yang udah pernah disimpan (dipanggil pas klik "Simpan" ulang, tanpa perlu isi nama lagi)
app.put('/api/snippets/:id', requireAuth, async (req, res) => {
  const { code, type } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code wajib diisi' });
  const r = await pool.query(
    'UPDATE snippets SET code = $3, type = $4, saved_at = $5 WHERE id = $1 AND org_id = $2 RETURNING id, name',
    [req.params.id, req.user.orgId, code, type || 'react', Date.now()]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'Project tidak ditemukan' });
  res.json({ ok: true, id: r.rows[0].id, name: r.rows[0].name });
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
  const { workspaceId } = req.query;
  const params = [req.user.orgId];
  let where = 'org_id = $1';
  if (workspaceId) { params.push(workspaceId); where += ' AND workspace_id = $2'; }
  const r = await pool.query(
    `SELECT slug, custom_domain AS "customDomain", type, updated_at AS "updatedAt" FROM publishes WHERE ${where} ORDER BY updated_at DESC`,
    params
  );
  res.json(r.rows);
});

// Cari 1 URL foto yang VALID (bukan base64) di seluruh data situs, dipakai sebagai
// cadangan kalau seo.image kosong/rusak — biar thumbnail tetep ada walau AI-nya lupa isi.
function findFallbackImage(siteData) {
  if (!siteData || !siteData.sections) return '';
  const isValidUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
  // urutan prioritas: hero duluan, baru section lain
  const order = (siteData.sectionOrder || Object.keys(siteData.sections));
  for (const key of order) {
    const section = siteData.sections[key];
    if (section && isValidUrl(section.image)) return section.image;
  }
  // masih gak ketemu, sisir semua nilai string di semua section
  for (const key in siteData.sections) {
    const section = siteData.sections[key];
    if (!section || typeof section !== 'object') continue;
    for (const v of Object.values(section)) {
      if (isValidUrl(v)) return v;
    }
  }
  return '';
}

// Suntik/timpa tag SEO (title, description, Open Graph, Twitter Card, dll) ke <head>.
// Dipanggil pas publish, biar SELALU ada di HTML mentah (bukan lewat JavaScript) —
// soalnya WhatsApp/Facebook/Twitter cuma baca HTML mentah, gak jalanin JS pas ambil preview link.
function injectSeoMetaTags(html, siteData, pageUrl) {
  const seo = siteData && siteData.seo;
  if (!seo && !(siteData && siteData.sections)) return html;

  const esc = (s) => String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const title = esc((seo && seo.title) || 'Website');
  const description = esc((seo && seo.description) || '');

  // Kalau seo.image kosong/base64, cari cadangan dari section lain sebelum nyerah
  let image = (seo && seo.image && !seo.image.startsWith('data:')) ? seo.image : '';
  if (!image) image = findFallbackImage(siteData);

  let tags = '';
  if (title) tags += `<title>${title}</title>\n`;
  if (description) tags += `<meta name="description" content="${description}">\n`;
  tags += `<meta name="robots" content="index, follow">\n`;
  if (title) tags += `<meta property="og:title" content="${title}">\n<meta property="og:site_name" content="${title}">\n`;
  if (description) tags += `<meta property="og:description" content="${description}">\n`;
  tags += `<meta property="og:type" content="website">\n<meta property="og:locale" content="id_ID">\n`;
  if (pageUrl) tags += `<meta property="og:url" content="${esc(pageUrl)}">\n<link rel="canonical" href="${esc(pageUrl)}">\n`;
  if (image) {
    tags += `<meta property="og:image" content="${esc(image)}">\n`;
    tags += `<meta property="og:image:secure_url" content="${esc(image)}">\n`;
    tags += `<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${esc(image)}">\n`;
  }

  // Buang <title> lama (kalau ada) biar gak dobel, baru sisipin tag baru tepat setelah <head>
  let result = html.replace(/<title>[\s\S]*?<\/title>/i, '');
  if (/<head[^>]*>/i.test(result)) {
    result = result.replace(/<head[^>]*>/i, (m) => m + '\n' + tags);
  } else {
    result = tags + result;
  }
  return result;
}

app.post('/api/publish', requireAuth, async (req, res) => {
  const { slug, customDomain, html, type, initialData, workspaceId, snippetId } = req.body || {};
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

  // Suntikkan tag SEO ke <head>, dijamin ada & valid buat crawler.
  // Kirim seluruh initialData (bukan cuma .seo) biar ada cadangan cari gambar dari section lain kalau perlu.
  const pageUrl = customDomain ? ('https://' + customDomain) : null; // slug-based URL diisi client (belum tau domain servernya dari sini)
  const finalHtml = initialData ? injectSeoMetaTags(html, initialData, pageUrl) : html;

  const now = Date.now();
  await pool.query(
    `INSERT INTO publishes (slug, org_id, workspace_id, custom_domain, html, type, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (slug) DO UPDATE SET custom_domain = $4, html = $5, type = $6, updated_at = $8`,
    [slug, req.user.orgId, workspaceId || null, customDomain || null, finalHtml, type || 'react', existing ? existing.created_at : now, now]
  );

  if (!existing && initialData) {
    await pool.query(
      `INSERT INTO public_data (slug, data) VALUES ($1,$2)
       ON CONFLICT (slug) DO NOTHING`,
      [slug, initialData]
    );
  }

  // Tandain di snippet-nya (kalau publish ini dipicu dari project yang tersimpan), biar kelihatan
  // di riwayat "ini udah pernah dipublish" dan gampang di-update lagi tanpa isi ulang slug.
  if (snippetId) {
    await pool.query(
      'UPDATE snippets SET last_published_slug = $2, last_published_domain = $3 WHERE id = $1 AND org_id = $4',
      [snippetId, slug, customDomain || null, req.user.orgId]
    );
  }

  res.json({ ok: true, slug, url: '/' + slug });
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

// Edit section pakai AI di halaman yang SUDAH LIVE — publik (gak perlu login tim),
// tapi tetep makan kuota token dari tim pemilik website itu.
app.post('/api/public-edit-section/:slug', async (req, res) => {
  const { currentData, instruction } = req.body || {};
  if (!currentData) return res.status(400).json({ error: 'Data section kosong' });
  if (!instruction || !instruction.trim()) return res.status(400).json({ error: 'Isi dulu instruksi perubahannya' });

  const publishRow = await pool.query('SELECT org_id FROM publishes WHERE slug = $1', [req.params.slug]);
  if (!publishRow.rows[0]) return res.status(404).json({ error: 'Halaman tidak ditemukan' });
  const orgId = publishRow.rows[0].org_id;

  const org = await getOrg(orgId);
  if (!org) return res.status(404).json({ error: 'Tim pemilik halaman ini tidak ditemukan' });
  if (!isOrgPro(org) && Number(org.token_balance) <= 0) {
    return res.status(402).json({ error: 'Token AI buat website ini sudah habis. Hubungi pengelola website.' });
  }

  const { stripped: strippedData, map: imageMap } = stripBase64Images(currentData);

  const editPrompt =
    'Ini data JSON sebuah website (struktur siteData React):\n\n' +
    JSON.stringify(strippedData, null, 2) + '\n\n' +
    'Tolong ubah data di atas sesuai instruksi berikut: "' + instruction.trim() + '"\n\n' +
    'ATURAN WAJIB (PENTING BANGET):\n' +
    '- Balikin CUMA objek JSON mentah hasil yang sudah diupdate. JANGAN pakai pembungkus ```json atau ``` apa pun. JANGAN kasih kalimat pembuka/penutup/penjelasan sama sekali.\n' +
    '- Jawaban kamu HARUS langsung dimulai dengan tanda { dan langsung diakhiri dengan tanda }.\n' +
    '- JANGAN mengubah struktur/nama field yang sudah ada (jangan tambah/hapus field).\n' +
    '- Field yang gak disebut di instruksi, biarkan nilainya sama persis seperti semula.\n' +
    '- Untuk field gambar (biasanya namanya mengandung kata "image" atau "logo"), JANGAN diubah nilainya sama sekali kecuali diminta secara eksplisit.';

  try {
    const { text: rawText, usage } = await generateHtmlFromPrompt(editPrompt);
    let updatedData = extractJSONObject(rawText);

    if (updatedData === undefined) {
      return res.status(500).json({ error: 'AI membalas dengan format yang gak valid. Coba instruksi yang lebih spesifik/sederhana, atau coba lagi.' });
    }
    updatedData = restoreBase64Images(updatedData, imageMap);

    const tokensUsed = usage.inputTokens + usage.outputTokens;
    await pool.query(
      `UPDATE orgs SET
        ai_input_tokens_used = ai_input_tokens_used + $2,
        ai_output_tokens_used = ai_output_tokens_used + $3,
        token_balance = GREATEST(token_balance - $4, 0)
       WHERE id = $1`,
      [orgId, usage.inputTokens, usage.outputTokens, tokensUsed]
    );

    res.json({ ok: true, data: updatedData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Generate Otomatis — AI langsung bikin kode halaman dari prompt
// ---------------------------------------------------------------------------
app.get('/api/generate/info', requireAuth, async (req, res) => {
  const org = await getOrg(req.user.orgId);
  const limits = await getPlanLimits(org);
  res.json({
    tokenBalance: org ? Number(org.token_balance) : 0,
    includedTokens: limits.included_tokens,
    inputTokensUsed: org ? Number(org.ai_input_tokens_used) : 0,
    outputTokensUsed: org ? Number(org.ai_output_tokens_used) : 0,
    generationsUsed: org ? org.ai_generations_used : 0,
    plan: isOrgPro(org) ? 'pro' : 'free'
  });
});

app.post('/api/generate', requireAuth, async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt kosong' });

  const org = await getOrg(req.user.orgId);
  if (!isOrgPro(org) && Number(org.token_balance) <= 0) {
    return res.status(402).json({
      error: 'Token AI kamu sudah habis. Minta tambahan token ke admin platform, atau upgrade ke Pro buat token tanpa batas.',
      upgradeRequired: true
    });
  }

  try {
    const { text: rawText, usage } = await generateHtmlFromPrompt(prompt);
    const code = stripStrayFences(extractCode(rawText));

    if (!code || code.length < 20) {
      return res.status(500).json({
        error: 'AI mengembalikan hasil yang kosong/gak lengkap. Coba generate ulang, atau coba ganti model AI di Panel Superadmin.'
      });
    }

    const tokensUsed = usage.inputTokens + usage.outputTokens;
    await pool.query(
      `UPDATE orgs SET
        ai_generations_used = ai_generations_used + 1,
        ai_input_tokens_used = ai_input_tokens_used + $2,
        ai_output_tokens_used = ai_output_tokens_used + $3,
        token_balance = GREATEST(token_balance - $4, 0)
       WHERE id = $1`,
      [req.user.orgId, usage.inputTokens, usage.outputTokens, tokensUsed]
    );
    res.json({ ok: true, code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Versi streaming dari /api/generate — AI ngirim hasil sedikit-sedikit,
// jadi progress bar di frontend bisa ngikutin progress ASLI (bukan animasi kira-kira).
app.post('/api/generate-stream', requireAuth, async (req, res) => {
  const { prompt, referenceImage } = req.body || {};
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt kosong' });

  // referenceImage (kalau ada): { base64, mediaType } — batasi ukuran biar gak kebablasan
  let image = null;
  if (referenceImage && referenceImage.base64) {
    if (referenceImage.base64.length > 7000000) {
      return res.status(400).json({ error: 'Gambar referensi kegedean (maksimal ~5MB).' });
    }
    image = { base64: referenceImage.base64, mediaType: referenceImage.mediaType || 'image/png' };
  }

  const org = await getOrg(req.user.orgId);
  if (!isOrgPro(org) && Number(org.token_balance) <= 0) {
    return res.status(402).json({
      error: 'Token AI kamu sudah habis. Minta tambahan token ke admin platform, atau upgrade ke Pro buat token tanpa batas.',
      upgradeRequired: true
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

  try {
    const { text: rawText, usage } = await generateHtmlFromPromptStream(prompt, (charCount) => {
      send({ type: 'progress', charCount });
    }, image);
    const code = stripStrayFences(extractCode(rawText));

    if (!code || code.length < 20) {
      send({ type: 'error', error: 'AI mengembalikan hasil yang kosong/gak lengkap. Coba generate ulang, atau coba ganti model AI di Panel Superadmin.' });
      return res.end();
    }

    const tokensUsed = usage.inputTokens + usage.outputTokens;
    await pool.query(
      `UPDATE orgs SET
        ai_generations_used = ai_generations_used + 1,
        ai_input_tokens_used = ai_input_tokens_used + $2,
        ai_output_tokens_used = ai_output_tokens_used + $3,
        token_balance = GREATEST(token_balance - $4, 0)
       WHERE id = $1`,
      [req.user.orgId, usage.inputTokens, usage.outputTokens, tokensUsed]
    );

    send({ type: 'done', code });
    res.end();
  } catch (e) {
    send({ type: 'error', error: e.message });
    res.end();
  }
});


app.post('/api/edit-section', requireAuth, async (req, res) => {
  const { currentData, instruction } = req.body || {};
  if (!currentData) return res.status(400).json({ error: 'Data section kosong' });
  if (!instruction || !instruction.trim()) return res.status(400).json({ error: 'Isi dulu instruksi perubahannya' });

  const org = await getOrg(req.user.orgId);
  if (!isOrgPro(org) && Number(org.token_balance) <= 0) {
    return res.status(402).json({
      error: 'Token AI kamu sudah habis. Minta tambahan token ke admin platform, atau upgrade ke Pro buat token tanpa batas.',
      upgradeRequired: true
    });
  }

  const { stripped: strippedData1, map: imageMap1 } = stripBase64Images(currentData);

  const editPrompt =
    'Ini data JSON sebuah section website, DIBUNGKUS bareng data "design" (warna, dll) yang berlaku GLOBAL buat seluruh halaman:\n\n' +
    JSON.stringify(strippedData1, null, 2) + '\n\n' +
    'Tolong ubah data di atas sesuai instruksi berikut: "' + instruction.trim() + '"\n\n' +
    'ATURAN WAJIB (PENTING BANGET):\n' +
    '- Struktur objeknya ada 2 bagian: "section" (data section ini doang) dan "design" (warna/style global, dipakai SEMUA section, hati-hati kalau ubah ini soalnya efeknya ke seluruh halaman).\n' +
    '- Biasanya kamu cuma perlu ubah bagian "section". Ubah bagian "design" HANYA kalau instruksinya jelas-jelas soal warna/style GLOBAL (misal "ganti warna tombol semua jadi merah").\n' +
    '- Balikin CUMA objek JSON mentah hasil yang sudah diupdate, dengan struktur { "section": {...}, "design": {...} } PERSIS SAMA kayak yang dikasih. JANGAN pakai pembungkus ```json atau ``` apa pun. JANGAN kasih kalimat pembuka/penutup/penjelasan sama sekali.\n' +
    '- Jawaban kamu HARUS langsung dimulai dengan tanda { dan langsung diakhiri dengan tanda }.\n' +
    '- JANGAN mengubah struktur/nama field yang sudah ada (jangan tambah/hapus field).\n' +
    '- Field yang gak disebut di instruksi, biarkan nilainya sama persis seperti semula.\n' +
    '- Untuk field gambar (biasanya namanya mengandung kata "image" atau "logo"), JANGAN diubah nilainya sama sekali kecuali diminta secara eksplisit.';

  try {
    const { text: rawText, usage } = await generateHtmlFromPrompt(editPrompt);
    let updatedData = extractJSONObject(rawText);

    if (updatedData === undefined) {
      return res.status(500).json({
        error: 'AI membalas dengan format yang gak valid. Coba instruksi yang lebih spesifik/sederhana, atau coba lagi. (Token gak kepotong buat percobaan yang gagal ini.)'
      });
    }
    updatedData = restoreBase64Images(updatedData, imageMap1);

    const tokensUsed = usage.inputTokens + usage.outputTokens;
    await pool.query(
      `UPDATE orgs SET
        ai_input_tokens_used = ai_input_tokens_used + $2,
        ai_output_tokens_used = ai_output_tokens_used + $3,
        token_balance = GREATEST(token_balance - $4, 0)
       WHERE id = $1`,
      [req.user.orgId, usage.inputTokens, usage.outputTokens, tokensUsed]
    );

    res.json({ ok: true, data: updatedData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Foto yang disimpan sebagai base64 itu teksnya BISA SANGAT PANJANG (puluhan ribu karakter).
// Kalau dikirim apa adanya ke AI, gampang kelewat batas ukuran yang model itu sanggup terima.
// Solusinya: ganti dulu jadi teks pendek (placeholder) sebelum dikirim, terus balikin lagi
// abis AI selesai — toh AI emang dilarang ubah foto kecuali diminta jelas.
function stripBase64Images(data) {
  const map = {};
  let counter = 0;

  function walk(obj) {
    if (typeof obj === 'string') {
      if (obj.startsWith('data:image')) {
        const key = '__FOTO_' + (counter++) + '__';
        map[key] = obj;
        return key;
      }
      return obj;
    }
    if (Array.isArray(obj)) return obj.map(walk);
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const k in obj) result[k] = walk(obj[k]);
      return result;
    }
    return obj;
  }

  const stripped = walk(data);
  return { stripped, map };
}

function restoreBase64Images(data, map) {
  function walk(obj) {
    if (typeof obj === 'string') {
      return Object.prototype.hasOwnProperty.call(map, obj) ? map[obj] : obj;
    }
    if (Array.isArray(obj)) return obj.map(walk);
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const k in obj) result[k] = walk(obj[k]);
      return result;
    }
    return obj;
  }
  return walk(data);
}

// Versi streaming dari /api/edit-section — sama kayak /api/generate-stream, biar progress
// yang ditampilkan di popover "Edit Section" itu beneran (bukan cuma pesan muter-muter doang).
app.post('/api/edit-section-stream', requireAuth, async (req, res) => {
  const { currentData, instruction } = req.body || {};
  if (!currentData) return res.status(400).json({ error: 'Data section kosong' });
  if (!instruction || !instruction.trim()) return res.status(400).json({ error: 'Isi dulu instruksi perubahannya' });

  const org = await getOrg(req.user.orgId);
  if (!isOrgPro(org) && Number(org.token_balance) <= 0) {
    return res.status(402).json({
      error: 'Token AI kamu sudah habis. Minta tambahan token ke admin platform, atau upgrade ke Pro buat token tanpa batas.',
      upgradeRequired: true
    });
  }

  const { stripped: strippedData2, map: imageMap2 } = stripBase64Images(currentData);

  const editPrompt =
    'Ini data JSON sebuah section website, DIBUNGKUS bareng data "design" (warna, dll) yang berlaku GLOBAL buat seluruh halaman:\n\n' +
    JSON.stringify(strippedData2, null, 2) + '\n\n' +
    'Tolong ubah data di atas sesuai instruksi berikut: "' + instruction.trim() + '"\n\n' +
    'ATURAN WAJIB (PENTING BANGET):\n' +
    '- Struktur objeknya ada 2 bagian: "section" (data section ini doang) dan "design" (warna/style global, dipakai SEMUA section, hati-hati kalau ubah ini soalnya efeknya ke seluruh halaman).\n' +
    '- Biasanya kamu cuma perlu ubah bagian "section". Ubah bagian "design" HANYA kalau instruksinya jelas-jelas soal warna/style GLOBAL (misal "ganti warna tombol semua jadi merah").\n' +
    '- Balikin CUMA objek JSON mentah hasil yang sudah diupdate, dengan struktur { "section": {...}, "design": {...} } PERSIS SAMA kayak yang dikasih. JANGAN pakai pembungkus ```json atau ``` apa pun. JANGAN kasih kalimat pembuka/penutup/penjelasan sama sekali.\n' +
    '- Jawaban kamu HARUS langsung dimulai dengan tanda { dan langsung diakhiri dengan tanda }.\n' +
    '- JANGAN mengubah struktur/nama field yang sudah ada (jangan tambah/hapus field).\n' +
    '- Field yang gak disebut di instruksi, biarkan nilainya sama persis seperti semula.\n' +
    '- Untuk field gambar (biasanya namanya mengandung kata "image" atau "logo"), JANGAN diubah nilainya sama sekali kecuali diminta secara eksplisit.';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

  try {
    const { text: rawText, usage } = await generateHtmlFromPromptStream(editPrompt, (charCount) => {
      send({ type: 'progress', charCount });
    });
    let updatedData = extractJSONObject(rawText);

    if (updatedData === undefined) {
      send({ type: 'error', error: 'AI membalas dengan format yang gak valid. Coba instruksi yang lebih spesifik/sederhana, atau coba lagi. (Token gak kepotong buat percobaan yang gagal ini.)' });
      return res.end();
    }
    updatedData = restoreBase64Images(updatedData, imageMap2);

    const tokensUsed2 = usage.inputTokens + usage.outputTokens;
    await pool.query(
      `UPDATE orgs SET
        ai_input_tokens_used = ai_input_tokens_used + $2,
        ai_output_tokens_used = ai_output_tokens_used + $3,
        token_balance = GREATEST(token_balance - $4, 0)
       WHERE id = $1`,
      [req.user.orgId, usage.inputTokens, usage.outputTokens, tokensUsed2]
    );

    send({ type: 'done', data: updatedData });
    res.end();
  } catch (e) {
    send({ type: 'error', error: e.message });
    res.end();
  }
});

// Edit SELURUH HALAMAN sekaligus pakai AI (bukan cuma 1 section) — buat perubahan yang
// nyentuh banyak bagian sekaligus, misal "ganti semua warna aksen jadi biru" atau
// "buat semua copywriting lebih santai buat anak muda".
app.post('/api/edit-page-stream', requireAuth, async (req, res) => {
  const { currentData, instruction } = req.body || {};
  if (!currentData) return res.status(400).json({ error: 'Data halaman kosong' });
  if (!instruction || !instruction.trim()) return res.status(400).json({ error: 'Isi dulu instruksi perubahannya' });

  const org = await getOrg(req.user.orgId);
  if (!isOrgPro(org) && Number(org.token_balance) <= 0) {
    return res.status(402).json({
      error: 'Token AI kamu sudah habis. Minta tambahan token ke admin platform, atau upgrade ke Pro buat token tanpa batas.',
      upgradeRequired: true
    });
  }

  const { stripped: strippedData3, map: imageMap3 } = stripBase64Images(currentData);

  const editPrompt =
    'Ini data JSON SELURUH HALAMAN website (struktur siteData React, semua section ada di sini):\n\n' +
    JSON.stringify(strippedData3, null, 2) + '\n\n' +
    'Tolong ubah data di atas sesuai instruksi berikut (instruksi ini bisa nyentuh SATU section atau BANYAK section sekaligus): "' + instruction.trim() + '"\n\n' +
    'ATURAN WAJIB (PENTING BANGET):\n' +
    '- Balikin SELURUH object JSON (semua section, semua field), bukan cuma bagian yang berubah — soalnya hasilnya bakal langsung GANTI TOTAL data yang lama.\n' +
    '- Balikin CUMA objek JSON mentah. JANGAN pakai pembungkus ```json atau ``` apa pun. JANGAN kasih kalimat pembuka/penutup/penjelasan sama sekali.\n' +
    '- Jawaban kamu HARUS langsung dimulai dengan tanda { dan langsung diakhiri dengan tanda }.\n' +
    '- JANGAN mengubah struktur/nama field yang sudah ada (jangan tambah/hapus field/section).\n' +
    '- Bagian yang gak disebut/gak relevan sama instruksi, biarkan nilainya SAMA PERSIS seperti semula.\n' +
    '- Untuk field gambar (biasanya namanya mengandung kata "image" atau "logo"), JANGAN diubah nilainya sama sekali kecuali diminta secara eksplisit.';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

  try {
    const { text: rawText, usage } = await generateHtmlFromPromptStream(editPrompt, (charCount) => {
      send({ type: 'progress', charCount });
    });
    let updatedData = extractJSONObject(rawText);

    if (updatedData === undefined) {
      send({ type: 'error', error: 'AI membalas dengan format yang gak valid. Coba instruksi yang lebih spesifik/sederhana, atau coba lagi. (Token gak kepotong buat percobaan yang gagal ini.)' });
      return res.end();
    }
    updatedData = restoreBase64Images(updatedData, imageMap3);

    const tokensUsed = usage.inputTokens + usage.outputTokens;
    await pool.query(
      `UPDATE orgs SET
        ai_input_tokens_used = ai_input_tokens_used + $2,
        ai_output_tokens_used = ai_output_tokens_used + $3,
        token_balance = GREATEST(token_balance - $4, 0)
       WHERE id = $1`,
      [req.user.orgId, usage.inputTokens, usage.outputTokens, tokensUsed]
    );

    send({ type: 'done', data: updatedData });
    res.end();
  } catch (e) {
    send({ type: 'error', error: e.message });
    res.end();
  }
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

// ---------------------------------------------------------------------------
// Panel Superadmin — buat pemilik platform, ngawasin semua tim
// ---------------------------------------------------------------------------
app.get('/api/superadmin/stats', requireAuth, requireSuperAdmin, async (req, res) => {
  const [orgsCount, proCount, usersCount, wsCount, snippetsCount, publishesCount, aiUsageSum, tokenSum] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM orgs'),
    pool.query("SELECT COUNT(*)::int AS c FROM orgs WHERE plan = 'pro' AND subscription_expires_at > $1", [Date.now()]),
    pool.query('SELECT COUNT(*)::int AS c FROM users'),
    pool.query('SELECT COUNT(*)::int AS c FROM workspaces'),
    pool.query('SELECT COUNT(*)::int AS c FROM snippets'),
    pool.query('SELECT COUNT(*)::int AS c FROM publishes'),
    pool.query('SELECT COALESCE(SUM(ai_generations_used),0)::int AS s FROM orgs'),
    pool.query('SELECT COALESCE(SUM(ai_input_tokens_used),0)::bigint AS i, COALESCE(SUM(ai_output_tokens_used),0)::bigint AS o FROM orgs')
  ]);

  const orgList = await pool.query(`
    SELECT
      o.id, o.name, o.plan, o.subscription_expires_at AS "subscriptionExpiresAt", o.created_at AS "createdAt",
      o.ai_generations_used AS "aiGenerationsUsed", o.token_balance AS "tokenBalance",
      o.ai_input_tokens_used AS "aiInputTokens", o.ai_output_tokens_used AS "aiOutputTokens",
      (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id) AS "userCount",
      (SELECT COUNT(*)::int FROM workspaces w WHERE w.org_id = o.id) AS "workspaceCount",
      (SELECT COUNT(*)::int FROM snippets s WHERE s.org_id = o.id) AS "pageCount",
      (SELECT COUNT(*)::int FROM publishes p WHERE p.org_id = o.id) AS "publishCount"
    FROM orgs o
    ORDER BY o.created_at DESC
  `);

  const { model } = await getAiConfig();
  const totalInputTokens = Number(tokenSum.rows[0].i);
  const totalOutputTokens = Number(tokenSum.rows[0].o);
  const estimatedCostUSD = estimateCostUSD(model, totalInputTokens, totalOutputTokens);

  res.json({
    summary: {
      totalOrgs: orgsCount.rows[0].c,
      totalProOrgs: proCount.rows[0].c,
      totalUsers: usersCount.rows[0].c,
      totalWorkspaces: wsCount.rows[0].c,
      totalPages: snippetsCount.rows[0].c,
      totalPublishes: publishesCount.rows[0].c,
      totalAiGenerations: aiUsageSum.rows[0].s,
      totalInputTokens,
      totalOutputTokens,
      estimatedCostUSD
    },
    orgs: orgList.rows.map((o) => ({
      ...o,
      tokenBalance: Number(o.tokenBalance),
      plan: (o.plan === 'pro' && o.subscriptionExpiresAt && Number(o.subscriptionExpiresAt) > Date.now()) ? 'pro' : 'free'
    }))
  });
});

app.get('/api/superadmin/plans', requireAuth, requireSuperAdmin, async (req, res) => {
  const r = await pool.query('SELECT * FROM plans ORDER BY name ASC');
  res.json(r.rows.map((p) => ({
    name: p.name,
    maxWorkspaces: p.max_workspaces,
    maxPagesPerWorkspace: p.max_pages_per_workspace,
    maxMembersPerWorkspace: p.max_members_per_workspace,
    maxAiGenerations: p.max_ai_generations,
    includedTokens: Number(p.included_tokens)
  })));
});

app.post('/api/superadmin/plans/:name', requireAuth, requireSuperAdmin, async (req, res) => {
  const { maxWorkspaces, maxPagesPerWorkspace, maxMembersPerWorkspace, maxAiGenerations, includedTokens } = req.body || {};
  const r = await pool.query(
    `UPDATE plans SET
      max_workspaces = $2,
      max_pages_per_workspace = $3,
      max_members_per_workspace = $4,
      max_ai_generations = $5,
      included_tokens = $6
     WHERE name = $1`,
    [req.params.name, maxWorkspaces, maxPagesPerWorkspace, maxMembersPerWorkspace, maxAiGenerations, includedTokens]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'Paket tidak ditemukan' });
  res.json({ ok: true });
});

// Top-up token buat tim tertentu (manual sama superadmin, misal abis dibayar di luar sistem)
app.post('/api/superadmin/orgs/:id/topup', requireAuth, requireSuperAdmin, async (req, res) => {
  const { amount } = req.body || {};
  const amt = parseInt(amount, 10);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Jumlah token harus lebih dari 0' });

  const r = await pool.query(
    'UPDATE orgs SET token_balance = token_balance + $2 WHERE id = $1 RETURNING token_balance',
    [req.params.id, amt]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'Tim tidak ditemukan' });
  res.json({ ok: true, newBalance: Number(r.rows[0].token_balance) });
});

// ---------------------------------------------------------------------------
// Landing Page (halaman depan klikweb.id) — kontennya bisa diatur dari Panel Superadmin
// ---------------------------------------------------------------------------
const DEFAULT_LANDING_CONTENT = {
  brandName: 'klikweb.id',
  hero: {
    badge: '🚀 Khusus Buat UMKM Indonesia',
    headline: 'Website UMKM Kamu Bisa ONLINE Hari Ini Juga',
    subheadline: 'Gak perlu ngoding, gak perlu nunggu berminggu-minggu, gak perlu keluar duit buat hosting & domain. Tinggal pilih desain, isi info bisnis kamu, langsung jadi website profesional yang siap dipakai jualan.',
    ctaText: 'Mulai Sekarang',
    ctaLink: 'https://wa.me/6285641806684?text=Halo%2C%20saya%20mau%20daftar%20bikin%20website%20di%20klikweb.id',
    ctaNote: 'Chat langsung, dibantu tim kami dari awal sampai online'
  },
  painPoints: {
    title: 'Kenal Gak Masalah Kayak Gini?',
    items: [
      'Udah coba bikin website sendiri, eh malah ribet dan berakhir gak jadi-jadi',
      'Disuruh bayar hosting & domain tiap tahun yang bikin modal usaha bengkak',
      'Pesan ke jasa bikin website, nunggunya berminggu-minggu padahal pengen jualan SEKARANG',
      'Udah punya website, tapi mau ganti teks/foto dikit aja harus nunggu developer'
    ]
  },
  features: {
    title: 'Semua Beres Dalam 1 Platform',
    items: [
      { icon: '🌐', title: 'Hosting Gratis Selamanya', desc: 'Gak ada lagi tagihan bulanan buat server. Website kamu tetap online tanpa biaya tambahan.' },
      { icon: '🎁', title: 'Domain .com Gratis', desc: 'Buat member paket tertentu, dapet domain .com sendiri (bukan subdomain), gratis di tahun pertama.' },
      { icon: '⚡', title: 'Ringan & Cepat Loading', desc: 'Website landing page yang ringan, jadi pengunjung gak kabur nunggu loading lama.' },
      { icon: '✏️', title: 'Edit Sendiri Kapan Aja', desc: 'Mau ganti teks, harga, atau foto? Tinggal klik dan edit sendiri, gak perlu nunggu developer.' },
      { icon: '📱', title: 'Otomatis Rapi di HP', desc: 'Kebanyakan pengunjung buka dari HP — website kamu otomatis nyesuain, gak perlu setting apa-apa.' },
      { icon: '💬', title: 'Terintegrasi WhatsApp', desc: 'Pengunjung bisa langsung chat WhatsApp buat nanya atau order, gak perlu ribet cari kontak.' }
    ]
  },
  pricing: {
    title: 'Investasi Kecil, Bisnismu Online Selamanya',
    subtitle: 'Gak ada biaya tersembunyi. Gak ada kontrak ribet. Berhenti kapan aja.',
    plans: [
      {
        name: 'Pro',
        price: 'Rp 3.300',
        period: '/hari (setara Rp 1.200.000/tahun)',
        highlight: true,
        features: ['Website tanpa batas', 'Hosting gratis', 'Domain .com GRATIS', 'AI generate otomatis', 'Support prioritas'],
        ctaText: 'Mulai Sekarang'
      }
    ]
  },
  faq: {
    title: 'Pertanyaan yang Sering Ditanya',
    items: [
      { q: 'Ada biaya tersembunyi gak?', a: 'Gak ada. Harganya udah termasuk hosting dan domain .com, gak ada tagihan kejutan di belakang.' },
      { q: 'Perlu bisa ngoding gak?', a: 'Gak sama sekali. Tinggal isi form info bisnis kamu, AI yang bikinin websitenya. Tinggal edit dikit kalau perlu.' },
      { q: 'Berapa lama website-nya jadi?', a: 'Hitungan menit, bukan minggu. Isi form, generate, langsung bisa di-publish.' },
      { q: 'Domain gratisnya beneran punya sendiri?', a: 'Iya, bukan subdomain. Kamu bisa pasang domain .com sendiri (misal namabisnismu.com) buat paket Pro.' }
    ]
  },
  finalCta: {
    headline: 'Tunggu Apa Lagi? Bisnismu Layak Online Hari Ini',
    subheadline: 'Ribuan UMKM udah mulai duluan. Giliran kamu sekarang.',
    ctaText: 'Mulai Sekarang',
    ctaLink: 'https://wa.me/6285641806684?text=Halo%2C%20saya%20mau%20daftar%20bikin%20website%20di%20klikweb.id'
  },
  footerText: '© klikweb.id — Website UMKM Gampang, Cepat, Terpercaya.'
};

// Cari halaman lain yang satu workspace sama slug ini — dipakai di Panel Admin biar
// pemilik website bisa lompat lihat/kelola halaman lain miliknya, gak cuma yang ini doang.
app.get('/api/workspace-siblings/:slug', async (req, res) => {
  const current = await pool.query('SELECT workspace_id FROM publishes WHERE slug = $1', [req.params.slug]);
  if (!current.rows[0] || !current.rows[0].workspace_id) return res.json({ workspaceName: null, pages: [] });

  const workspaceId = current.rows[0].workspace_id;
  const wsRes = await pool.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
  const pagesRes = await pool.query(
    `SELECT p.slug, p.custom_domain AS "customDomain", p.updated_at AS "updatedAt",
      (SELECT s.name FROM snippets s WHERE s.last_published_slug = p.slug LIMIT 1) AS name
     FROM publishes p WHERE p.workspace_id = $1 ORDER BY p.updated_at DESC`,
    [workspaceId]
  );

  res.json({
    workspaceName: wsRes.rows[0] ? wsRes.rows[0].name : null,
    pages: pagesRes.rows.map(p => ({
      slug: p.slug,
      name: p.name || p.slug,
      customDomain: p.customDomain,
      isCurrent: p.slug === req.params.slug
    }))
  });
});

app.get('/api/landing-content', async (req, res) => {
  const saved = await getSetting('landing_content', null);
  res.json(saved ? JSON.parse(saved) : DEFAULT_LANDING_CONTENT);
});

app.post('/api/superadmin/landing-content', requireAuth, requireSuperAdmin, async (req, res) => {
  const content = req.body;
  if (!content || typeof content !== 'object') return res.status(400).json({ error: 'Data gak valid' });
  await setSetting('landing_content', JSON.stringify(content));
  res.json({ ok: true });
});

app.get('/api/superadmin/landing-content/reset', requireAuth, requireSuperAdmin, async (req, res) => {
  await setSetting('landing_content', JSON.stringify(DEFAULT_LANDING_CONTENT));
  res.json({ ok: true, content: DEFAULT_LANDING_CONTENT });
});

app.get('/api/superadmin/settings', requireAuth, requireSuperAdmin, async (req, res) => {
  const { provider, model, apiKey } = await getAiConfig();

  const anthropicKeySrc = (await getSetting('ai_api_key_anthropic', null)) ? 'database' : (process.env.ANTHROPIC_API_KEY ? 'env' : 'belum-diset');
  const sumopodKeySrc = (await getSetting('ai_api_key_sumopod', null)) ? 'database' : (process.env.SUMOPOD_API_KEY ? 'env' : 'belum-diset');

  res.json({
    provider,
    model,
    apiKeyMasked: apiKey ? apiKey.slice(0, 10) + '...' + apiKey.slice(-4) : '',
    anthropic: {
      model: (await getSetting('ai_model_anthropic', null)) || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      maxTokens: parseInt((await getSetting('ai_max_tokens_anthropic', null)) || '64000', 10),
      keySource: anthropicKeySrc,
      availableModels: ANTHROPIC_MODELS
    },
    sumopod: {
      model: (await getSetting('ai_model_sumopod', null)) || process.env.SUMOPOD_MODEL || 'claude-sonnet-4-6',
      maxTokens: parseInt((await getSetting('ai_max_tokens_sumopod', null)) || '120000', 10),
      keySource: sumopodKeySrc
    }
  });
});

app.post('/api/superadmin/settings', requireAuth, requireSuperAdmin, async (req, res) => {
  const { provider, anthropicModel, anthropicApiKey, anthropicMaxTokens, sumopodModel, sumopodApiKey, sumopodMaxTokens } = req.body || {};
  if (provider) await setSetting('ai_provider', provider);
  if (anthropicModel) await setSetting('ai_model_anthropic', anthropicModel);
  if (anthropicApiKey) await setSetting('ai_api_key_anthropic', anthropicApiKey);
  if (anthropicMaxTokens) await setSetting('ai_max_tokens_anthropic', String(parseInt(anthropicMaxTokens, 10)));
  if (sumopodModel) await setSetting('ai_model_sumopod', sumopodModel);
  if (sumopodApiKey) await setSetting('ai_api_key_sumopod', sumopodApiKey);
  if (sumopodMaxTokens) await setSetting('ai_max_tokens_sumopod', String(parseInt(sumopodMaxTokens, 10)));
  res.json({ ok: true });
});

// Link admin yang lebih pendek: klikweb.id/nama-slug/admin (dulu harus /admin.html?endpoint=...)
app.get('/:slug/admin', (req, res) => {
  res.redirect('/admin.html?endpoint=' + encodeURIComponent('/api/public-data/' + req.params.slug));
});

// Halaman publik hasil publish — DIPASANG PALING TERAKHIR dengan sengaja.
// Formatnya klikweb.id/nama-slug (bukan /p/nama-slug lagi). Karena ini "menangkap"
// SATU kata di path mana pun, dia WAJIB jadi route paling akhir, biar semua
// halaman/route lain (yang lebih spesifik) sempat dicek duluan.
app.get('/:slug', async (req, res) => {
  const r = await pool.query('SELECT html FROM publishes WHERE slug = $1', [req.params.slug]);
  if (!r.rows[0]) return res.status(404).send('<h1 style="font-family:sans-serif">404 - Halaman tidak ditemukan</h1>');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(r.rows[0].html);
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
