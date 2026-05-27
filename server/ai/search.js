// AI #2 — Search Skill
// Finds football matches for a given date + timezone from user's leagues.
// Strategy: find the round/matchday playing around that date, then return
// ALL matches in that round (not just those on the exact date).

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM = `You are a football match schedule finder.

Your job for each league:
1. Search for matches scheduled around the requested date (accounting for timezone)
2. Identify which round/matchday/gameweek those matches belong to
3. Find ALL matches in that complete round — including matches on adjacent days
4. Return every match from that full round

Rules:
- Search each league individually
- If a league has multiple matches on the date, they all belong to the same round
- Include the round label (e.g. "Matchday 12", "Round 5", "GW28") in the output
- Include kick-off time if found (HH:MM format)
- Match name format: "Home Team vs Away Team"
- Return ONLY a valid JSON array — no explanation, no markdown fences

Output format:
[{"match":"Team A vs Team B","league":"League Name","country":"Country","date":"DD.MM.YYYY","round":"Matchday 12","time":"20:45"}]

If no matches found for a league, skip it.
If no matches found at all, return: []`;

async function searchMatches(date, leagues, timezone = 0) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const tzLabel = timezone === 0 ? 'UTC' : `UTC${timezone > 0 ? '+' : ''}${timezone}`;

  const leagueList = leagues
    .map(l => `  - ${l.country}: ${l.name}`)
    .join('\n');

  const messages = [{
    role: 'user',
    content: `Find football matches for:
- Date: ${date} (timezone: ${tzLabel})
- Leagues:
${leagueList}

For each league:
1. Search for which round/matchday is being played on or around ${date}
2. Return ALL matches in that complete round (the full gameweek/matchday)
Include match times (local) and round numbers where available.
Return all matches as a JSON array.`
  }];

  let lastText = '';
  let iterations = 0;

  while (iterations < 12) {
    iterations++;

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

      const result = parseMatches(text, date);
      if (result.length > 0) return result;

      // Got text but no JSON array — ask again
      if (iterations < 10) {
        messages.push({
          role:    'user',
          content: 'Output ONLY the JSON array now. Start with [ and end with ]. No markdown.',
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

  return parseMatches(lastText, date);
}

function parseMatches(text, fallbackDate) {
  if (!text) return [];
  try {
    // Strip markdown fences
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    const m = clean.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .map(x => ({
        match:   String(x.match   || x.matchName || '').trim(),
        league:  String(x.league  || '').trim(),
        country: String(x.country || '').trim(),
        date:    String(x.date    || fallbackDate).trim(),
        round:   String(x.round   || x.matchday || x.gameweek || '').trim(),
        time:    String(x.time    || x.kickoff   || '').trim(),
      }))
      .filter(x => x.match.length > 0);
  } catch {
    return [];
  }
}

module.exports = { searchMatches };
