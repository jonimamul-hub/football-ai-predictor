// AI — Football Assistant
// Conversational Claude endpoint used when Ollama is unavailable or the
// user explicitly requests a Claude answer.

const Anthropic = require('@anthropic-ai/sdk');

async function runAssistant(messages, { context = '', signals = [] } = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const sigSummary = signals.length
    ? signals.map(s => `  [${s.type}/${s.category}/${s.level}] ${s.name}${s.note ? ` — ${s.note}` : ''}`).join('\n')
    : '  (none yet)';

  const system =
    `You are a football prediction assistant for a BTTS (Both Teams to Score) and Draw prediction system.\n\n` +
    `Current signals loaded in the system:\n${sigSummary}\n` +
    (context ? `\nAdditional criteria from user:\n${context}\n` : '') +
    `\nBe concise and specific. Focus on what is actionable for football prediction. ` +
    `When discussing signals, reference their quality level (Ideal/Good/Weak/Dormant) where relevant.`;

  const resp = await client.messages.create({
    model:      'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system,
    messages,
  });

  return resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

module.exports = { runAssistant };
