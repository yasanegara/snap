const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  // Railway (dan kebanyakan Postgres hosting) butuh SSL, tapi sertifikatnya
  // gak perlu diverifikasi ketat buat kebutuhan kita.
  ssl: connectionString ? { rejectUnauthorized: false } : false
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

    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
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
}

module.exports = { pool, migrate };
