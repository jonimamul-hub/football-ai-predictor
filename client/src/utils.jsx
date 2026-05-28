// ─── Shared constants and helpers for BTTS / Draw prediction views ──────────
// Import from here to keep LEVEL_CLASS, badgeClass, and SignalRow in sync
// across Analysis, Recommendation, and DataConfig.

// Maps signal quality level → CSS class name
export const LEVEL_CLASS = {
  Ideal: 'ideal', Good: 'good', Weak: 'weak', Dormant: 'dormant',
}

/**
 * Returns the CSS badge class for a verdict string.
 * Covers all verdict values used by both BTTS and Draw systems:
 *   BTTS : YES / NO / SKIP-B
 *   Draw : DRAW / NO_DRAW / SKIP-B
 */
export function badgeClass(v) {
  if (v === 'YES')                   return 'badge-yes'
  if (v === 'DRAW')                  return 'badge-draw'
  if (v === 'NO' || v === 'NO_DRAW') return 'badge-no'
  return 'badge-skip'   // SKIP-B or unknown
}

/**
 * Format a UTC offset number for display.
 *   4  → "UTC+4"
 *  -3  → "UTC-3"
 *   0  → "UTC+0"
 */
export function tzLabel(tz) {
  if (tz == null || isNaN(tz)) return 'UTC+4'
  return tz >= 0 ? `UTC+${tz}` : `UTC${tz}`
}

/**
 * Signal level chip + name row.
 * Used in Analysis result view and Recommendation match detail.
 * Expects a signal object: { level, name, note? }
 */
export function SignalRow({ signal }) {
  const cls = LEVEL_CLASS[signal.level] || 'dormant'
  return (
    <div className="signal-row">
      <span className={`sig ${cls}`}>{signal.level}</span>
      <span>{signal.name}</span>
      {signal.note && <span className="sig-note"> — {signal.note}</span>}
    </div>
  )
}
