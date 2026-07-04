const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const files = {
  users: path.join(DATA_DIR, 'users.json'),
  orgs: path.join(DATA_DIR, 'orgs.json'),
  snippets: path.join(DATA_DIR, 'snippets.json'),
  store: path.join(DATA_DIR, 'store.json'),
  publishes: path.join(DATA_DIR, 'publishes.json'),
  publicData: path.join(DATA_DIR, 'publicData.json')
};

Object.values(files).forEach((f) => {
  if (!fs.existsSync(f)) fs.writeFileSync(f, '{}');
});

// Antrean tulis sederhana, biar gak tabrakan kalau ada beberapa request nulis bersamaan
const queues = {};
function readJSON(key) {
  try { return JSON.parse(fs.readFileSync(files[key], 'utf8')); } catch (e) { return {}; }
}
function writeJSON(key, data) {
  queues[key] = (queues[key] || Promise.resolve()).then(() => {
    fs.writeFileSync(files[key], JSON.stringify(data, null, 2));
  });
  return queues[key];
}

module.exports = { readJSON, writeJSON, files };
