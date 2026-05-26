// AI #2 — LBR Skill (League-Based Research)
// Uses web_search_20250305 to find real season data, then generates
// deep WHY-based prediction signals for BTTS and Draw outcomes.

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM = `You are a world-class football scout and data analyst performing deep League-Based Research (LBR).

YOUR MISSION: analyze a specific football league across 2024/25 (current) and 2023/24 (previous) seasons.
Generate HIGH-QUALITY prediction signals explaining WHY certain outcomes happen in THIS league.

Use web search to gather REAL data before generating signals. Search for:
  - BTTS (both teams score) statistics and rates
  - Draw frequencies, patterns, and context
  - Tactical/style analysis for this league
  - Match reports showing WHY teams scored or didn't

SIGNAL TYPES:
  Factors   — qualitative causes (tactical style, motivation, rivalry, form context)
  Statistics — quantifiable thresholds ("BTTS rate ≥ 65% when both top-6 teams meet")

SIGNAL QUALITY:
  Ideal   — >70% hit rate, confirmed across multiple seasons
  Good    — 55–70% hit rate, solid track record
  Weak    — 40–55%, some correlation but needs more data
  Dormant — <40% or insufficient evidence

WHAT TO LOOK FOR:

BTTS=YES patterns — WHY do both teams score?
  • High defensive line + high press → gaps → both teams find space
  • Both keepers/defenders leaked goals that season
  • Specific motivation context: both NEED to win (chasing points, relegation, cups)
  • H2H history: these clubs historically play open games
  • League-wide culture: attacking football rewarded, compact defending rare

BTTS=NO patterns — WHY does one team keep a clean sheet?
  • Strong home keeper vs weak away strikers
  • Away team parks the bus with lead mindset
  • Dead rubber: neither team attacks with purpose
  • League low-scoring culture

DRAW patterns — WHY does neither team win?
  • Tactical symmetry: mirror formations cancel each other out
  • Away team content with point (narrow standings)
  • Derby / local rivalry: neither concedes ground mentally
  • Mid-table stasis: no pressure to win or avoid losing
  • Both managers defensive

Be SPECIFIC. Avoid generic statements like "both teams can score." Name real patterns from THIS league.

Return ONLY valid JSON. No markdown fences, no explanation outside the JSON.`;


async function runLBR(country, leagueName) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userPrompt = `Perform deep League-Based Research for: "${leagueName}" (${country})

Seasons: 2024/25 (current) + 2023/24 (previous)

STEP 1 — Research (use web search):
  Search 1: "${leagueName} ${country} BTTS statistics 2024 2025"
  Search 2: "${leagueName} draw rate analysis 2024 2025"
  Search 3: "${leagueName} 2023 2024 goals per game tactical analysis"

STEP 2 — Identify WHY patterns:
  For BTTS: When do BOTH teams score in this specific league? What causes it?
  For Draws: When does neither team win? What contexts produce draws here?

STEP 3 — Return signals. Use this EXACT JSON structure:
{
  "btts": {
    "factors": [
      {
        "name": "Specific WHY factor (not generic) — what causes BTTS in ${leagueName}",
        "level": "Ideal|Good|Weak|Dormant",
        "note": "One-sentence evidence from real season data"
      }
    ],
    "stats": [
      {
        "name": "Specific measurable threshold in ${leagueName}",
        "level": "Ideal|Good|Weak|Dormant",
        "note": "One-sentence evidence"
      }
    ]
  },
  "draw": {
    "factors": [
      {
        "name": "Specific WHY factor for draws in ${leagueName}",
        "level": "Ideal|Good|Weak|Dormant",
        "note": "One-sentence evidence"
      }
    ],
    "stats": [
      {
        "name": "Specific measurable threshold for draws in ${leagueName}",
        "level": "Ideal|Good|Weak|Dormant",
        "note": "One-sentence evidence"
      }
    ]
  }
}

Provide 5–8 signals per category. Only include signals backed by evidence you actually found.`;

  const messages = [{ role: 'user', content: userPrompt }];

  let iterations = 0;
  while (iterations < 15) {
    iterations++;

    const resp = await client.beta.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 8000,
      system:     SYSTEM,
      tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
      betas:      ['web-search-2025-03-05'],
    });

    // Accumulate assistant turn (same pattern as search.js)
    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason === 'end_turn') {
      const text = resp.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      const result = parseLBR(text);
      if (result) return result;
      // No valid JSON found — try one more time asking for the JSON
      if (iterations < 14) {
        messages.push({ role: 'user', content: 'Please output the JSON result now.' });
        continue;
      }
      return null;
    }

    if (resp.stop_reason === 'tool_use') {
      // Acknowledge each tool_use block so Claude can continue searching
      const toolResults = resp.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
    } else {
      break; // Unexpected stop reason
    }
  }

  // Last-ditch: extract any text from the last assistant message
  const lastAssist = [...messages].reverse().find(m => m.role === 'assistant');
  if (lastAssist) {
    const text = (lastAssist.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    if (text) return parseLBR(text);
  }
  return null;
}


function parseLBR(text) {
  try {
    // Extract JSON block — handle both {...} and possible markdown
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const data = JSON.parse(m[0]);
    if (!data.btts || !data.draw) return null;

    // Normalise each section
    for (const outcome of ['btts', 'draw']) {
      for (const cat of ['factors', 'stats']) {
        if (!Array.isArray(data[outcome][cat])) {
          data[outcome][cat] = [];
        }
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
  } catch (e) {
    console.error('LBR parse error:', e.message);
    return null;
  }
}

function validateLevel(level) {
  const VALID = ['Ideal', 'Good', 'Weak', 'Dormant'];
  if (VALID.includes(level)) return level;
  // Fuzzy match
  if (typeof level === 'string') {
    const l = level.toLowerCase();
    if (l.includes('ideal')) return 'Ideal';
    if (l.includes('good') || l.includes('solid')) return 'Good';
    if (l.includes('weak') || l.includes('some')) return 'Weak';
  }
  return 'Dormant';
}

module.exports = { runLBR };
