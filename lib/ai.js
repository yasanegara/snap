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

// Baca stream SSE generik (dipakai baik Anthropic maupun Sumopod, formatnya mirip: "data: {...}\n\n")
async function readSSEStream(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop(); // sisa baris yang belum lengkap, simpan buat putaran berikutnya

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        onEvent(json);
      } catch (e) { /* baris gak valid, lewatin aja */ }
    }
  }
}

// Versi streaming: onProgress(charCountSoFar) dipanggil tiap ada teks baru dari AI,
// jadi progress bar di frontend bisa ngikutin beneran, bukan animasi kira-kira.
async function generateHtmlFromPromptStream(promptText, onProgress) {
  const config = await getAiConfig();
  if (!config.apiKey) {
    const providerLabel = config.provider === 'sumopod' ? 'Sumopod' : 'Anthropic';
    throw new Error('API key ' + providerLabel + ' belum di-set. Atur dulu di Panel Superadmin (Pengaturan AI).');
  }

  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  let truncated = false;

  if (config.provider === 'sumopod') {
    const res = await fetch('https://ai.sumopod.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
      body: JSON.stringify({ model: config.model, max_tokens: 32000, stream: true, messages: [{ role: 'user', content: promptText }] })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('Sumopod menolak permintaan (HTTP ' + res.status + '): ' + errText.slice(0, 300));
    }
    await readSSEStream(res, (json) => {
      const choice = json.choices && json.choices[0];
      if (choice && choice.delta && choice.delta.content) {
        text += choice.delta.content;
        onProgress(text.length);
      }
      if (choice && choice.finish_reason === 'length') truncated = true;
      if (json.usage) {
        usage = {
          inputTokens: json.usage.prompt_tokens || usage.inputTokens,
          outputTokens: json.usage.completion_tokens || usage.outputTokens
        };
      }
    });
  } else {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.model, max_tokens: 32000, stream: true, messages: [{ role: 'user', content: promptText }] })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('Anthropic menolak permintaan (HTTP ' + res.status + '): ' + errText.slice(0, 300));
    }
    await readSSEStream(res, (json) => {
      if (json.type === 'content_block_delta' && json.delta && json.delta.text) {
        text += json.delta.text;
        onProgress(text.length);
      }
      if (json.type === 'message_delta' && json.delta && json.delta.stop_reason === 'max_tokens') truncated = true;
      if (json.type === 'message_delta' && json.usage) {
        usage.outputTokens = json.usage.output_tokens || usage.outputTokens;
      }
      if (json.type === 'message_start' && json.message && json.message.usage) {
        usage.inputTokens = json.message.usage.input_tokens || usage.inputTokens;
      }
    });
  }

  if (!text.trim()) {
    throw new Error('AI tidak mengembalikan konten apa pun.');
  }
  if (truncated) {
    throw new Error(
      'Hasil AI kepotong karena kepanjangan (kehabisan batas token). ' +
      'Coba: (1) kurangi jumlah section/fitur yang dipilih, atau (2) generate ulang, ' +
      'atau (3) ganti ke model lain yang mendukung output lebih panjang di Panel Superadmin.'
    );
  }

  return { text, usage: { ...usage, model: config.model, provider: config.provider } };
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
      max_tokens: 32000,
      messages: [{ role: 'user', content: promptText }]
    })
  });

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    // Anthropic (atau proxy di depannya) lagi ngadat, balikin teks biasa bukan JSON
    throw new Error(
      'Anthropic lagi ada gangguan (respons yang dikembalikan bukan format yang benar). ' +
      'Coba lagi beberapa saat lagi. Detail mentah: ' + rawText.slice(0, 200)
    );
  }

  if (!res.ok) {
    const errMsg = (data && data.error && (data.error.message || data.error)) || rawText;
    throw new Error('Anthropic menolak permintaan (HTTP ' + res.status + '): ' + String(errMsg).slice(0, 300));
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const usage = {
    inputTokens: (data.usage && data.usage.input_tokens) || 0,
    outputTokens: (data.usage && data.usage.output_tokens) || 0
  };
  const truncated = data.stop_reason === 'max_tokens';
  return { text, usage, truncated };
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
      max_tokens: 32000,
      messages: [{ role: 'user', content: promptText }]
    })
  });

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    // Sumopod/model di baliknya (misal DeepSeek) lagi ngadat, balikin teks biasa bukan JSON
    throw new Error(
      'Sumopod/model AI lagi ada gangguan (respons yang dikembalikan bukan format yang benar, biasanya ini masalah sementara dari sisi mereka). ' +
      'Coba lagi beberapa saat lagi, atau ganti ke model lain. Detail mentah: ' + rawText.slice(0, 200)
    );
  }

  if (!res.ok) {
    const errMsg = (data && (data.error?.message || data.error || data.message)) || rawText;
    throw new Error('Sumopod menolak permintaan (HTTP ' + res.status + '): ' + String(errMsg).slice(0, 300));
  }

  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const usage = {
    inputTokens: (data.usage && data.usage.prompt_tokens) || 0,
    outputTokens: (data.usage && data.usage.completion_tokens) || 0
  };
  const truncated = !!(data.choices && data.choices[0] && data.choices[0].finish_reason === 'length');
  return { text, usage, truncated };
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

  if (result.truncated) {
    throw new Error(
      'Hasil AI kepotong karena kepanjangan (kehabisan batas token). ' +
      'Coba: (1) kurangi jumlah section/fitur yang dipilih, atau (2) generate ulang, ' +
      'atau (3) ganti ke model lain yang mendukung output lebih panjang di Panel Superadmin.'
    );
  }

  return {
    text: result.text,
    usage: { ...result.usage, model: config.model, provider: config.provider }
  };
}

