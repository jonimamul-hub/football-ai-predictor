import { useState, useEffect } from 'react'
import { api } from '../api'
import { LEVEL_CLASS } from '../utils'

const RATINGS    = ['Elite', 'Stable', 'Unstable', 'Broken']
const RAT_CLASS  = { Elite: 'pat-elite', Stable: 'pat-stable', Unstable: 'pat-unstable', Broken: 'pat-broken' }
const RATING_ORDER = { Elite: 1, Stable: 2, Unstable: 3, Broken: 4 }

export default function DataConfig({ type }) {
  const [tab,       setTab]       = useState('factors')

  // ── Signals state ─────────────────────────────────────────────────────────
  const [factors,   setFactors]   = useState([])
  const [stats,     setStats]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [newFactor, setNewFactor] = useState('')
  const [newStat,   setNewStat]   = useState('')

  // ── Patterns state ────────────────────────────────────────────────────────
  const [patterns,      setPatterns]      = useState([])
  const [patsLoading,   setPatsLoading]   = useState(false)
  const [showCreate,    setShowCreate]    = useState(false)
  const [newPatName,    setNewPatName]    = useState('')
  const [newPatRating,  setNewPatRating]  = useState('Unstable')
  const [newPatSignals, setNewPatSignals] = useState([])  // [{name,level,category}]
  const [newPatNotes,   setNewPatNotes]   = useState('')
  const [creating,      setCreating]      = useState(false)

  useEffect(() => {
    loadSignals()
    loadPatterns()
  }, [type])

  // ── Loaders ───────────────────────────────────────────────────────────────
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

  async function loadPatterns() {
    setPatsLoading(true)
    try {
      const { patterns: p } = await api.getPatterns(type)
      setPatterns(p)
    } catch (e) {
      console.error('Failed to load patterns:', e)
    } finally {
      setPatsLoading(false)
    }
  }

  // ── Signals CRUD ──────────────────────────────────────────────────────────
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

  // ── Patterns CRUD ─────────────────────────────────────────────────────────
  const toggleSignal = (sig) => {
    setNewPatSignals(prev => {
      const exists = prev.some(s => s.name === sig.name)
      if (exists) return prev.filter(s => s.name !== sig.name)
      return [...prev, { name: sig.name, level: sig.level, category: sig.category }]
    })
  }

  const resetCreateForm = () => {
    setNewPatName('')
    setNewPatRating('Unstable')
    setNewPatSignals([])
    setNewPatNotes('')
    setShowCreate(false)
  }

  const createPattern = async () => {
    const name = newPatName.trim()
    if (!name) return
    setCreating(true)
    try {
      const { pattern } = await api.addPattern({
        type, name,
        signals: newPatSignals,
        rating:  newPatRating,
        notes:   newPatNotes.trim(),
      })
      setPatterns(prev =>
        [...prev, pattern].sort((a, b) => {
          const ro = (RATING_ORDER[a.rating] || 5) - (RATING_ORDER[b.rating] || 5)
          return ro !== 0 ? ro : a.name.localeCompare(b.name)
        })
      )
      resetCreateForm()
    } catch (e) {
      console.error('Create pattern failed:', e)
    } finally {
      setCreating(false)
    }
  }

  const deletePattern = async (id) => {
    setPatterns(prev => prev.filter(p => p.id !== id))
    try { await api.deletePattern(id) } catch (e) { console.error(e); loadPatterns() }
  }

  // ── Loading guard (signals only — patterns have their own spinner) ─────────
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

  const allSignals = [...factors, ...stats]

  return (
    <div className="card">
      <div className="sub-nav">
        <button className={"snb " + (tab === 'factors'  ? 'active' : '')} onClick={() => setTab('factors')}>
          📌 Factors ({factors.length})
        </button>
        <button className={"snb " + (tab === 'stats'    ? 'active' : '')} onClick={() => setTab('stats')}>
          📊 Statistics ({stats.length})
        </button>
        <button className={"snb " + (tab === 'patterns' ? 'active' : '')} onClick={() => setTab('patterns')}>
          🔗 Patterns ({patterns.length})
        </button>
      </div>

      {/* ── FACTORS ──────────────────────────────────────────────────────── */}
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
                  {f.leagues?.length > 0 && (
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

      {/* ── STATISTICS ───────────────────────────────────────────────────── */}
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
                  {s.leagues?.length > 0 && (
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

      {/* ── PATTERNS ─────────────────────────────────────────────────────── */}
      {tab === 'patterns' && (
        <div>

          {/* Loading */}
          {patsLoading && (
            <div className="loading-state" style={{ padding: '2rem' }}>
              <div className="spinner">⟳</div>
              <p>Loading patterns…</p>
            </div>
          )}

          {/* Pattern list */}
          {!patsLoading && patterns.map(p => {
            const sigs = Array.isArray(p.signals) ? p.signals : []
            const hasStats = p.usage_count > 0
            return (
              <div key={p.id} className="pat-row">
                <div className="pat-head">
                  <span className={`pat-badge ${RAT_CLASS[p.rating] || 'pat-unstable'}`}>{p.rating}</span>
                  <span className="pat-name">{p.name}</span>
                  {hasStats && (
                    <span className="pat-rate">
                      {Number(p.success_rate).toFixed(0)}% · {p.usage_count} uses
                    </span>
                  )}
                  <button className="del-btn" onClick={() => deletePattern(p.id)} title="Delete pattern">×</button>
                </div>
                {sigs.length > 0 && (
                  <div className="pat-signals">
                    {sigs.map((s, i) => (
                      <span key={i} className={`pat-sig-chip sig ${LEVEL_CLASS[s.level] || 'dormant'}`}>
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
                {p.notes && <div className="pat-notes">{p.notes}</div>}
              </div>
            )
          })}

          {/* Empty state */}
          {!patsLoading && patterns.length === 0 && !showCreate && (
            <div className="empty-state" style={{ padding: '1.5rem', fontSize: '12px' }}>
              No patterns yet. Patterns are signal combinations that reliably predict outcomes —
              create one below or let the Council build them over time.
            </div>
          )}

          {/* ── Create form ─────────────────────────────────────────── */}
          {showCreate && (
            <div className="pat-create-form">
              <div className="pat-create-title">New Pattern</div>

              {/* Name */}
              <div className="pat-create-field">
                <label>Name</label>
                <input
                  value={newPatName}
                  onChange={e => setNewPatName(e.target.value)}
                  placeholder="e.g. High motivation + BTTS ≥ 60%"
                  onKeyDown={e => { if (e.key === 'Enter') createPattern(); if (e.key === 'Escape') resetCreateForm() }}
                  autoFocus
                />
              </div>

              {/* Rating */}
              <div className="pat-create-field">
                <label>Rating</label>
                <div className="pat-rating-btns">
                  {RATINGS.map(r => (
                    <button
                      key={r}
                      className={`pat-rating-btn ${RAT_CLASS[r]}${newPatRating === r ? ' selected' : ''}`}
                      onClick={() => setNewPatRating(r)}
                    >{r}</button>
                  ))}
                </div>
              </div>

              {/* Signal picker */}
              <div className="pat-create-field">
                <label>
                  Signals
                  {newPatSignals.length > 0 &&
                    <span className="pat-sel-count"> · {newPatSignals.length} selected</span>
                  }
                </label>
                {allSignals.length === 0 ? (
                  <p className="pat-no-signals">
                    No signals available — add signals in Factors / Statistics tabs first.
                  </p>
                ) : (
                  <div className="pat-sig-picker">
                    {allSignals.map(s => {
                      const selected = newPatSignals.some(x => x.name === s.name)
                      return (
                        <span
                          key={s.id}
                          className={`pat-sig-option sig ${LEVEL_CLASS[s.level] || 'dormant'}${selected ? ' pat-sig-selected' : ''}`}
                          onClick={() => toggleSignal(s)}
                          title={`${s.category} · click to ${selected ? 'remove' : 'add'}`}
                        >{s.name}</span>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="pat-create-field">
                <label>Notes <span className="pat-optional">(optional)</span></label>
                <input
                  value={newPatNotes}
                  onChange={e => setNewPatNotes(e.target.value)}
                  placeholder="Context or observations…"
                  onKeyDown={e => e.key === 'Escape' && resetCreateForm()}
                />
              </div>

              {/* Actions */}
              <div className="pat-create-actions">
                <button className="btn-secondary" onClick={resetCreateForm}>Cancel</button>
                <button
                  className="btn-primary"
                  onClick={createPattern}
                  disabled={!newPatName.trim() || creating}
                >
                  {creating ? 'Creating…' : '+ Create Pattern'}
                </button>
              </div>
            </div>
          )}

          {/* Add button (shown when form is hidden) */}
          {!patsLoading && !showCreate && (
            <div className="pat-add-bar">
              <button className="btn-secondary" onClick={() => setShowCreate(true)}>+ New Pattern</button>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
