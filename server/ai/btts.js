// AI #1 — BTTS Analysis Skill
// Single match: analyze and return YES / NO / SKIP-B
// Multi match: select TOP 3 candidates with YES verdict
// Uses signal quality hierarchy: Ideal > Good > Weak > Dormant (quality over quantity)

const Anthropic = require('@anthropic-ai/sdk');

function buildSystemPrompt(signals) {
  const factors = signals.factors.map(f => `  [${f.level}] ${f.name}`).join('\n');
  const stats   = signals.stats.map(s => `  [${s.level}] ${s.name}`).join('\n');

  return `You are a BTTS (Both Teams To Score) football prediction expert.

SIGNAL QUALITY RULE — quality over quantity:
  • Ideal signal match  → very strong evidence
  • Good signal match   → solid evidence
  • 1 Ideal > 3 Weak. Do NOT recommend if only Weak/Dormant signals match.

Verdict thresholds:
  YES    — 1+ Ideal signal confirmed OR 2+ Good signals confirmed
  NO     — 1+ Ideal/Good signal clearly against BTTS (clean sheet expected)
  SKIP-B — conflicting evidence, or only Weak/Dormant signals, or insufficient info

Available signals for these leagues:
Factors:
${factors}

Statistics:
${stats}

Return ONLY valid JSON — no markdown, no extra text.`;
}

// ─── Single match analysis ─────────────────────────────────────────────────
async function analyzeBTTS(match, league, date, signals) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Analyze BTTS prediction for:
  Match : ${match}
  League: ${league}
  Date  : ${date}

Apply each available signal to this specific match. Consider team form, motivation context, and recent results you know about.

Return JSON:
{
  "verdict": "YES|NO|SKIP-B",
  "confidence": <0-100>,
  "matched_signals": [
    { "name": "signal name", "level": "Ideal|Good|Weak|Dormant", "note": "why it applies or doesn't" }
  ],
  "reasoning": "2-3 sentences focused on the decisive signal(s)"
}`;

  const resp = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    system: buildSystemPrompt(signals),
    messages: [{ role: 'user', content: prompt }]
  });

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return parseSingle(text);
}

// ─── Multi match — select TOP 3 ───────────────────────────────────────────
async function selectTopBTTS(candidates, signals, recentLosses = []) {
  if (!candidates.length) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const list = candidates
    .map((m, i) => `${i + 1}. ${m.match} | ${m.league} | ${m.date}`)
    .join('\n');

  // Build loss context — recent wrong BTTS picks so the Council learns from mistakes
  let lossContext = '';
  if (recentLosses.length > 0) {
    const lossLines = recentLosses
      .map(l => `  - ${l.match_name}${l.reasoning ? `: ${l.reasoning.slice(0, 120)}` : ''}`)
      .join('\n');
    lossContext = `\n\nCOUNCIL MEMORY — recent INCORRECT BTTS predictions (avoid repeating these mistakes):\n${lossLines}\n\nUse this to calibrate: if a similar context led to a wrong pick before, be more conservative.\n`;
  }

  const prompt = `From the following ${candidates.length} matches, select the TOP 3 BTTS picks
(those where at least 1 Ideal or 2 Good signals apply). Skip the rest (SKIP-B).

Candidate matches:
${list}
${lossContext}
For each selected match return full analysis. Maximum 3 results.

Return JSON array:
[
  {
    "match": "Team A vs Team B",
    "league": "League name",
    "date": "DD.MM.YYYY",
    "verdict": "YES",
    "confidence": <0-100>,
    "matched_signals": [
      { "name": "...", "level": "Ideal|Good|Weak|Dormant", "note": "..." }
    ],
    "reasoning": "2-3 sentences"
  }
]

Only include YES verdicts. If fewer than 3 qualify, return only those that do.`;

  const resp = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    system: buildSystemPrompt(signals),
    messages: [{ role: 'user', content: prompt }]
  });

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return parseArray(text);
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function parseSingle(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch { /* fall through */ }
  return { verdict: 'SKIP-B', confidence: 0, matched_signals: [], reasoning: 'Analysis failed — could not parse response.' };
}

function parseArray(text) {
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
  } catch { /* fall through */ }
  return [];
}

module.exports = { analyzeBTTS, selectTopBTTS };
