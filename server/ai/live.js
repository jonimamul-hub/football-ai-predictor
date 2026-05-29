// AI — Live BTTS Analysis
// Analyzes in-game BTTS likelihood using live-specific signals + current match state.
// Called from /api/analyze/live with liveContext: { minute, score }

const Anthropic = require('@anthropic-ai/sdk');
const { parseSingle } = require('./utils');

function buildSystemPrompt(signals) {
  const factors = signals.factors
    .map(f => `  [${f.level}] ${f.name}${f.note ? ` — ${f.note}` : ''}`)
    .join('\n') || '  (none yet — add live signals in Data Config → Live tab)';
  const stats = signals.stats
    .map(s => `  [${s.level}] ${s.name}${s.note ? ` — ${s.note}` : ''}`)
    .join('\n') || '  (none yet — add live signals in Data Config → Live tab)';

  return `You are a live in-game BTTS specialist. Your mission: assess whether BOTH TEAMS will still score given the current match state.

LIVE ANALYSIS FRAMEWORK:
- A score of 1-1 or higher already satisfies BTTS — assess if it STAYS satisfied (own goals don't count as team goals in some competitions — ignore that edge case)
- A score of 1-0 or 0-1: one team has scored, the other still needs to — assess likelihood given time + in-game context
- A score of 0-0: BOTH teams still need to score — higher bar, especially in final 20 minutes
- Consider: urgency (trailing team pushes forward), fatigue (high-press teams open up late), substitution patterns, set-piece threat

SIGNAL QUALITY (Council-assigned — do not override):
  [Ideal]   → confirmed in-game pattern, heavily weighted
  [Good]    → solid in-game pattern, well weighted
  [Weak]    → emerging pattern, use cautiously
  [Dormant] → unreliable, ignore in live decisions

VERDICT RULES:
  YES    — in-game context + live signals strongly support BTTS being completed
  NO     — time / score / signals make BTTS unlikely (e.g. 0-0 at 82', dominant team shutting out)
  SKIP-B — insufficient live signals or genuinely conflicting evidence — requires mandatory reason

Available live signals (in-game patterns from league research):
Factors:
${factors}

Statistics:
${stats}

Return ONLY valid JSON — no markdown, no extra text.`;
}

async function analyzeLive(match, league, date, signals, liveContext = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const minute = liveContext.minute ?? '?';
  const score  = liveContext.score  ?? '?-?';

  // Parse current score for context
  const [h, a] = String(score).split('-').map(Number);
  const bttsAlready = (!isNaN(h) && !isNaN(a) && h > 0 && a > 0);
  const scoreMemo   = bttsAlready
    ? `Score ${score} — BTTS condition already met. Assess whether it stays (i.e. no own-goal-only situation).`
    : `Score ${score} — BTTS not yet complete. ${isNaN(h) ? 'Score unclear.' : `${h === 0 && a === 0 ? 'Neither team has scored.' : h > 0 ? 'Home team leads — away team still needs to score.' : 'Away team leads — home team still needs to score.'}`}`;

  const prompt = `[LIVE ANALYSIS MODE] Always analyze — never skip.

Match   : ${match}
League  : ${league}
Date    : ${date}
Minute  : ${minute}'
Score   : ${score}
Status  : ${scoreMemo}

Apply every available live signal to this specific in-game state.
Consider: time remaining (${isNaN(+minute) ? '?' : 90 - +minute} mins), current score dynamics, trailing team urgency, fatigue effects.

Return JSON:
{
  "verdict": "YES|NO|SKIP-B",
  "confidence": <0-100>,
  "matched_signals": [
    { "name": "signal name", "level": "Ideal|Good|Weak|Dormant", "note": "why it applies given minute/score" }
  ],
  "reasoning": "2-3 sentences: current state assessment, decisive live factors, and why this verdict"
}`;

  const resp = await client.messages.create({
    model:      'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    system:     buildSystemPrompt(signals),
    messages:   [{ role: 'user', content: prompt }],
  });

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return parseSingle(text);
}

module.exports = { analyzeLive };
