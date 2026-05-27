// AI #2 — Search Skill
// Finds football matches for a given date + timezone from user's leagues.
// Strategy: for each league, find the active round/matchday and return ALL
// matches in that round (not just those on the exact date).

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM = `You are a football match schedule finder.

Your job for each league:
1. Search for matches scheduled around the requested date (accounting for timezone)
2. Identify which round/matchday/gameweek those matches belong to
3. Return ALL matches in that complete round — including matches on adjacent days
4. Include the round label and kick-off times where available

Rules:
- Search each league individually for accuracy (1-2 searches per league)
- After finding the round, list ALL fixtures in it
- Match name format: "Home Team vs Away Team"
- Return ONLY a valid JSON array — no explanation, no markdown fences
- Do NOT exceed 6 total searches

Output format:
[{"match":"Team A vs Team B","league":"League Name","country":"Country","date":"DD.MM.YYYY","round":"Matchday 12","time":"20:45"}]

If no matches found at all, return: []`;

async function searchMatches(date, leagues, timezone = 0) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const tzLabel = timezone === 0 ? 'UTC' : `UTC${timezone > 0 ? '+' : ''}${timezone}`;

  const leagueList = leagues
    .map(l => `  - ${l.country}: ${l.name}`)
    .join('\n');

  const messages = [{
    role: 'user',
    content: `Find football matches for date: ${date} (${tzLabel})

Leagues to search:
${leagueList}

For each league: find which round/matchday plays on or around ${date}, then list ALL matches in that full round.
Do max 6 searches total across all leagues.
Return results as a JSON array.`
  }];

  let lastText = '';
  let iterations = 0;

  while (iterations < 10) {
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
    } catch (err) {
      // AbortController fired (90s timeout) or network error — return what we have
      console.warn(`Search iteration ${iterations} aborted/failed:`, err.message);
      break;
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

      // Got text but no JSON array — ask once more
      if (iterations < 8) {
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
    // Find the JSON array block
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
        round:   String(x.round   || x.matchday  || x.gameweek || '').trim(),
        time:    String(x.time    || x.kickoff    || '').trim(),
      }))
      .filter(x => x.match.length > 0);
  } catch {
    return [];
  }
}

module.exports = { searchMatches };
