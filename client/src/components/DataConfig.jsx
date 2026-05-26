import { useState } from 'react'

const INIT_FACTORS_BTTS = [
  { id: 1, name: 'High motivation — both teams need points', level: 'Ideal', src: 'LBR' },
  { id: 2, name: 'Derby / rivalry effect', level: 'Ideal', src: 'LBR' },
  { id: 3, name: 'Open attacking tactical style', level: 'Good', src: 'LBR' },
  { id: 4, name: 'Away team key striker available', level: 'Weak', src: 'Manual' },
  { id: 5, name: 'No relegation pressure', level: 'Dormant', src: 'LBR' },
]

const INIT_STATS_BTTS = [
  { id: 1, name: 'Last 5 matches BTTS rate >= 60%', level: 'Ideal', src: 'LBR' },
  { id: 2, name: 'H2H last 6: BTTS >= 4/6', level: 'Ideal', src: 'LBR' },
  { id: 3, name: 'Home avg goals per game >= 1.8', level: 'Good', src: 'LBR' },
  { id: 4, name: 'League avg BTTS rate this season', level: 'Dormant', src: 'LBR' },
]

const INIT_FACTORS_DRAW = [
  { id: 1, name: 'Both teams have low motivation', level: 'Ideal', src: 'LBR' },
  { id: 2, name: 'Rivalry / derby dynamic', level: 'Ideal', src: 'LBR' },
  { id: 3, name: 'Defensive tactical style on both sides', level: 'Good', src: 'LBR' },
]

const INIT_STATS_DRAW = [
  { id: 1, name: 'H2H draw rate >= 40%', level: 'Ideal', src: 'LBR' },
  { id: 2, name: 'League avg draw rate >= 28%', level: 'Good', src: 'LBR' },
  { id: 3, name: 'Home team draws in last 5: >= 2', level: 'Good', src: 'LBR' },
]

const PATTERNS_BTTS = [
  { name: 'High motivation + BTTS >= 60%', level: 'Elite', desc: 'Confirmed in 6/7. Most reliable combination.' },
  { name: 'Derby effect + H2H BTTS >= 4/6', level: 'Stable', desc: 'Confirmed in 4/6. Works well in top leagues.' },
  { name: 'Open style + Away goals >= 1.5', level: 'Unstable', desc: 'Confirmed in 3/7. Needs more data.' },
  { name: 'No relegation + Low motivation', level: 'Broken', desc: 'Confirmed in 1/5. Avoid.' },
]

export default function DataConfig({ type }) {
  const [tab, setTab] = useState('factors')
  const [factors, setFactors] = useState(type === 'btts' ? INIT_FACTORS_BTTS : INIT_FACTORS_DRAW)
  const [stats, setStats] = useState(type === 'btts' ? INIT_STATS_BTTS : INIT_STATS_DRAW)
  const [newFactor, setNewFactor] = useState('')
  const [newStat, setNewStat] = useState('')

  const addFactor = () => {
    if (!newFactor.trim()) return
    setFactors([...factors, { id: Date.now(), name: newFactor, level: 'Dormant', src: 'Manual' }])
    setNewFactor('')
  }

  const addStat = () => {
    if (!newStat.trim()) return
    setStats([...stats, { id: Date.now(), name: newStat, level: 'Dormant', src: 'Manual' }])
    setNewStat('')
  }

  const levelClass = (l) => ({ Ideal: 'ideal', Good: 'good', Weak: 'weak', Dormant: 'dormant', Elite: 'elite', Stable: 'stable', Unstable: 'unstable', Broken: 'broken' }[l] || '')
  const patClass = (l) => ({ Elite: 'pat-elite', Stable: 'pat-stable', Unstable: 'pat-unstable', Broken: 'pat-broken' }[l] || '')

  return (
    <div className="card">
      <div className="sub-nav">
        <button className={"snb " + (tab === 'factors' ? 'active' : '')} onClick={() => setTab('factors')}>📌 Factors</button>
        <button className={"snb " + (tab === 'stats' ? 'active' : '')} onClick={() => setTab('stats')}>📊 Statistics</button>
        <button className={"snb " + (tab === 'patterns' ? 'active' : '')} onClick={() => setTab('patterns')}>🔗 Patterns</button>
      </div>
      {tab === 'factors' && (
        <div>
          {factors.map(f => (
            <div key={f.id} className="sig-row">
              <span className={"sig " + levelClass(f.level)}>{f.level}</span>
              <span className="sig-name">{f.name}</span>
              <span className="sig-src">{f.src === 'LBR' ? '📚' : '👤'} {f.src}</span>
              <button className="del-btn" onClick={() => setFactors(factors.filter(x => x.id !== f.id))}>×</button>
            </div>
          ))}
          <div className="add-sig-row">
            <input value={newFactor} onChange={e => setNewFactor(e.target.value)} placeholder="Add factor..." onKeyDown={e => e.key === 'Enter' && addFactor()} />
            <button onClick={addFactor}>+ Add</button>
          </div>
        </div>
      )}
      {tab === 'stats' && (
        <div>
          {stats.map(s => (
            <div key={s.id} className="sig-row">
              <span className={"sig " + levelClass(s.level)}>{s.level}</span>
              <span className="sig-name">{s.name}</span>
              <span className="sig-src">{s.src === 'LBR' ? '📚' : '👤'} {s.src}</span>
              <button className="del-btn" onClick={() => setStats(stats.filter(x => x.id !== s.id))}>×</button>
            </div>
          ))}
          <div className="add-sig-row">
            <input value={newStat} onChange={e => setNewStat(e.target.value)} placeholder="Add statistic..." onKeyDown={e => e.key === 'Enter' && addStat()} />
            <button onClick={addStat}>+ Add</button>
          </div>
        </div>
      )}
      {tab === 'patterns' && (
        <div>
          {(type === 'btts' ? PATTERNS_BTTS : []).map((p, i) => (
            <div key={i} className="pat-row">
              <div className="pat-head">
                <span className="pat-name">{p.name}</span>
                <span className={"pat-badge " + patClass(p.level)}>{p.level}</span>
              </div>
              <div className="pat-desc">{p.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
