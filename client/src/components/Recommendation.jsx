import { useState } from 'react'
import { api } from '../api'
import { badgeClass, tzLabel, SignalRow } from '../utils'

// Convert YYYY-MM-DD → DD.MM.YYYY for display
function toApiDate(isoDate) {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-')
  return `${d}.${m}.${y}`
}

export default function Recommendation({ type, leagues = [], searchDate, searchTz }) {
  const [subTab,    setSubTab]    = useState('top')
  const [stage,     setStage]     = useState('idle')  // idle|searching|analyzing|done|error
  const [searchHits, setSearchHits] = useState([])    // raw search results
  const [recs,      setRecs]      = useState([])      // final AI picks
  const [expanded,  setExpanded]  = useState(null)
  const [removed,   setRemoved]   = useState(new Set())
  const [error,     setError]     = useState('')

  // ── Derived display values ────────────────────────────────────────────
  const displayDate = searchDate ? toApiDate(searchDate) : '—'
  const displayTz   = searchTz  != null ? tzLabel(searchTz) : 'UTC+4'

  // ── Get Recommendations flow ──────────────────────────────────────────
  const getRecommendations = async () => {
    if (!leagues.length) {
      setError('Add leagues first in the Leagues section')
      setStage('error')
      return
    }
    if (!searchDate) {
      setError('Set a date in the header first')
      setStage('error')
      return
    }
    setStage('searching')
    setError('')
    setRecs([])
    setSearchHits([])
    setRemoved(new Set())

    try {
      // Step 1 — AI #2 Search
      // Send YYYY-MM-DD directly — the scraper's _to_api_date() requires this format.
      // toApiDate is only used for display (the 📅 chip), never for API calls.
      const { matches } = await api.search(searchDate, leagues, searchTz ?? 4)
      setSearchHits(matches)

      if (!matches.length) {
        setError(`No matches found for ${displayDate} (${displayTz}). Try again later or check your leagues.`)
        setStage('error')
        return
      }

      // Step 2 — AI #1 Recommend
      setStage('analyzing')
      const endpoint = type === 'draw' ? api.recommendDraw : api.recommendBTTS
      const { recommendations } = await endpoint(matches)

      setRecs(recommendations || [])
      setStage('done')
    } catch (e) {
      setError(e.message)
      setStage('error')
    }
  }

  const reset = () => {
    setStage('idle')
    setRecs([])
    setSearchHits([])
    setRemoved(new Set())
    setError('')
  }

  const moveToHistory = async (rec) => {
    try {
      await api.addHistory({
        type,
        match_name:      rec.match,
        league:          rec.league,
        match_date:      rec.date,
        verdict:         rec.verdict,
        source:          'REC',
        reasoning:       rec.reasoning,
        matched_signals: rec.matched_signals || [],
        confidence:      rec.confidence ?? null,
      })
    } catch (e) {
      console.error('History save failed:', e)
    }
    setRemoved(prev => new Set([...prev, rec.match]))
  }

  const visible = recs.filter(r => !removed.has(r.match))

  // ── Status label ─────────────────────────────────────────────────────
  const statusLabel = {
    idle:      null,
    searching: `🔍 AI #2 searching matches for ${displayDate} (${displayTz})…`,
    analyzing: '🧠 AI #1 selecting top picks…',
    error:     null,
    done:      null,
  }[stage]

  return (
    <div className="card">
      <div className="sub-nav">
        <button className={"snb " + (subTab === 'top'    ? 'active' : '')} onClick={() => setSubTab('top')}>
          {type === 'draw' ? 'TOP 2' : 'TOP 3'}
        </button>
        <button className={"snb " + (subTab === 'search' ? 'active' : '')} onClick={() => setSubTab('search')}>
          Search Results {searchHits.length > 0 && `(${searchHits.length})`}
        </button>
      </div>

      {/* ── TOP tab ──────────────────────────────────────────────────── */}
      {subTab === 'top' && (
        <div>
          {/* Loading states */}
          {(stage === 'searching' || stage === 'analyzing') && (
            <div className="loading-state">
              <div className="spinner">⟳</div>
              <p>{statusLabel}</p>
            </div>
          )}

          {/* Error */}
          {stage === 'error' && (
            <div className="empty-state">
              <p style={{ color: '#f87171' }}>⚠ {error}</p>
              <button className="btn-secondary" onClick={reset}>↺ Try again</button>
            </div>
          )}

          {/* Idle — no recommendations yet */}
          {stage === 'idle' && (
            <div className="empty-state">
              <p>No recommendations yet</p>
              <button className="btn-primary" onClick={getRecommendations}>
                Get Recommendations ↗
              </button>
            </div>
          )}

          {/* Done — show results */}
          {stage === 'done' && visible.length === 0 && (
            <div className="empty-state">
              <p>No qualifying picks found for today</p>
              <button className="btn-secondary" onClick={reset}>↺ Refresh</button>
            </div>
          )}

          {stage === 'done' && visible.length > 0 && (
            <>
              {visible.map((rec, i) => (
                <div key={rec.match + i} className="match-row">
                  <div
                    className="match-head"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                  >
                    <div className="match-info">
                      <div className="match-name">{rec.match}</div>
                      <div className="match-meta">{rec.league}</div>
                    </div>
                    <span className="match-date">{rec.date}</span>
                    {rec.confidence != null && (
                      <span className="conf-badge">{rec.confidence}%</span>
                    )}
                    <span className={`badge ${badgeClass(rec.verdict)}`}>{rec.verdict}</span>
                    <span className={"chev " + (expanded === i ? 'open' : '')}>›</span>
                  </div>

                  {expanded === i && (
                    <div className="match-detail pad">
                      {(rec.matched_signals || []).length > 0 && (
                        <>
                          <div className="detail-label">📌 Signals</div>
                          {rec.matched_signals.map((s, j) => <SignalRow key={j} signal={s} />)}
                        </>
                      )}
                      {rec.reasoning && (
                        <>
                          <div className="detail-label">🧠 Reasoning</div>
                          <p className="reasoning-text">{rec.reasoning}</p>
                        </>
                      )}
                      <div className="detail-actions">
                        <button className="btn-primary" onClick={() => moveToHistory(rec)}>
                          ↓ Move to History
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              <div style={{ padding: '10px 14px', borderTop: '1px solid #1c1f2e' }}>
                <button className="btn-secondary" onClick={reset}>↺ Refresh</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Search Results tab ───────────────────────────────────────── */}
      {subTab === 'search' && (
        <div>
          {searchHits.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem' }}>
              <p>Search results appear after clicking "Get Recommendations"</p>
            </div>
          ) : (
            searchHits.map((m, i) => (
              <div key={i} className="hist-row">
                <div className="hist-match">
                  <div className="hist-name">{m.match}</div>
                  <div className="hist-meta">
                    {m.league}
                    {m.round && <span className="round-chip"> · {m.round}</span>}
                    {' · '}{m.date}
                    {m.time && <span className="match-time"> {m.time}</span>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
