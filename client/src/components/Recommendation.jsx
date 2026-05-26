import { useState } from 'react'

const MOCK_BTTS = [
  { id: 1, match: 'Arsenal vs Chelsea', league: '🏴 Premier League · R38', date: '26.05.2026', verdict: 'YES',
    factors: ['High motivation — both need points', 'Derby effect — historically open'],
    stats: ['Last 5 BTTS: 4/5 (80%)', 'H2H last 6: BTTS 5/6'] },
  { id: 2, match: 'Barcelona vs Atletico', league: '🇪🇸 La Liga · R38', date: '26.05.2026', verdict: 'YES',
    factors: ['Last matchday — open game expected'],
    stats: ['Last 5 BTTS: 5/5 (100%)'] },
]

const MOCK_DRAW = [
  { id: 1, match: 'Everton vs Wolves', league: '🏴 Premier League · R38', date: '26.05.2026', verdict: 'DRAW',
    factors: ['Both teams safe — low pressure'],
    stats: ['H2H last 6: Draw 4/6'] },
  { id: 2, match: 'Sevilla vs Betis', league: '🇪🇸 La Liga · R38', date: '26.05.2026', verdict: 'DRAW',
    factors: ['El Gran Derbi — emotional rivalry'],
    stats: ['H2H last 8: Draw 5/8'] },
]

export default function Recommendation({ type }) {
  const [subTab, setSubTab] = useState('top')
  const [expanded, setExpanded] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [removed, setRemoved] = useState([])

  const matches = type === 'btts' ? MOCK_BTTS : MOCK_DRAW
  const visible = matches.filter(m => !removed.includes(m.id))

  const remove = (id) => setRemoved([...removed, id])

  return (
    <div className="card">
      <div className="sub-nav">
        <button className={"snb " + (subTab === 'top' ? 'active' : '')} onClick={() => setSubTab('top')}>TOP</button>
        <button className={"snb " + (subTab === 'search' ? 'active' : '')} onClick={() => setSubTab('search')}>Search Results</button>
      </div>
      {subTab === 'top' && (
        <div>
          {!loaded ? (
            <div className="empty-state">
              <p>No recommendations yet</p>
              <button className="btn-primary" onClick={() => setLoaded(true)}>Get Recommendations ↗</button>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              <p>All matches moved to history</p>
              <button className="btn-secondary" onClick={() => { setLoaded(false); setRemoved([]); }}>Refresh</button>
            </div>
          ) : (
            visible.map(m => (
              <div key={m.id} className="match-row">
                <div className="match-head" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                  <div className="match-info">
                    <div className="match-name">{m.match}</div>
                    <div className="match-meta">{m.league}</div>
                  </div>
                  <span className="match-date">{m.date}</span>
                  <span className={"badge " + (m.verdict === 'YES' ? 'badge-yes' : 'badge-draw')}>{m.verdict}</span>
                  <span className={"chev " + (expanded === m.id ? 'open' : '')}>›</span>
                </div>
                {expanded === m.id && (
                  <div className="match-detail pad">
                    <div className="detail-label">📌 Factors</div>
                    {m.factors.map((f, i) => <div key={i} className="signal-row"><span className="sig ideal">Ideal</span> {f}</div>)}
                    <div className="detail-label">📊 Statistics</div>
                    {m.stats.map((s, i) => <div key={i} className="signal-row"><span className="sig ideal">Ideal</span> {s}</div>)}
                    <div className="detail-actions">
                      <button className="btn-primary" onClick={() => remove(m.id)}>↓ Move to History</button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
      {subTab === 'search' && (
        <div className="pad">
          <p style={{color: '#8b8fa8', fontSize: '13px'}}>Search results appear after recommendation...</p>
        </div>
      )}
    </div>
  )
}
