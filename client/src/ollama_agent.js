// Ollama Agent — browser-side connector to local Ollama instance.
//
// Railway runs in the cloud and CANNOT reach localhost:11434.
// This file runs entirely in the browser, which CAN reach the user's local machine.
//
// IMPORTANT: Ollama must be started with CORS enabled so the browser can call it:
//   OLLAMA_ORIGINS=* ollama serve
//
// On Windows with the Ollama desktop app, set the env var via:
//   setx OLLAMA_ORIGINS "*"  (then restart Ollama)

const OLLAMA_BASE  = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';
const TIMEOUT_MS    = 60_000;

// ─── Availability check ────────────────────────────────────────────────────
export async function checkOllamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { available: false, models: [] };
    const data   = await res.json();
    const models = (data.models || []).map(m => m.name);
    return { available: true, models };
  } catch {
    return { available: false, models: [] };
  }
}

// ─── Ask Ollama ────────────────────────────────────────────────────────────
// messages: [{role: 'user'|'assistant', content: string}]
// context:  knowledge base text to inject as system context
// model:    which local model to use (defaults to first available)
export async function askOllama(messages, { model = DEFAULT_MODEL, context = '' } = {}) {
  const systemContent = [
    'You are a football prediction assistant for a BTTS and Draw prediction system.',
    'Be concise and specific. Focus on what is actionable for football prediction.',
    context ? `\nUse this knowledge to inform your answer:\n${context}` : '',
  ].filter(Boolean).join('\n');

  const fullMessages = [
    { role: 'system',    content: systemContent },
    ...messages.filter(m => m.role === 'user' || m.role === 'assistant'),
  ];

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model, messages: fullMessages, stream: false }),
      signal:  controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return {
      text:  data.message?.content || '',
      model: data.model || model,
    };
  } finally {
    clearTimeout(timer);
  }
}
