const { pool } = require('./db');

// Harga per 1 juta token (dalam USD), buat estimasi biaya. Angka per Juli 2026.
// Ini cuma buat model Anthropic asli. Buat Sumopod, harganya beda-beda tiap model
// (mereka nge-reseller banyak provider), jadi kita pakai perkiraan kasar aja.
const PRICING = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 }
};
const DEFAULT_PRICING = { input: 2, output: 10 };

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

// Ambil pengaturan AI yang aktif sekarang (provider + model + key masing-masing provider)
async function getAiConfig() {
  const provider = (await getSetting('ai_provider', null)) || 'anthropic';

  if (provider === 'sumopod') {
    const model = (await getSetting('ai_model_sumopod', null)) || process.env.SUMOPOD_MODEL || 'claude-sonnet-4-6';
    const apiKey = (await getSetting('ai_api_key_sumopod', null)) || process.env.SUMOPOD_API_KEY || '';
    return { provider: 'sumopod', model, apiKey };
  }

  const model = (await getSetting('ai_model_anthropic', null)) || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const apiKey = (await getSetting('ai_api_key_anthropic', null)) || process.env.ANTHROPIC_API_KEY || '';
  return { provider: 'anthropic', model, apiKey };
}

async function callAnthropic(promptText, model, apiKey) {
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
    throw new Error('Anthropic menolak permintaan (HTTP ' + res.status + '): ' + errText.slice(0, 300));
  }

  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const usage = {
    inputTokens: (data.usage && data.usage.input_tokens) || 0,
    outputTokens: (data.usage && data.usage.output_tokens) || 0
  };
  return { text, usage };
}

// Sumopod itu "OpenAI-compatible", jadi format request/response-nya beda dari Anthropic asli
async function callSumopod(promptText, model, apiKey) {
  const res = await fetch('https://ai.sumopod.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      messages: [{ role: 'user', content: promptText }]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('Sumopod menolak permintaan (HTTP ' + res.status + '): ' + errText.slice(0, 300));
  }

  const data = await res.json();
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const usage = {
    inputTokens: (data.usage && data.usage.prompt_tokens) || 0,
    outputTokens: (data.usage && data.usage.completion_tokens) || 0
  };
  return { text, usage };
}

async function generateHtmlFromPrompt(promptText) {
  const config = await getAiConfig();

  if (!config.apiKey) {
    const providerLabel = config.provider === 'sumopod' ? 'Sumopod' : 'Anthropic';
    throw new Error('API key ' + providerLabel + ' belum di-set. Atur dulu di Panel Superadmin (Pengaturan AI).');
  }

  const result = config.provider === 'sumopod'
    ? await callSumopod(promptText, config.model, config.apiKey)
    : await callAnthropic(promptText, config.model, config.apiKey);

  if (!result.text.trim()) {
    throw new Error('AI tidak mengembalikan konten apa pun.');
  }

  return {
    text: result.text,
    usage: { ...result.usage, model: config.model, provider: config.provider }
  };
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

// Model-model Anthropic asli yang didukung (kalau provider = anthropic)
const ANTHROPIC_MODELS = Object.keys(PRICING);

module.exports = {
  generateHtmlFromPrompt,
  extractCode,
  getSetting,
  setSetting,
  getAiConfig,
  estimateCostUSD,
  PRICING,
  ANTHROPIC_MODELS
};
