const { pool } = require('./db');

// Harga per 1 juta token (dalam USD), buat estimasi biaya. Angka per Juli 2026.
const PRICING = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 }
};
const DEFAULT_PRICING = { input: 2, output: 10 }; // fallback kalau model gak dikenal (dianggap kayak Sonnet 5)

async function getSetting(key, fallback) {
  try {
    const r = await pool.query('SELECT value FROM platform_settings WHERE key = $1', [key]);
    return r.rows[0] ? r.rows[0].value : fallback;
  } catch (e) {
    return fallback;
  }
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO platform_settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

async function getAiConfig() {
  const model = (await getSetting('ai_model', null)) || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const apiKey = (await getSetting('ai_api_key', null)) || process.env.ANTHROPIC_API_KEY || '';
  return { model, apiKey };
}

async function generateHtmlFromPrompt(promptText) {
  const { model, apiKey } = await getAiConfig();

  if (!apiKey) {
    throw new Error('API key AI belum di-set. Atur dulu di Panel Superadmin (Pengaturan AI) atau env var ANTHROPIC_API_KEY.');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      messages: [{ role: 'user', content: promptText }]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('AI menolak permintaan (HTTP ' + res.status + '): ' + errText.slice(0, 300));
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  if (!text.trim()) {
    throw new Error('AI tidak mengembalikan konten apa pun.');
  }

  const usage = {
    inputTokens: (data.usage && data.usage.input_tokens) || 0,
    outputTokens: (data.usage && data.usage.output_tokens) || 0,
    model
  };

  return { text, usage };
}

// Ambil isi kode dari jawaban AI, buang penjelasan/pembungkus markdown kalau ada
function extractCode(text) {
  const fenced = text.match(/```(?:html|jsx|javascript)?\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function estimateCostUSD(model, inputTokens, outputTokens) {
  const rate = PRICING[model] || DEFAULT_PRICING;
  return (inputTokens / 1000000) * rate.input + (outputTokens / 1000000) * rate.output;
}

module.exports = {
  generateHtmlFromPrompt,
  extractCode,
  getSetting,
  setSetting,
  getAiConfig,
  estimateCostUSD,
  PRICING
};