// Ambil isi kode dari jawaban AI, buang penjelasan/pembungkus markdown kalau ada.
// Dibikin "kebal" karena tiap model AI (Claude, Minimax, dll) suka beda-beda gaya nulisnya.
function extractCode(text) {
  let t = text.trim();

  // Kasus 1: pembungkus lengkap (```html ... ```), longgar soal spasi/baris baru/huruf besar-kecil
  let fenced = t.match(/```[ \t]*(?:html|jsx|javascript|js)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/i);
  if (fenced && fenced[1].trim()) return fenced[1].trim();

  // Kasus 2: pembungkus kebuka tapi gak ketutup (kepotong karena limit token AI-nya),
  // ambil semua isi setelah baris pembuka ```
  const openMatch = t.match(/^```[ \t]*(?:html|jsx|javascript|js)?[ \t]*\r?\n([\s\S]*)$/i);
  if (openMatch && openMatch[1].trim()) return openMatch[1].trim();

  // Kasus 3: ada tulisan "```" di suatu tempat, tapi bukan di paling awal
  // (misal AI kasih kalimat pembuka dulu baru pagar kode). Cari pagar PERTAMA yang muncul.
  const anyFenceIdx = t.indexOf('```');
  if (anyFenceIdx !== -1) {
    const afterFence = t.slice(anyFenceIdx);
    const m = afterFence.match(/```[ \t]*(?:html|jsx|javascript|js)?[ \t]*\r?\n([\s\S]*?)(?:\r?\n?```|$)/i);
    if (m && m[1].trim()) return m[1].trim();
  }

  // Kasus 4: gak ada pagar kode sama sekali, tapi ada tag <!DOCTYPE atau <html di suatu tempat
  // (AI langsung nulis kode tanpa pembungkus). Potong dari situ.
  const docTypeIdx = t.search(/<!DOCTYPE/i);
  const htmlTagIdx = t.search(/<html[\s>]/i);
  const startIdx = docTypeIdx !== -1 ? docTypeIdx : htmlTagIdx;
  if (startIdx > 0) return t.slice(startIdx).trim();

  // Fallback terakhir: kembalikan apa adanya
  return t;
}

// Jaga-jaga tambahan: buang sisa pagar markdown yang mungkin masih nempel di awal/akhir
function stripStrayFences(code) {
  return code
    .replace(/^```[ \t]*(?:html|jsx|javascript|js)?[ \t]*\r?\n?/i, '')
    .replace(/\r?\n?```[ \t]*$/i, '')
    .trim();
}

function estimateCostUSD(model, inputTokens, outputTokens) {
  const rate = PRICING[model] || DEFAULT_PRICING;
  return (inputTokens / 1000000) * rate.input + (outputTokens / 1000000) * rate.output;
}

// Model-model Anthropic asli yang didukung (kalau provider = anthropic)
const ANTHROPIC_MODELS = Object.keys(PRICING);

module.exports = {
  generateHtmlFromPrompt,
  generateHtmlFromPromptStream,
  extractCode,
  stripStrayFences,
  getSetting,
  setSetting,
  getAiConfig,
  estimateCostUSD,
  PRICING,
  ANTHROPIC_MODELS
};
