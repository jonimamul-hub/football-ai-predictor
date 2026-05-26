// AI #2 — LBR Skill (League-Based Research)
// Analyzes a league's current + previous season to find BTTS/Draw patterns.
// Generates signals (Factors + Statistics) classified by quality level.
// Does NOT use web_search — relies on Claude's training knowledge.

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM = `You are a football analytics expert performing League-Based Research (LBR).

Your task: analyze a football league across its current and recent seasons to identify patterns
that predict BTTS (Both Teams To Score) and Draw outcomes.

Signal quality levels:
  Ideal   — very strong predictor, confirmed repeatedly (>70% correlation)
  Good    — solid predictor, works in most cases (50-70%)
  Weak    — some correlation but inconsistent (30-50%)
  Dormant — low correlation or insufficient data (<30%)

Focus on PRIMARY causes:
  • Motivational (relegation battle, title race, must-win, dead rubber)
  • Tactical (pressing, open play, defensive block style)
  • Statistical (BTTS rates, clean sheet rates, draw rates, H2H patterns)

Return ONLY valid JSON — no explanation, no markdown, no extra text.`;

async function runLBR(country, leagueName) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `League: "${leagueName}" (${country})

Analyse this league for BTTS and Draw prediction patterns based on the current and previous seasons.

Return JSON in exactly this structure:
{
  "btts": {
    "factors": [
      { "name": "Factor description (be specific to this league)", "level": "Ideal|Good|Weak|Dormant" }
    ],
    "stats": [
      { "name": "Statistical threshold (e.g. Last 5 BTTS rate >= 60%)", "level": "Ideal|Good|Weak|Dormant" }
    ]
  },
  "draw": {
    "factors": [
      { "name": "Factor description", "level": "Ideal|Good|Weak|Dormant" }
    ],
    "stats": [
      { "name": "Statistical threshold", "level": "Ideal|Good|Weak|Dormant" }
    ]
  }
}

Provide 4-7 signals per category. Be specific to ${leagueName}'s characteristics (style of play, typical motivation patterns, historical statistics).`;

  const resp = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = resp.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  return parseLBR(text);
}

function parseLBR(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const data = JSON.parse(m[0]);
    // Validate structure
    if (!data.btts || !data.draw) return null;
    return data;
  } catch {
    return null;
  }
}

module.exports = { runLBR };
