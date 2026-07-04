// Cara pakai di server (folder project ini):
//   node create-user.js emailkamu@gmail.com passwordbaru "Nama Tim"
//
// Kalau email itu sudah pernah kepakai, password-nya akan DIGANTI.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool, migrate } = require('./lib/db');

function genId(prefix) {
  return prefix + '-' + crypto.randomBytes(8).toString('hex');
}

async function main() {
  const [, , email, password, orgName] = process.argv;
  if (!email || !password) {
    console.log('Cara pakai: node create-user.js email@kamu.com passwordnya "Nama Tim"');
    process.exit(1);
  }

  await migrate();
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (existing.rows[0]) {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, existing.rows[0].id]);
    console.log('Password buat "' + email + '" sudah diganti. Sekarang bisa login pakai password baru itu.');
    await pool.end();
    return;
  }

  const orgId = genId('org');
  await pool.query(
    'INSERT INTO orgs (id, name, plan, subscription_expires_at, created_at) VALUES ($1,$2,$3,$4,$5)',
    [orgId, orgName || 'Tim Baru', 'free', null, Date.now()]
  );
  const userId = genId('user');
  await pool.query(
    'INSERT INTO users (id, email, password_hash, org_id, role, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, email, passwordHash, orgId, 'owner', Date.now()]
  );

  console.log('Akun baru berhasil dibuat!');
  console.log('Email   : ' + email);
  console.log('Password: (yang tadi kamu ketik)');
  console.log('Tim     : ' + (orgName || 'Tim Baru'));
  await pool.end();
}

main().catch((e) => {
  console.error('Gagal:', e.message);
  process.exit(1);
});
