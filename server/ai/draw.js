// AI #1 — Draw Analysis Skill
// Multi match: select TOP 2 draw candidates
// Verdict: DRAW / NO_DRAW / SKIP-B
// Same quality-over-quantity rule as BTTS

const Anthropic = require('@anthropic-ai/sdk');

function buildSystemPrompt(signals) {
  const factors = signals.factors.map(f => `  [${f.level}] ${f.name}`).join('\n');
  const stats   = signals.stats.map(s => `  [${s.level}] ${s.name}`).join('\n');

  return `You are a football Draw prediction expert.

SIGNAL QUALITY RULE — quality over quantity:
  • Ideal signal match  → very strong draw evidence
  • Good signal match   → solid draw evidence
  • 1 Ideal > 3 Weak. Do NOT recommend if only Weak/Dormant signals match.

Verdict thresholds:
  DRAW    — 1+ Ideal signal confirmed OR 2+ Good signals confirmed
  NO_DRAW — strong evidence against draw (clear favourite, high motivation asymmetry)
  SKIP-B  — conflicting evidence, or only Weak/Dormant signals, or insufficient info

Available signals for these leagues:
Factors:
${factors}

Statistics:
${stats}

Return ONLY valid JSON — no markdown, no extra text.`;
}

// ─── Multi match — select TOP 2 ───────────────────────────────────────────
async function selectTopDraw(candidates, signals, recentLosses = []) {
  if (!candidates.length) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const list = candidates
    .map((m, i) => `${i + 1}. ${m.match} | ${m.league} | ${m.date}`)
    .join('\n');

  // Build loss context — recent wrong Draw picks so the Council learns from mistakes
  let lossContext = '';
  if (recentLosses.length > 0) {
    const lossLines = recentLosses
      .map(l => `  - ${l.match_name}${l.reasoning ? `: ${l.reasoning.slice(0, 120)}` : ''}`)
      .join('\n');
    lossContext = `\n\nCOUNCIL MEMORY — recent INCORRECT Draw predictions (avoid repeating these mistakes):\n${lossLines}\n\nUse this to calibrate: if a similar context led to a wrong pick before, be more conservative.\n`;
  }

  const prompt = `From the following ${candidates.length} matches, select the TOP 2 DRAW picks
(those where at least 1 Ideal or 2 Good draw signals apply). Skip the rest (SKIP-B).

Candidate matches:
${list}
${lossContext}
For each selected match return full analysis. Maximum 2 results.

Return JSON array:
[
  {
    "match": "Team A vs Team B",
    "league": "League name",
    "date": "DD.MM.YYYY",
    "verdict": "DRAW",
    "confidence": <0-100>,
    "matched_signals": [
      { "name": "...", "level": "Ideal|Good|Weak|Dormant", "note": "..." }
    ],
    "reasoning": "2-3 sentences"
  }
]

Only include DRAW verdicts. If fewer than 2 qualify, return only those that do.`;

  const resp = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    system: buildSystemPrompt(signals),
    messages: [{ role: 'user', content: prompt }]
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
