import { useState } from 'react'

export default function Analysis({ type }) {
  const [match, setMatch] = useState('')
  const [date, setDate] = useState('')
  const [league, setLeague] = useState('')
  const [stage, setStage] = useState('form')
  const [result, setResult] = useState(null)

  const analyze = () => {
    if (!match.trim()) return
    setStage('loading')
    setTimeout(() => {
      setResult({ match, date: date || '26.05.2026', league: league || 'Premier League · R38', verdict: 'YES' })
      setStage('result')
    }, 2000)
  }

  const reset = () => {
    setStage('form')
    setResult(null)
    setMatch('')
    setDate('')
    setLeague('')
  }

  return (
    <div className="card">
      {stage === 'form' && (
        <div className="pad">
          <div className="form-group">
            <label className="form-label">Match</label>
            <input value={match} onChange={e => setMatch(e.target.value)} placeholder="e.g. Liverpool vs Brentford" onKeyDown={e => e.key === 'Enter' && analyze()} />
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label">Date</label>
              <input value={date} onChange={e => setDate(e.target.value)} placeholder="26.05.2026" />
            </div>
            <div className="form-group">
              <label className="form-label">League & Round</label>
              <input value={league} onChange={e => setLeague(e.target.value)} placeholder="Premier League - Round 38" />
            </div>
          </div>
          <button className="btn-primary full-width" onClick={analyze}>Analyze ↗</button>
        </div>
      )}
      {stage === 'loading' && (
        <div className="loading-state">
          <div className="spinner">⟳</div>
          <p>Searching and analyzing...</p>
        </div>
      )}
      {stage === 'result' && result && (
        <div>
          <div className="match-head">
            <div className="match-info">
              <div className="match-name">{result.match}</div>
              <div className="match-meta">{result.league}</div>
            </div>
            <span className="match-date">{result.date}</span>
            <span className="badge badge-yes">{result.verdict}</span>
          </div>
          <div className="match-detail open pad">
            <div className="detail-label">📌 Factors</div>
            <div className="signal-row"><span className="sig ideal">Ideal</span> High motivation — both teams need points</div>
            <div className="signal-row"><span className="sig ideal">Ideal</span> Open attacking style on both sides</div>
            <div className="signal-row"><span className="sig good">Good</span> Away team top scorer available</div>
            <div className="detail-label">📊 Statistics</div>
            <div className="signal-row"><span className="sig ideal">Ideal</span> Last 5 BTTS: 4/5 (80%)</div>
            <div className="signal-row"><span className="sig ideal">Ideal</span> H2H last 6: BTTS 5/6</div>
            <div className="signal-row"><span className="sig good">Good</span> Home avg goals: 2.1</div>
            <div className="detail-actions">
              <button className="btn-secondary" onClick={reset}>← New Analysis</button>
              <button className="btn-primary" onClick={reset}>↓ Move to History</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
