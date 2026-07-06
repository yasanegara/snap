const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// Postgres bawaan Railway (koneksi internal) biasanya GAK butuh SSL.
// Kalau nanti pakai Postgres dari provider lain yang wajib SSL (misal Supabase),
// set env var PGSSL=true di pengaturan Railway.
const useSSL = process.env.PGSSL === 'true';

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Koneksi database bermasalah:', err.message);
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      subscription_expires_at BIGINT,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      role TEXT NOT NULL DEFAULT 'owner',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT,
      type TEXT,
      code TEXT,
      saved_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS project_data (
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      PRIMARY KEY (org_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS publishes (
      slug TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      custom_domain TEXT UNIQUE,
      html TEXT,
      type TEXT,
      created_at BIGINT,
      updated_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS public_data (
      slug TEXT PRIMARY KEY REFERENCES publishes(slug) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS plans (
      name TEXT PRIMARY KEY,
      max_workspaces INT NOT NULL,
      max_pages_per_workspace INT NOT NULL,
      max_members_per_workspace INT NOT NULL,
      max_ai_generations INT NOT NULL,
      included_tokens BIGINT NOT NULL DEFAULT 50000
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at BIGINT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
  `);

  // Migrasi ringan buat database yang sudah ada duluan (sebelum ada workspace/token dll)
  // PENTING: ini harus jalan SEBELUM isi data paket, soalnya tabel `plans` versi lama
  // belum punya kolom included_tokens.
  await pool.query(`ALTER TABLE snippets ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;`);
  await pool.query(`ALTER TABLE publishes ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ai_generations_used INT NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ai_input_tokens_used BIGINT NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ai_output_tokens_used BIGINT NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS included_tokens BIGINT NOT NULL DEFAULT 50000;`);
  // Kalau tabel plans udah ada dari sebelum fitur token ini dibikin, paket 'pro' bakal
  // ke-isi nilai default (50000) juga — padahal harusnya nyaris tanpa batas. Perbaiki sekali di sini.
  await pool.query(`UPDATE plans SET included_tokens = 999999999 WHERE name = 'pro' AND included_tokens = 50000;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS token_balance BIGINT;`);
  await pool.query(`ALTER TABLE snippets ADD COLUMN IF NOT EXISTS last_published_slug TEXT;`);
  await pool.query(`ALTER TABLE snippets ADD COLUMN IF NOT EXISTS last_published_domain TEXT;`);

  // Isi data awal buat paket, kalau belum ada (baru jalan SETELAH kolomnya lengkap)
  await pool.query(`
    INSERT INTO plans (name, max_workspaces, max_pages_per_workspace, max_members_per_workspace, max_ai_generations, included_tokens)
    VALUES
      ('free', 3, 3, 2, 3, 50000),
      ('pro', 999999, 999999, 999999, 999999, 999999999)
    ON CONFLICT (name) DO NOTHING;
  `);

  // Tim yang baru dibuat, saldo tokennya diisi awal sesuai paketnya (kalau belum pernah diisi)
  await pool.query(`
    UPDATE orgs SET token_balance = (SELECT included_tokens FROM plans WHERE name = orgs.plan)
    WHERE token_balance IS NULL;
  `);
  await pool.query(`UPDATE orgs SET token_balance = 50000 WHERE token_balance IS NULL;`);
}

module.exports = { pool, migrate };
