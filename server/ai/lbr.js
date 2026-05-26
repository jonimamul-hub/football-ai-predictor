// AI — LBR (League-Based Research)
// Uses web_search_20250305 to freely research a league online,
// then generates WHY-based BTTS and Draw prediction signals.

const Anthropic = require('@anthropic-ai/sdk');

// Keep the system prompt focused and concrete — complex prompts cause Claude
// to over-think and produce prose instead of JSON.
const SYSTEM = `You are a football data analyst. Research a football league using web search, then output prediction signals as JSON.

After researching, identify WHY certain outcomes happen in this specific league:

BTTS signals — WHY do both teams score (or not)?
  Examples of good factors: high defensive line + press creates gaps, both keepers leaked heavily, high motivation context, open H2H history
  Examples of good stats: BTTS rate ≥ 65% when top-6 meet, avg goals ≥ 2.8/game in top-half clashes

Draw signals — WHY does neither team win?
  Examples of good factors: tactical symmetry, away team content with a point, derby/local rivalry mental block, mid-table stasis
  Examples of good stats: draw rate ≥ 30% when teams are within 3 places, draw rate doubles in final 10 matches when both safe

Signal quality levels:
  Ideal   — >70% confirmed, seen across both seasons
  Good    — 55-70%, solid pattern
  Weak    — 40-55%, emerging pattern
  Dormant — <40% or not enough data

CRITICAL: Output ONLY the JSON below — no prose, no markdown fences, no explanation.

{
  "btts": {
    "factors": [
      {"name": "specific WHY factor", "level": "Ideal|Good|Weak|Dormant", "note": "one-sentence evidence from real data"}
    ],
    "stats": [
      {"name": "specific measurable threshold", "level": "Ideal|Good|Weak|Dormant", "note": "one-sentence evidence"}
    ]
  },
  "draw": {
    "factors": [
      {"name": "specific WHY factor for draws", "level": "Ideal|Good|Weak|Dormant", "note": "one-sentence evidence"}
    ],
    "stats": [
      {"name": "specific measurable threshold for draws", "level": "Ideal|Good|Weak|Dormant", "note": "one-sentence evidence"}
    ]
  }
}`;


async function runLBR(country, leagueName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });

  // Let Claude decide what to search — no prescribed queries, no hardcoded sources
  const userMessage =
    `Research the "${leagueName}" league in ${country} for the 2024/25 and 2023/24 seasons.\n\n` +
    `Use web search to freely find information from any online source — statistics sites, football analytics, ` +
    `match reports, tactical blogs, or anything relevant. Search as many times as needed.\n\n` +
    `Focus on discovering:\n` +
    `- Goals per game, BTTS rates, clean sheet rates\n` +
    `- Draw frequencies and the contexts that produce them\n` +
    `- Tactical styles of the top/bottom clubs\n` +
    `- Any notable patterns that explain WHY outcomes happen\n\n` +
    `When you have enough information, output the JSON signals. 5–8 signals per category.`;

  const messages = [{ role: 'user', content: userMessage }];
  let lastText = '';

  for (let i = 0; i < 25; i++) {
    const resp = await client.beta.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 8000,
      system:     SYSTEM,
      tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
      betas:      ['web-search-2025-03-05'],
    });

    // Always accumulate the full assistant turn
    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason === 'end_turn') {
      const text = resp.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      lastText = text || lastText;

      const result = parseLBR(text);
      if (result) return result;

      // Got prose but no JSON — nudge once more
      if (i < 22) {
        messages.push({
          role: 'user',
          content: 'Output ONLY the JSON now. No prose, no markdown fences. Start with { and end with }.'
        });
      }
      continue;
    }

    if (resp.stop_reason === 'tool_use') {
      // web_search_20250305: Anthropic runs the search server-side.
      // We acknowledge every tool_use block; the results are injected automatically.
      const acks = resp.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
      if (acks.length > 0) {
        messages.push({ role: 'user', content: acks });
      }
      continue;
    }

    // Unexpected stop reason — bail
    break;
  }

  // Last-ditch: try to parse whatever Claude last produced
  return parseLBR(lastText);
}


// Robust JSON extraction — depth-tracks to find all top-level objects,
// tries them largest-first, skips bad candidates gracefully.
function parseLBR(text) {
  if (!text) return null;

  // First: strip markdown fences if present
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  // Depth-track to collect all balanced { ... } blocks
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

  // Try largest to smallest — the full signal object will be the biggest block
  candidates.sort((a, b) => b.length - a.length);

  for (const raw of candidates) {
    try {
      const data = JSON.parse(raw);
      if (data.btts && data.draw) return normaliseSignals(data);
    } catch {
      // malformed JSON — try next candidate
    }
  }

  return null;
}


function normaliseSignals(data) {
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
