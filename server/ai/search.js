// AI #2 — Search Agent
// MISSION: Find and deliver complete, reliable factual information about requested matches.
// If data is not found, SKIP-A is recorded. Never stop searching. Waterfall strategy.

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM = `Your ONLY mission: Find and deliver complete, reliable factual information about requested matches or leagues. You are responsible — if data is not found, SKIP-A is recorded against you. Never stop searching. Use web_search freely across the entire internet. Waterfall: try multiple searches until you find data.

SEARCH STRATEGY:
1. If a [LBR-verified query] hint is provided for a league — START with that exact query (adapt it for fixture search on the target date). This query is proven to work for this league.
2. Search for the active round/matchday playing on or around the requested date
3. Find ALL matches in that complete round (the full fixture list, not just one day)
4. If first search returns nothing — try alternative terms, different sites, official league pages
5. Keep searching with different angles: "[League] fixtures [date]", "[League] matchday [month year]", "[League] round [week]"

RULES:
- Search each league individually for accuracy
- Include round/matchday label, kick-off times, and exact team names
- Match format: "Home Team vs Away Team"
- Return ONLY a valid JSON array — no prose, no markdown fences

OUTPUT FORMAT:
[{"match":"Team A vs Team B","league":"League Name","country":"Country","date":"DD.MM.YYYY","round":"Matchday 12","time":"20:45"}]

If absolutely nothing found after exhaustive search across multiple attempts: []`;

async function searchMatches(date, leagues, timezone = 0) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const tzLabel = timezone === 0 ? 'UTC' : `UTC${timezone > 0 ? '+' : ''}${timezone}`;

  const leagueList = leagues.map(l => {
    let line = `  - ${l.country}: ${l.name}`;
    if (l.search_query) {
      line += `\n    [LBR-verified query: "${l.search_query}" — start here, adapt for fixtures on target date]`;
    }
    return line;
  }).join('\n');

  const hasHints = leagues.some(l => l.search_query);

  const messages = [{
    role: 'user',
    content: `Find football matches for date: ${date} (${tzLabel})

Leagues:
${leagueList}
${hasHints ? '\nNOTE: Leagues with [LBR-verified query] hints have been successfully researched before — those queries are proven to find data for that league. Use them as your FIRST search attempt, then adapt for fixture/matchday results on the target date.\n' : ''}
For each league: use your waterfall strategy to find which round/matchday plays around ${date}.
Return ALL matches in each complete round found.
Never give up — if one search fails, try another angle.
Return all results as a single JSON array.`
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
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          system:     SYSTEM,
          tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
          messages,
          betas:      ['web-search-2025-03-05'],
        },
        { signal: controller.signal }
      );
    } catch (err) {
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

      if (iterations < 10) {
        messages.push({
          role:    'user',
          content: 'Output ONLY the JSON array now. Start with [ and end with ]. No markdown. If truly nothing found, return [].',
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
        round:   String(x.round   || x.matchday  || x.gameweek || '').trim(),
        time:    String(x.time    || x.kickoff    || '').trim(),
      }))
      .filter(x => x.match.length > 0);
  } catch {
    return [];
  }
}

module.exports = { searchMatches };
