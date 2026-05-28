// Ollama Agent — browser-side connector to local Ollama instance.
//
// Ollama runs on the user's machine at localhost:11434.
// It is only reachable when the browser itself is served from localhost
// (local dev / local Railway clone).  When the app is accessed from the
// Railway production URL the browser origin is railway.app, which Ollama's
// CORS policy blocks — so we detect this and skip all Ollama calls.
//
// To use Ollama locally, start it with the correct origin allowed:
//   OLLAMA_ORIGINS=http://localhost:5173 ollama serve   (Vite dev)
//   OLLAMA_ORIGINS=http://localhost:3001 ollama serve   (Node dev)
// Or allow all origins during local testing:
//   OLLAMA_ORIGINS=* ollama serve

const OLLAMA_BASE   = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';
const TIMEOUT_MS    = 60_000;

// Returns true only when the browser is itself running on localhost.
// On the Railway production domain this always returns false.
function isRunningLocally() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
}

// ─── Availability check ────────────────────────────────────────────────────
// reason: 'online' | 'offline' | 'remote'
//   remote  — browser origin is not localhost; Ollama is unreachable by design
//   offline — localhost origin but Ollama process is not running
export async function checkOllamaAvailable() {
  if (!isRunningLocally()) {
    return { available: false, models: [], reason: 'remote' };
  }
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { available: false, models: [], reason: 'offline' };
    const data   = await res.json();
    const models = (data.models || []).map(m => m.name);
    return { available: true, models, reason: 'online' };
  } catch {
    return { available: false, models: [], reason: 'offline' };
  }
}

// ─── Ask Ollama ────────────────────────────────────────────────────────────
// messages: [{role: 'user'|'assistant', content: string}]
// context:  knowledge base text to inject as system context
// model:    which local model to use (defaults to first available)
export async function askOllama(messages, { model = DEFAULT_MODEL, context = '' } = {}) {
  if (!isRunningLocally()) {
    throw new Error('Ollama is only available when the app is accessed from localhost');
  }
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
