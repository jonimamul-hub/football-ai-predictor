// AI #2 — Search Skill
// Finds football matches for a given date from user's leagues
// Uses web_search_20250305 tool (only place in the codebase where it is used)

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM = `You are a football match schedule finder. Use web search to find exact matches scheduled for the requested date in the given leagues.

Rules:
- Search each league individually for accuracy
- Only include matches confirmed for that exact date
- Match name format: "Home Team vs Away Team"
- Return ONLY a valid JSON array — no explanation, no markdown fences

Output format:
[{"match":"Team A vs Team B","league":"League Name","country":"Country","date":"DD.MM.YYYY"}]

If no matches found, return: []`;

async function searchMatches(date, leagues) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const leagueList = leagues
    .map(l => `  - ${l.country}: ${l.name}`)
    .join('\n');

  const messages = [{
    role: 'user',
    content: `Find all football matches on ${date} for these leagues:\n${leagueList}\n\nSearch each league and return all matches as a JSON array.`
  }];

  let iterations = 0;
  while (iterations < 10) {
    iterations++;

    const resp = await client.beta.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: SYSTEM,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
      betas: ['web-search-2025-03-05']
    });

    // Accumulate assistant turn
    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason === 'end_turn') {
      const text = resp.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      return parseMatches(text, date);
    }

    if (resp.stop_reason === 'tool_use') {
      // Acknowledge each tool_use block so Claude can continue
      const toolResults = resp.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
      messages.push({ role: 'user', content: toolResults });
    } else {
      break;
    }
  }

  return [];
}

function parseMatches(text, fallbackDate) {
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return arr
      .map(x => ({
        match:   x.match   || x.matchName || '',
        league:  x.league  || '',
        country: x.country || '',
        date:    x.date    || fallbackDate
      }))
      .filter(x => x.match);
  } catch {
    return [];
  }
}

module.exports = { searchMatches };
