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

const PROXY_BASE    = 'http://localhost:11435';   // proxy.js
const DIRECT_BASE   = 'http://localhost:11434';   // Ollama direct
const DEFAULT_MODEL = 'llama3.2';
const TIMEOUT_MS    = 60_000;

const LOG = (...a) => console.log('[ollama-agent]', ...a);

// ─── Internal: ping proxy /health ─────────────────────────────────────────
async function pingProxyHealth() {
  const url = `${PROXY_BASE}/health`;
  LOG(`ping proxy health → ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    LOG(`  proxy /health → HTTP ${res.status}`);
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    LOG(`  proxy /health body:`, body);
    return true;
  } catch (err) {
    LOG(`  proxy /health failed: ${err.name}: ${err.message}`);
    return false;
  }
}

// ─── Internal: fetch model list from a base URL ───────────────────────────
async function pingOllamaTags(base) {
  const url = `${base}/api/tags`;
  LOG(`ping tags → ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    LOG(`  /api/tags → HTTP ${res.status}`);
    if (!res.ok) return null;
    const data   = await res.json();
    const models = (data.models || []).map(m => m.name);
    LOG(`  models found: [${models.join(', ')}]`);
    return { base, models };
  } catch (err) {
    LOG(`  /api/tags failed: ${err.name}: ${err.message}`);
    return null;
  }
}

// ─── Availability check ────────────────────────────────────────────────────
// Returns:
//   { available: true,  models: [...], base: '...', via: 'proxy'|'direct' }
//   { available: false, models: [],    base: null,   via: null }
export async function checkOllamaAvailable() {
  LOG('--- checkOllamaAvailable ---');
  LOG(`page origin: ${window.location.origin}`);

  // 1 — Try proxy (proxy.js must be running: node proxy.js)
  const proxyUp = await pingProxyHealth();
  if (proxyUp) {
    const result = await pingOllamaTags(PROXY_BASE);
    if (result) {
      LOG(`✅ using proxy at ${PROXY_BASE} (via proxy)`);
      return { available: true, models: result.models, base: PROXY_BASE, via: 'proxy' };
    }
    LOG('⚠ proxy is up but Ollama behind it is not responding');
    return { available: false, models: [], base: null, via: null };
  }

  // 2 — Try direct Ollama (works in local dev with OLLAMA_ORIGINS set)
  const result = await pingOllamaTags(DIRECT_BASE);
  if (result) {
    LOG(`✅ using direct Ollama at ${DIRECT_BASE} (via direct)`);
    return { available: true, models: result.models, base: DIRECT_BASE, via: 'direct' };
  }

  LOG('❌ neither proxy nor direct Ollama reachable — Claude fallback will be used');
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

  const chatUrl = `${base}/api/chat`;
  LOG(`askOllama → POST ${chatUrl} (model: ${model})`);

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(chatUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model, messages: fullMessages, stream: false }),
      signal:  controller.signal,
    });
    LOG(`  /api/chat → HTTP ${res.status}`);
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    LOG(`  reply received (${(data.message?.content || '').length} chars)`);
    return {
      text:  data.message?.content || '',
      model: data.model || model,
    };
  } catch (err) {
    LOG(`  /api/chat failed: ${err.name}: ${err.message}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
