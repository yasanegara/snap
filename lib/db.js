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
  `);

  // Migrasi ringan buat database yang sudah ada duluan (sebelum ada workspace)
  await pool.query(`ALTER TABLE snippets ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;`);
  await pool.query(`ALTER TABLE publishes ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;`);
}

module.exports = { pool, migrate };
