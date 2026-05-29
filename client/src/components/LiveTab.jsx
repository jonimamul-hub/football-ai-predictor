import { useState } from 'react'
import { api } from '../api'
import { badgeClass, SignalRow } from '../utils'

export default function LiveTab({ searchDate = '' }) {
  const [match,  setMatch]  = useState('')
  const [league, setLeague] = useState('')
  const [minute, setMinute] = useState('')
  const [score,  setScore]  = useState('')
  const [stage,  setStage]  = useState('form')   // form | loading | result | error
  const [result, setResult] = useState(null)
  const [error,  setError]  = useState('')

  // Date from the global header (same logic as Analysis.jsx)
  const displayDate = (() => {
    if (!searchDate) return new Date().toLocaleDateString('en-GB').replace(/\//g, '.')
    const parts = searchDate.split('-')
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : ''
  })()

  const analyze = async () => {
    if (!match.trim()) return
    setStage('loading')
    setError('')
    try {
      const liveMinute = minute !== '' ? parseInt(minute, 10) : null
      const liveScore  = score.trim() || null
      const data = await api.analyzeBTTS(
        match.trim(), league.trim(), displayDate, liveMinute, liveScore
      )
      setResult({
        ...data,
        match:  match.trim(),
        league: league.trim(),
        date:   displayDate,
        minute: liveMinute,
        score:  liveScore,
      })
      setStage('result')
    } catch (e) {
      setError(e.message)
      setStage('error')
    }
  }

  const reset = () => {
    setStage('form'); setResult(null)
    setMatch(''); setLeague(''); setMinute(''); setScore('')
  }

  const saveToHistory = async () => {
    if (!result) return
    try {
      await api.addHistory({
        type:            'btts',
        match_name:      result.match,
        league:          result.league,
        match_date:      result.date,
        verdict:         result.verdict,
        source:          'LIVE',
        reasoning:       result.reasoning,
        matched_signals: result.matched_signals || [],
        confidence:      result.confidence ?? null,
      })
    } catch (e) {
      console.error('History save failed:', e)
    }
    reset()
  }

  const factors    = result?.matched_signals?.filter(s => s.category === 'factor') ?? []
  const stats      = result?.matched_signals?.filter(s => s.category === 'stat')   ?? []
  const allSignals = result?.matched_signals ?? []
  const showAll    = !allSignals.some(s => s.category)

  return (
    <div className="card">

      {/* ── FORM ───────────────────────────────────────────────────────── */}
      {stage === 'form' && (
        <div className="pad">
          <div className="live-tab-header">
            <span className="live-indicator-pill">🔴 LIVE</span>
            <span className="live-tab-sub">In-game BTTS Analysis · Uses pre-match signals + current context</span>
          </div>

          <div className="form-group">
            <label className="form-label">Match</label>
            <input
              value={match}
              onChange={e => setMatch(e.target.value)}
              placeholder="e.g. Arsenal vs Chelsea"
              onKeyDown={e => e.key === 'Enter' && analyze()}
            />
          </div>
          <div className="form-group">
            <label className="form-label">League &amp; Round</label>
            <input
              value={league}
              onChange={e => setLeague(e.target.value)}
              placeholder="Premier League - Round 38"
            />
          </div>

          <div className="live-context-row">
            <div className="form-group live-context-field">
              <label className="form-label">Minute</label>
              <div className="live-input-wrap">
                <input
                  type="number"
                  value={minute}
                  onChange={e => setMinute(e.target.value)}
                  placeholder="67"
                  min={1}
                  max={120}
                  className="live-min-input"
                />
                <span className="live-input-suffix">'</span>
              </div>
            </div>
            <div className="form-group live-context-field">
              <label className="form-label">Score</label>
              <input
                value={score}
                onChange={e => setScore(e.target.value)}
                placeholder="1-0"
                className="live-score-input"
                maxLength={8}
              />
            </div>
          </div>

          <div className="ana-date-note">📅 {displayDate} · set in header</div>
          <button className="btn-primary full-width live-analyze-btn" onClick={analyze}>
            ⚡ Analyze Live
          </button>
        </div>
      )}

      {/* ── LOADING ────────────────────────────────────────────────────── */}
      {stage === 'loading' && (
        <div className="loading-state">
          <div className="spinner">⟳</div>
          <p>AI analyzing live match…</p>
        </div>
      )}

      {/* ── ERROR ──────────────────────────────────────────────────────── */}
      {stage === 'error' && (
        <div className="loading-state">
          <p style={{ color: '#f87171' }}>⚠ {error}</p>
          <button className="btn-secondary" style={{ marginTop: '12px' }} onClick={reset}>← Try again</button>
        </div>
      )}

      {/* ── RESULT ─────────────────────────────────────────────────────── */}
      {stage === 'result' && result && (
        <div>
          <div className="match-head" style={{ cursor: 'default' }}>
            <div className="match-info">
              <div className="match-name">{result.match}</div>
              <div className="match-meta">{result.league}</div>
            </div>

            {/* Live context chips */}
            {result.minute != null && (
              <span className="live-chip-min">{result.minute}'</span>
            )}
            {result.score && (
              <span className="live-chip-score">{result.score}</span>
            )}

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
