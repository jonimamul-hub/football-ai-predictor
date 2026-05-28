// Central API client.
// In dev:  Vite proxies /api → http://localhost:3001  (vite.config.js)
// In prod: requests go to same origin (Railway serves both)

const BASE = '';   // always relative — no VITE_API_URL needed

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const post = (path, body) => req(path, { method: 'POST', body: JSON.stringify(body) });
const del  = (path)       => req(path, { method: 'DELETE' });
const patch = (path, body) => req(path, { method: 'PATCH', body: JSON.stringify(body) });

export const api = {
  // ── Leagues ────────────────────────────────────────────────────────────
  getLeagues:    ()           => req('/api/leagues'),
  addLeague:     (data)       => post('/api/leagues', data),
  deleteLeague:  (id)         => del(`/api/leagues/${id}`),

  // ── Signals ────────────────────────────────────────────────────────────
  getSignals:    (type)       => req(`/api/signals?type=${type}`),
  addSignal:     (data)       => post('/api/signals', data),
  deleteSignal:  (id)         => del(`/api/signals/${id}`),

  // ── AI Search ──────────────────────────────────────────────────────────
  search:        (date, leagues, timezone) => post('/api/search', { date, leagues, timezone }),

  // ── AI Analysis (single match) ─────────────────────────────────────────
  analyzeBTTS:   (match, league, date) => post('/api/analyze/btts', { match, league, date }),
  analyzeDraw:   (match, league, date) => post('/api/analyze/draw', { match, league, date }),

  // ── AI Recommendations (multi-match) ───────────────────────────────────
  recommendBTTS: (matches)    => post('/api/recommend/btts', { matches }),
  recommendDraw: (matches)    => post('/api/recommend/draw', { matches }),

  // ── Patterns ───────────────────────────────────────────────────────────
  getPatterns:   (type)       => req(`/api/patterns?type=${type}`),
  addPattern:    (data)       => post('/api/patterns', data),
  updatePattern: (id, data)   => patch(`/api/patterns/${id}`, data),
  deletePattern: (id)         => del(`/api/patterns/${id}`),

  // ── Ollama Knowledge Base ──────────────────────────────────────────────
  getKnowledge:    (q)             => req(`/api/ollama/knowledge${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  addKnowledge:    (data)          => post('/api/ollama/knowledge', data),
  updateKnowledge: (id, data)      => patch(`/api/ollama/knowledge/${id}`, data),
  deleteKnowledge: (id)            => del(`/api/ollama/knowledge/${id}`),

  // ── AI Assistant ───────────────────────────────────────────────────────
  askAssistant:    (messages, ctx) => post('/api/assistant', { messages, context: ctx || '' }),

  // ── History ────────────────────────────────────────────────────────────
  getHistory:    (type)       => req(`/api/history?type=${type}`),
  addHistory:    (data)       => post('/api/history', data),
  updateHistory: (id, data)   => patch(`/api/history/${id}`, data),
  checkResult:   (id)         => post(`/api/history/${id}/check`, {}),
  deleteHistory: (id)         => del(`/api/history/${id}`),
};
