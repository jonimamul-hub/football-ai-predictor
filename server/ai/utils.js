// ─── Shared JSON parsing helpers for AI response processing ─────────────────
// Used by btts.js and draw.js so the fallback shape stays in sync.

/**
 * Extract and parse the first JSON object from a Claude response string.
 * Returns a safe SKIP-B fallback object if parsing fails.
 */
function parseSingle(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch { /* fall through */ }
  return {
    verdict: 'SKIP-B',
    confidence: 0,
    matched_signals: [],
    reasoning: 'Analysis failed — could not parse response.',
  };
}

/**
 * Extract and parse the first JSON array from a Claude response string.
 * Returns [] if parsing fails.
 */
function parseArray(text) {
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
  } catch { /* fall through */ }
  return [];
}

module.exports = { parseSingle, parseArray };
