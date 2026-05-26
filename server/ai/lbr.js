// AI — LBR (League-Based Research)
// Searches the web freely for real league data, then outputs BTTS + Draw signals as JSON.
// Target: complete in < 2 minutes.  Uses claude-sonnet-4-5 (faster than opus for this task).

const Anthropic = require('@anthropic-ai/sdk');

// ─── Focused system prompt ─────────────────────────────────────────────────
// Kept deliberately short so Claude spends tokens on research, not prompt parsing.
const SYSTEM = `You are a football analyst. Research a league using web search, then output prediction signals as JSON.

SEARCH STRATEGY — be efficient:
• Do 3–5 targeted searches (BTTS rate, draw rate, goals per game, tactical style)
• Do NOT search the same topic twice
• After gathering data, output JSON immediately — do not narrate findings

SIGNAL TYPES:
• Factors — qualitative WHY reasons (e.g. "High press + high defensive line → gaps for both teams")
• Stats   — measurable thresholds (e.g. "BTTS ≥ 68% when both sides are top-6")

SIGNAL QUALITY:
• Ideal   — >70% hit rate, confirmed across multiple seasons
• Good    — 55-70%, solid pattern
• Weak    — 40-55%, emerging
• Dormant — <40% or insufficient data

CRITICAL OUTPUT RULE — when you have enough data, output ONLY this JSON and nothing else:

{
  "btts": {
    "factors": [{"name": "specific WHY factor", "level": "Ideal|Good|Weak|Dormant", "note": "evidence from real data"}],
    "stats":   [{"name": "specific measurable threshold", "level": "Ideal|Good|Weak|Dormant", "note": "evidence"}]
  },
  "draw": {
    "factors": [{"name": "specific WHY factor for draws", "level": "Ideal|Good|Weak|Dormant", "note": "evidence"}],
    "stats":   [{"name": "specific measurable threshold", "level": "Ideal|Good|Weak|Dormant", "note": "evidence"}]
  }
}

Provide 4–7 signals per category. Output raw JSON only — no markdown, no prose.`;


// ─── Main entry point ──────────────────────────────────────────────────────
async function runLBR(country, leagueName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });

  const userMessage =
    `Research "${leagueName}" (${country}) — 2024/25 and 2023/24 seasons.\n\n` +
    `Use web search to find real statistics and patterns. Search freely — no restricted sources.\n\n` +
    `After 3–5 searches output the JSON signal object. Do not exceed 5 searches.`;

  const messages = [{ role: 'user', content: userMessage }];
  let lastText = '';

  // Hard cap: 10 iterations.  Each web-search round-trip is ~20-40 s,
  // so worst case is 10 × 40 s = ~6 min.  Typically finishes in 3–4 iterations.
  for (let i = 0; i < 10; i++) {
    // Per-call timeout: 90 seconds.  Prevents a single stuck API call from hanging forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);

    let resp;
    try {
      resp = await client.beta.messages.create(
        {
          model:      'claude-sonnet-4-5',
          max_tokens: 4096,
          system:     SYSTEM,
          tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
          messages,
          betas:      ['web-search-2025-03-05'],
        },
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timer);
    }

    // Accumulate assistant turn
    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason === 'end_turn') {
      const text = resp.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      lastText = text || lastText;

      const result = parseLBR(text);
      if (result) return result;

      // Got prose but no JSON — ask once more for JSON output
      if (i < 8) {
        messages.push({
          role:    'user',
          content: 'Output ONLY the JSON now. No prose, no markdown. Start with { and end with }.',
        });
      }
      continue;
    }

    if (resp.stop_reason === 'tool_use') {
      // web_search_20250305: Anthropic runs the search server-side.
      // We acknowledge every tool_use block with an empty result to keep the loop going.
      const acks = resp.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
      if (acks.length) {
        messages.push({ role: 'user', content: acks });
      }
      continue;
    }

    // Unexpected stop reason
    break;
  }

  // Last-ditch: try to parse whatever text Claude last produced
  return parseLBR(lastText);
}


// ─── Robust JSON extraction ────────────────────────────────────────────────
// Depth-tracks to find ALL balanced {...} blocks in the text, then tries them
// largest-first.  Avoids the greedy-regex bug that matched from first { to last }
// and broke whenever Claude wrote prose containing braces before the JSON block.
function parseLBR(text) {
  if (!text) return null;

  // Strip markdown fences if present
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  const candidates = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  // Largest candidates first — the full signal object is the biggest block
  candidates.sort((a, b) => b.length - a.length);

  for (const raw of candidates) {
    try {
      const data = JSON.parse(raw);
      if (data.btts && data.draw) return normalise(data);
    } catch { /* try next */ }
  }
  return null;
}


function normalise(data) {
  for (const outcome of ['btts', 'draw']) {
    if (!data[outcome] || typeof data[outcome] !== 'object') {
      data[outcome] = { factors: [], stats: [] };
    }
    for (const cat of ['factors', 'stats']) {
      if (!Array.isArray(data[outcome][cat])) data[outcome][cat] = [];
      data[outcome][cat] = data[outcome][cat]
        .map(s => ({
          name:  String(s.name  || '').trim(),
          level: validateLevel(s.level),
          note:  String(s.note  || s.evidence || s.evidence_note || '').trim(),
        }))
        .filter(s => s.name.length > 0);
    }
  }
  return data;
}


function validateLevel(level) {
  const VALID = ['Ideal', 'Good', 'Weak', 'Dormant'];
  if (VALID.includes(level)) return level;
  if (typeof level === 'string') {
    const l = level.toLowerCase();
    if (l.includes('ideal'))                        return 'Ideal';
    if (l.includes('good') || l.includes('solid'))  return 'Good';
    if (l.includes('weak') || l.includes('some'))   return 'Weak';
  }
  return 'Dormant';
}


module.exports = { runLBR };
