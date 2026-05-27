// AI — LBR (League-Based Research)
// MISSION: Find PRIMARY reasons WHY results happen — not just statistics, but WHY.
// Analyzes current AND previous season. Generates Factors + Statistics signals.

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM = `Your learning mission: Find PRIMARY (inclusive) reasons why results happen — not just statistics, but WHY. Analyze current AND previous season. Generate signals classified as Factors (motivation, tactics, context) or Statistics (numbers, history, form). Never just report numbers — always explain WHY.

SIGNAL TYPES:
• Factors — qualitative WHY reasons (motivation, tactics, team dynamics, context)
  Example: "High press + high defensive line creates transition spaces → both teams score in open exchanges"
• Statistics — measurable thresholds explained by WHY
  Example: "BTTS ≥ 68% when both sides top-6 — because both play expansive football and neither parks the bus"

SIGNAL QUALITY — assign based on strength of evidence:
• Ideal   — pattern confirmed 2+ seasons, >70% hit rate, clear WHY mechanism
• Good    — solid pattern 55–70%, consistent evidence, understood WHY
• Weak    — emerging 40–55%, limited data, WHY hypothesis plausible
• Dormant — <40% hit rate or insufficient data to establish WHY

CRITICAL RULE — Never just report numbers, always explain WHY:
  BAD:  "Napoli average 2.1 goals per game"
  GOOD: "Napoli's high defensive line and aggressive press force opponents into rushed clearances, creating second-ball situations that generate 3–4 high-quality chances per game for both sides"

SEARCH STRATEGY:
• Do 4–7 targeted searches: tactical analysis, recent form, H2H history, league statistics
• Cover BOTH current season (2024/25) AND previous season (2023/24)
• Dig into: title race dynamics, relegation battles, European qualification pressure
• Never search the same topic twice

OUTPUT — when you have enough WHY-focused evidence, output ONLY this JSON (no prose, no markdown):

{
  "btts": {
    "factors": [{"name": "specific WHY factor", "level": "Ideal|Good|Weak|Dormant", "note": "WHY explanation with real evidence"}],
    "stats":   [{"name": "specific measurable threshold", "level": "Ideal|Good|Weak|Dormant", "note": "WHY this stat predicts BTTS"}]
  },
  "draw": {
    "factors": [{"name": "specific WHY factor for draws", "level": "Ideal|Good|Weak|Dormant", "note": "WHY explanation"}],
    "stats":   [{"name": "specific measurable threshold", "level": "Ideal|Good|Weak|Dormant", "note": "WHY this predicts draws"}]
  }
}

Provide 4–7 signals per category. Raw JSON only.`;


// ─── Main entry point ──────────────────────────────────────────────────────
async function runLBR(country, leagueName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });

  const userMessage =
    `Research "${leagueName}" (${country}) — current season (2024/25) AND previous season (2023/24).\n\n` +
    `Use web search to find WHY patterns exist — tactical, motivational, contextual.\n` +
    `Search freely across the entire internet. No restricted sources.\n\n` +
    `After 4–7 searches (covering both seasons), output the JSON signal object.\n` +
    `Focus on WHY, not just WHAT. Explain the mechanism behind every signal.`;

  const messages = [{ role: 'user', content: userMessage }];
  let lastText = '';

  for (let i = 0; i < 10; i++) {
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

    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason === 'end_turn') {
      const text = resp.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      lastText = text || lastText;

      const result = parseLBR(text);
      if (result) return result;

      if (i < 8) {
        messages.push({
          role:    'user',
          content: 'Output ONLY the JSON now. No prose, no markdown. Start with { and end with }.',
        });
      }
      continue;
    }

    if (resp.stop_reason === 'tool_use') {
      const acks = resp.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
      if (acks.length) messages.push({ role: 'user', content: acks });
      continue;
    }

    break;
  }

  return parseLBR(lastText);
}


// ─── Robust JSON extraction ────────────────────────────────────────────────
// Depth-tracks to find ALL balanced {...} blocks, tries largest-first.
function parseLBR(text) {
  if (!text) return null;

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
