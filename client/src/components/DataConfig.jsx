import { useState, useEffect } from 'react'
import { api } from '../api'

const PATTERNS_BTTS = [
  { name: 'High motivation + BTTS >= 60%', level: 'Elite',    desc: 'Confirmed in 6/7. Most reliable combination.' },
  { name: 'Derby effect + H2H BTTS >= 4/6', level: 'Stable',  desc: 'Confirmed in 4/6. Works well in top leagues.' },
  { name: 'Open style + Away goals >= 1.5',  level: 'Unstable',desc: 'Confirmed in 3/7. Needs more data.' },
  { name: 'No relegation + Low motivation',  level: 'Broken',  desc: 'Confirmed in 1/5. Avoid.' },
]

const LEVEL_CLASS = {
  Ideal: 'ideal', Good: 'good', Weak: 'weak', Dormant: 'dormant',
  Elite: 'elite', Stable: 'stable', Unstable: 'unstable', Broken: 'broken'
}
const PAT_CLASS = { Elite: 'pat-elite', Stable: 'pat-stable', Unstable: 'pat-unstable', Broken: 'pat-broken' }

export default function DataConfig({ type }) {
  const [tab,       setTab]       = useState('factors')
  const [factors,   setFactors]   = useState([])
  const [stats,     setStats]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [newFactor, setNewFactor] = useState('')
  const [newStat,   setNewStat]   = useState('')

  // Load signals from server
  useEffect(() => {
    loadSignals()
  }, [type])

  async function loadSignals() {
    setLoading(true)
    try {
      const { factors: f, stats: s } = await api.getSignals(type)
      setFactors(f)
      setStats(s)
    } catch (e) {
      console.error('Failed to load signals:', e)
    } finally {
      setLoading(false)
    }
  }

  const addFactor = async () => {
    const name = newFactor.trim()
    if (!name) return
    const temp = { id: `t-${Date.now()}`, name, level: 'Dormant', src: 'Manual', category: 'factor' }
    setFactors(f => [...f, temp])
    setNewFactor('')
    try {
      const { signal } = await api.addSignal({ type, category: 'factor', name, level: 'Dormant' })
      setFactors(f => f.map(x => x.id === temp.id ? signal : x))
    } catch (e) {
      console.error(e)
      setFactors(f => f.filter(x => x.id !== temp.id))
    }
  }

  const addStat = async () => {
    const name = newStat.trim()
    if (!name) return
    const temp = { id: `t-${Date.now()}`, name, level: 'Dormant', src: 'Manual', category: 'stat' }
    setStats(s => [...s, temp])
    setNewStat('')
    try {
      const { signal } = await api.addSignal({ type, category: 'stat', name, level: 'Dormant' })
      setStats(s => s.map(x => x.id === temp.id ? signal : x))
    } catch (e) {
      console.error(e)
      setStats(s => s.filter(x => x.id !== temp.id))
    }
  }

  const deleteFactor = async (id) => {
    setFactors(f => f.filter(x => x.id !== id))
    try { await api.deleteSignal(id) } catch (e) { console.error(e); loadSignals() }
  }

  const deleteStat = async (id) => {
    setStats(s => s.filter(x => x.id !== id))
    try { await api.deleteSignal(id) } catch (e) { console.error(e); loadSignals() }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="loading-state">
          <div className="spinner">⟳</div>
          <p>Loading signals…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="sub-nav">
        <button className={"snb " + (tab === 'factors'  ? 'active' : '')} onClick={() => setTab('factors')}>📌 Factors</button>
        <button className={"snb " + (tab === 'stats'    ? 'active' : '')} onClick={() => setTab('stats')}>📊 Statistics</button>
        <button className={"snb " + (tab === 'patterns' ? 'active' : '')} onClick={() => setTab('patterns')}>🔗 Patterns</button>
      </div>

      {tab === 'factors' && (
        <div>
          {factors.length === 0 && (
            <div className="empty-state" style={{ padding: '1.5rem', fontSize: '12px' }}>
              No factors yet. Add leagues to auto-generate via LBR, or add manually below.
            </div>
          )}
          {factors.map(f => (
            <div key={f.id} className="sig-row">
              <div className="sig-head">
                <span className={`sig ${LEVEL_CLASS[f.level] || 'dormant'}`}>{f.level}</span>
                <span className="sig-name">{f.name}</span>
                <span className="sig-src">{f.src === 'LBR' ? '📚' : '👤'} {f.src}</span>
                <button className="del-btn" onClick={() => deleteFactor(f.id)}>×</button>
              </div>
              {(f.note || (f.leagues && f.leagues.length > 0)) && (
                <div className="sig-body">
                  {f.note && <div className="sig-note">{f.note}</div>}
                  {f.leagues && f.leagues.length > 0 && (
                    <div className="sig-leagues">
                      {f.leagues.map((lg, i) => <span key={i} className="sig-league-chip">{lg}</span>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="add-sig-row">
            <input
              value={newFactor}
              onChange={e => setNewFactor(e.target.value)}
              placeholder="Add factor…"
              onKeyDown={e => e.key === 'Enter' && addFactor()}
            />
            <button onClick={addFactor}>+ Add</button>
          </div>
        </div>
      )}

      {tab === 'stats' && (
        <div>
          {stats.length === 0 && (
            <div className="empty-state" style={{ padding: '1.5rem', fontSize: '12px' }}>
              No statistics yet. Add leagues to auto-generate via LBR, or add manually below.
            </div>
          )}
          {stats.map(s => (
            <div key={s.id} className="sig-row">
              <div className="sig-head">
                <span className={`sig ${LEVEL_CLASS[s.level] || 'dormant'}`}>{s.level}</span>
                <span className="sig-name">{s.name}</span>
                <span className="sig-src">{s.src === 'LBR' ? '📚' : '👤'} {s.src}</span>
                <button className="del-btn" onClick={() => deleteStat(s.id)}>×</button>
              </div>
              {(s.note || (s.leagues && s.leagues.length > 0)) && (
                <div className="sig-body">
                  {s.note && <div className="sig-note">{s.note}</div>}
                  {s.leagues && s.leagues.length > 0 && (
                    <div className="sig-leagues">
                      {s.leagues.map((lg, i) => <span key={i} className="sig-league-chip">{lg}</span>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="add-sig-row">
            <input
              value={newStat}
              onChange={e => setNewStat(e.target.value)}
              placeholder="Add statistic…"
              onKeyDown={e => e.key === 'Enter' && addStat()}
            />
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
                <span className={`pat-badge ${PAT_CLASS[p.level]}`}>{p.level}</span>
              </div>
              <div className="pat-desc">{p.desc}</div>
            </div>
          ))}
          {type === 'draw' && (
            <div className="empty-state" style={{ padding: '1.5rem', fontSize: '12px' }}>
              Draw patterns accumulate as you use the system.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
