// Cara pakai di VPS (di dalam folder project ini):
//   node create-user.js emailkamu@gmail.com passwordbaru "Nama Tim"
//
// Kalau email itu sudah pernah kepakai, password-nya akan DIGANTI
// pakai password baru yang kamu masukkan di sini.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { readJSON, writeJSON } = require('./lib/jsonStore');

async function main() {
  const [, , email, password, orgName] = process.argv;

  if (!email || !password) {
    console.log('Cara pakai: node create-user.js email@kamu.com passwordnya "Nama Tim"');
    process.exit(1);
  }

  const users = readJSON('users');
  const orgs = readJSON('orgs');
  const passwordHash = await bcrypt.hash(password, 10);

  let user = Object.values(users).find((u) => u.email.toLowerCase() === email.toLowerCase());

  if (user) {
    // Email sudah ada -> ganti passwordnya aja
    user.passwordHash = passwordHash;
    users[user.id] = user;
    await writeJSON('users', users);
    console.log('Password buat "' + email + '" sudah diganti. Sekarang bisa login pakai password baru itu.');
    return;
  }

  // Email belum ada -> bikin tim + user baru
  const orgId = 'org-' + crypto.randomBytes(8).toString('hex');
  orgs[orgId] = {
    id: orgId,
    name: orgName || 'Tim Baru',
    plan: 'free',
    subscriptionExpiresAt: null,
    createdAt: Date.now()
  };
  await writeJSON('orgs', orgs);

  const userId = 'user-' + crypto.randomBytes(8).toString('hex');
  users[userId] = { id: userId, email, passwordHash, orgId, role: 'owner', createdAt: Date.now() };
  await writeJSON('users', users);

  console.log('Akun baru berhasil dibuat!');
  console.log('Email   : ' + email);
  console.log('Password: (yang tadi kamu ketik)');
  console.log('Tim     : ' + (orgName || 'Tim Baru'));
}

main().catch((e) => {
  console.error('Gagal:', e.message);
  process.exit(1);
});
