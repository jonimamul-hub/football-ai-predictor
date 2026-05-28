// AI #1 — BTTS Council
// MISSION: Achieve repeatedly JUSTIFIED predictions for matches where BOTH TEAMS SCORE.
// Analysis mode: always analyze. Recommendation mode: select TOP 3 by judgment.
// Signal QUALITY beats quantity: 1 Ideal > 5 Dormant.

const Anthropic = require('@anthropic-ai/sdk');
const { parseSingle, parseArray } = require('./utils');

function buildSystemPrompt(signals) {
  const factors = signals.factors.map(f => `  [${f.level}] ${f.name}`).join('\n') || '  (none yet)';
  const stats   = signals.stats.map(s => `  [${s.level}] ${s.name}`).join('\n') || '  (none yet)';

  return `Your learning mission: Achieve repeatedly JUSTIFIED predictions where BOTH teams score.
- Use signals by QUALITY not quantity (1 Ideal > 5 Dormant)
- Create patterns from successful signal combinations
- Learn from every outcome: correct=strengthen signals, wrong=weaken signals, missed=discover new signals
- Verdict: YES/NO/SKIP-B (SKIP-B requires mandatory reason)
- Analysis mode: always analyze. Recommendation mode: select TOP 3 by judgment

SIGNAL QUALITY (Council-assigned — do not override):
  [Ideal]   → very strong evidence, heavily weighted in decisions
  [Good]    → solid evidence, well weighted
  [Weak]    → minor evidence, use cautiously, never recommend on Weak alone
  [Dormant] → unreliable or unconfirmed, ignore in recommendations

VERDICT RULES — mandatory reason for every verdict:
  YES    — 1+ Ideal signal CONFIRMED for this match, OR 2+ Good signals CONFIRMED
  NO     — 1+ Ideal/Good signal CLEARLY AGAINST BTTS (clean sheet form, defensive setup, low-scoring context)
  SKIP-B — conflicting evidence | only Weak/Dormant signals match | insufficient specific info

Available signals (WHY factors and WHEN statistics):
Factors:
${factors}

Statistics:
${stats}

Return ONLY valid JSON — no markdown, no extra text.`;
}

// ─── Single match analysis (Analysis mode) ─────────────────────────────────
async function analyzeBTTS(match, league, date, signals) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `[ANALYSIS MODE] Always analyze — never skip.

Match : ${match}
League: ${league}
Date  : ${date}

Apply every available signal to this specific match. Consider both teams' current form, defensive records, tactical setup, and motivation context.

Return JSON:
{
  "verdict": "YES|NO|SKIP-B",
  "confidence": <0-100>,
  "matched_signals": [
    { "name": "signal name", "level": "Ideal|Good|Weak|Dormant", "note": "why it applies or contradicts for this match" }
  ],
  "reasoning": "2-3 sentences explaining the decisive factor(s) and why this verdict"
}`;

  const resp = await client.messages.create({
    model:      'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    system:     buildSystemPrompt(signals),
    messages:   [{ role: 'user', content: prompt }]
  });

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return parseSingle(text);
}

// ─── Multi match — select TOP 3 (Recommendation mode) ─────────────────────
async function selectTopBTTS(candidates, signals, recentLosses = []) {
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
    lossContext = `\n\nCOUNCIL MEMORY — recent INCORRECT BTTS predictions (learn from these):\n${lossLines}\n\nCalibrate: if a similar context failed before, apply higher scrutiny.\n`;
  }

  const prompt = `[RECOMMENDATION MODE] Select TOP 3 BTTS picks by your judgment.

Candidate matches:
${list}
${lossContext}
For each pick: at least 1 Ideal OR 2+ Good signals must CLEARLY apply.
Skip everything else with SKIP-B (but still explain why in reasoning).
Maximum 3 results. If fewer than 3 qualify, return only those that do.

Return JSON array:
[
  {
    "match": "Team A vs Team B",
    "league": "League name",
    "date": "DD.MM.YYYY",
    "verdict": "YES",
    "confidence": <0-100>,
    "matched_signals": [
      { "name": "...", "level": "Ideal|Good|Weak|Dormant", "note": "why it applies to this specific match" }
    ],
    "reasoning": "2-3 sentences — decisive signals and WHY this match qualifies"
  }
]

Only YES verdicts in the array.`;

  const resp = await client.messages.create({
    model:      'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    system:     buildSystemPrompt(signals),
    messages:   [{ role: 'user', content: prompt }]
  });

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return parseArray(text);
}

module.exports = { analyzeBTTS, selectTopBTTS };
