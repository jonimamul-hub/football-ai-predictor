// AI #1 — Draw Council
// MISSION: Achieve repeatedly JUSTIFIED predictions for matches ending in a DRAW.
// Recommendation mode only: select TOP 2 by judgment.
// Signal QUALITY beats quantity: 1 Ideal > 5 Dormant.

const Anthropic = require('@anthropic-ai/sdk');

function buildSystemPrompt(signals) {
  const factors = signals.factors.map(f => `  [${f.level}] ${f.name}`).join('\n') || '  (none yet)';
  const stats   = signals.stats.map(s => `  [${s.level}] ${s.name}`).join('\n') || '  (none yet)';

  return `Your learning mission: Achieve repeatedly JUSTIFIED predictions — matches ending in a DRAW. Signal QUALITY beats quantity. Verdict: DRAW/NO_DRAW/SKIP-B (with mandatory reason). Recommendation mode only: select TOP 2 by your judgment.

SIGNAL QUALITY (Council-assigned — do not override):
  [Ideal]   → very strong draw evidence, heavily weighted
  [Good]    → solid draw evidence, well weighted
  [Weak]    → minor evidence, use cautiously, never recommend on Weak alone
  [Dormant] → unreliable or unconfirmed, ignore in recommendations

VERDICT RULES — mandatory reason for every verdict:
  DRAW    — 1+ Ideal signal CONFIRMED for this match, OR 2+ Good signals CONFIRMED
  NO_DRAW — strong evidence AGAINST draw: clear favourite, high motivation asymmetry, dominant recent form for one side
  SKIP-B  — conflicting evidence | only Weak/Dormant signals match | insufficient specific info

Available signals (WHY factors and WHEN statistics):
Factors:
${factors}

Statistics:
${stats}

Return ONLY valid JSON — no markdown, no extra text.`;
}

// ─── Multi match — select TOP 2 (Recommendation mode) ─────────────────────
async function selectTopDraw(candidates, signals, recentLosses = []) {
  if (!candidates.length) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const list = candidates
    .map((m, i) => `${i + 1}. ${m.match} | ${m.league} | ${m.date}`)
    .join('\n');

  // Council Memory — recent losses feed learning
  let lossContext = '';
  if (recentLosses.length > 0) {
    const lossLines = recentLosses
      .map(l => `  - ${l.match_name}${l.reasoning ? `: ${l.reasoning.slice(0, 150)}` : ''}`)
      .join('\n');
    lossContext = `\n\nCOUNCIL MEMORY — recent INCORRECT Draw predictions (learn from these):\n${lossLines}\n\nCalibrate: if a similar context failed before, apply higher scrutiny.\n`;
  }

  const prompt = `[RECOMMENDATION MODE] Select TOP 2 DRAW picks by your judgment.

Candidate matches:
${list}
${lossContext}
For each pick: at least 1 Ideal OR 2+ Good draw signals must CLEARLY apply.
Maximum 2 results. If fewer qualify, return only those that do.

Return JSON array:
[
  {
    "match": "Team A vs Team B",
    "league": "League name",
    "date": "DD.MM.YYYY",
    "verdict": "DRAW",
    "confidence": <0-100>,
    "matched_signals": [
      { "name": "...", "level": "Ideal|Good|Weak|Dormant", "note": "why it applies to this specific match" }
    ],
    "reasoning": "2-3 sentences — decisive signals and WHY this match is a draw candidate"
  }
]

Only DRAW verdicts in the array.`;

  const resp = await client.messages.create({
    model:      'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    system:     buildSystemPrompt(signals),
    messages:   [{ role: 'user', content: prompt }]
  });

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return parseArray(text);
}

function parseArray(text) {
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
  } catch { /* fall through */ }
  return [];
}

module.exports = { selectTopDraw };
