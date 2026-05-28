// Ollama Agent — browser-side connector.
//
// Two connection paths, tried in order:
//
//  1. PROXY  http://localhost:11435  (proxy.js running on user's machine)
//     Works from ANY origin — even the Railway production URL — because
//     the proxy adds the correct CORS headers for railway.app.
//     Start the proxy: node proxy.js
//
//  2. DIRECT http://localhost:11434  (Ollama itself)
//     Works when the page is served from localhost AND Ollama is started
//     with a matching OLLAMA_ORIGINS env var.
//
// If neither is reachable, Claude is used as fallback (server-side).

const PROXY_BASE   = 'http://localhost:11435';   // proxy.js
const DIRECT_BASE  = 'http://localhost:11434';   // Ollama direct
const DEFAULT_MODEL = 'llama3.2';
const TIMEOUT_MS    = 60_000;

// ─── Internal: ping one base URL ──────────────────────────────────────────
async function pingBase(base) {
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    // For the proxy, /health returns our own JSON.
    // For direct Ollama, /health isn't a standard endpoint — fall through to /api/tags.
    return base;
  } catch {
    return null;
  }
}

async function pingOllamaTags(base) {
  try {
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data   = await res.json();
    const models = (data.models || []).map(m => m.name);
    return { base, models };
  } catch {
    return null;
  }
}

// ─── Availability check ────────────────────────────────────────────────────
// Returns:
//   { available: true,  models: [...], base: '...', via: 'proxy'|'direct' }
//   { available: false, models: [],    base: null,   via: null }
export async function checkOllamaAvailable() {
  // 1 — Try proxy (/health is our own endpoint so it's reliable)
  const proxyHealth = await pingBase(PROXY_BASE);
  if (proxyHealth) {
    // Proxy is up — now get model list via /api/tags through the proxy
    const result = await pingOllamaTags(PROXY_BASE);
    if (result) {
      return { available: true, models: result.models, base: PROXY_BASE, via: 'proxy' };
    }
    // Proxy running but Ollama behind it is not — still report offline
    return { available: false, models: [], base: null, via: null };
  }

  // 2 — Try direct Ollama
  const result = await pingOllamaTags(DIRECT_BASE);
  if (result) {
    return { available: true, models: result.models, base: DIRECT_BASE, via: 'direct' };
  }

  return { available: false, models: [], base: null, via: null };
}

// ─── Ask Ollama ────────────────────────────────────────────────────────────
// base:     resolved base URL from checkOllamaAvailable (PROXY_BASE or DIRECT_BASE)
// messages: [{role: 'user'|'assistant', content: string}]
// context:  approved knowledge to inject as system context
// model:    which local model to use
export async function askOllama(messages, { base = PROXY_BASE, model = DEFAULT_MODEL, context = '' } = {}) {
  const systemContent = [
    'You are a football prediction assistant for a BTTS and Draw prediction system.',
    'Be concise and specific. Focus on what is actionable for football prediction.',
    context ? `\nUse this knowledge to inform your answer:\n${context}` : '',
  ].filter(Boolean).join('\n');

  const fullMessages = [
    { role: 'system', content: systemContent },
    ...messages.filter(m => m.role === 'user' || m.role === 'assistant'),
  ];

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/api/chat`, {
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
