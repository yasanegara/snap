const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

async function generateHtmlFromPrompt(promptText) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY belum di-set di server. Tambahkan dulu di pengaturan environment variable.');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
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

  return text;
}

// Ambil isi kode dari jawaban AI, buang penjelasan/pembungkus markdown kalau ada
function extractCode(text) {
  const fenced = text.match(/```(?:html|jsx|javascript)?\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

module.exports = { generateHtmlFromPrompt, extractCode, MODEL };
