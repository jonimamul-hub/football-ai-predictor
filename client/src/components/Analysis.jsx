import { useState } from 'react'
import { api } from '../api'

const LEVEL_CLASS = { Ideal: 'ideal', Good: 'good', Weak: 'weak', Dormant: 'dormant' }

function SignalRow({ signal }) {
  const cls = LEVEL_CLASS[signal.level] || 'dormant'
  return (
    <div className="signal-row">
      <span className={`sig ${cls}`}>{signal.level}</span>
      <span>{signal.name}</span>
      {signal.note && <span className="sig-note"> — {signal.note}</span>}
    </div>
  )
}

export default function Analysis({ type = 'btts' }) {
  const [match,  setMatch]  = useState('')
  const [date,   setDate]   = useState('')
  const [league, setLeague] = useState('')
  const [stage,  setStage]  = useState('form')   // form | loading | result | error
  const [result, setResult] = useState(null)
  const [error,  setError]  = useState('')

  const today = new Date().toLocaleDateString('en-GB').replace(/\//g, '.')

  const analyze = async () => {
    if (!match.trim()) return
    setStage('loading')
    setError('')
    try {
      const fn   = type === 'draw' ? api.analyzeDraw : api.analyzeBTTS
      const data = await fn(match.trim(), league.trim(), date.trim() || today)
      setResult({ ...data, match: match.trim(), league: league.trim(), date: date.trim() || today })
      setStage('result')
    } catch (e) {
      setError(e.message)
      setStage('error')
    }
  }

  const reset = () => { setStage('form'); setResult(null); setMatch(''); setDate(''); setLeague('') }

  const saveToHistory = async () => {
    if (!result) return
    const verdictLabel = result.verdict       // YES / NO / SKIP-B / DRAW / NO_DRAW
    try {
      await api.addHistory({
        type,
        match_name: result.match,
        league:     result.league,
        match_date: result.date,
        verdict:    verdictLabel,
        source:     'ANA',
        reasoning:  result.reasoning
      })
    } catch (e) {
      console.error('History save failed:', e)
    }
    reset()
  }

  // badge class by verdict
  const badgeClass = (v) => {
    if (v === 'YES')    return 'badge-yes'
    if (v === 'DRAW')   return 'badge-draw'
    if (v === 'NO' || v === 'NO_DRAW') return 'badge-no'
    return 'badge-skip'
  }

  const factors = result?.matched_signals?.filter(s => s.category === 'factor') ?? []
  const stats   = result?.matched_signals?.filter(s => s.category === 'stat')   ?? []
  // If no category field, split roughly half-half or show all as factors
  const allSignals = result?.matched_signals ?? []
  const showAll    = !allSignals.some(s => s.category)

  return (
    <div className="card">
      {/* ── FORM ─────────────────────────────────────────────────────── */}
      {stage === 'form' && (
        <div className="pad">
          <div className="form-group">
            <label className="form-label">Match</label>
            <input
              value={match}
              onChange={e => setMatch(e.target.value)}
              placeholder="e.g. Liverpool vs Brentford"
              onKeyDown={e => e.key === 'Enter' && analyze()}
            />
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label">Date</label>
              <input value={date} onChange={e => setDate(e.target.value)} placeholder={today} />
            </div>
            <div className="form-group">
              <label className="form-label">League &amp; Round</label>
              <input value={league} onChange={e => setLeague(e.target.value)} placeholder="Premier League - Round 38" />
            </div>
          </div>
          <button className="btn-primary full-width" onClick={analyze}>Analyze ↗</button>
        </div>
      )}

      {/* ── LOADING ──────────────────────────────────────────────────── */}
      {stage === 'loading' && (
        <div className="loading-state">
          <div className="spinner">⟳</div>
          <p>AI #1 analyzing match…</p>
        </div>
      )}

      {/* ── ERROR ────────────────────────────────────────────────────── */}
      {stage === 'error' && (
        <div className="loading-state">
          <p style={{ color: '#f87171' }}>⚠ {error}</p>
          <button className="btn-secondary" style={{ marginTop: '12px' }} onClick={reset}>← Try again</button>
        </div>
      )}

      {/* ── RESULT ───────────────────────────────────────────────────── */}
      {stage === 'result' && result && (
        <div>
          <div className="match-head" style={{ cursor: 'default' }}>
            <div className="match-info">
              <div className="match-name">{result.match}</div>
              <div className="match-meta">{result.league}</div>
            </div>
            <span className="match-date">{result.date}</span>
            {result.confidence != null && (
              <span className="conf-badge">{result.confidence}%</span>
            )}
            <span className={`badge ${badgeClass(result.verdict)}`}>{result.verdict}</span>
          </div>

          <div className="match-detail pad">
            {/* Signals */}
            {showAll ? (
              <>
                <div className="detail-label">📌 Signals</div>
                {allSignals.map((s, i) => <SignalRow key={i} signal={s} />)}
              </>
            ) : (
              <>
                {factors.length > 0 && (
                  <>
                    <div className="detail-label">📌 Factors</div>
                    {factors.map((s, i) => <SignalRow key={i} signal={s} />)}
                  </>
                )}
                {stats.length > 0 && (
                  <>
                    <div className="detail-label">📊 Statistics</div>
                    {stats.map((s, i) => <SignalRow key={i} signal={s} />)}
                  </>
                )}
              </>
            )}

            {/* Reasoning */}
            {result.reasoning && (
              <>
                <div className="detail-label">🧠 Reasoning</div>
                <p className="reasoning-text">{result.reasoning}</p>
              </>
            )}

            <div className="detail-actions">
              <button className="btn-secondary" onClick={reset}>← New Analysis</button>
              <button className="btn-primary" onClick={saveToHistory}>↓ Move to History</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
