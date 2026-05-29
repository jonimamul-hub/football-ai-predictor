import { useState, useEffect } from 'react'
import { api } from '../api'

export default function History({ type }) {
  const [rows,       setRows]       = useState([])
  const [filter,     setFilter]     = useState('all')
  const [checking,   setChecking]   = useState(new Set())
  const [loading,    setLoading]    = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [editingId,  setEditingId]  = useState(null)
  const [editScore,  setEditScore]  = useState('')

  useEffect(() => { loadHistory() }, [type])

  async function loadHistory() {
    setLoading(true)
    try {
      const { history } = await api.getHistory(type)
      setRows(history.map(r => ({
        id:        r.id,
        match:     r.match_name,
        league:    r.league,
        date:      r.match_date,
        verdict:   r.verdict,
        src:       r.source,
        status:    r.status || 'pending',
        score:     r.score,
        reasoning: r.reasoning || '',
      })))
    } catch (e) {
      console.error('History load failed:', e)
    } finally {
      setLoading(false)
    }
  }

  const checkResult = async (id) => {
    setChecking(prev => new Set([...prev, id]))
    try {
      const { score, status } = await api.checkResult(id)
      setRows(prev => prev.map(r => r.id === id ? { ...r, score, status } : r))
    } catch (e) {
      console.error('Check failed — opening edit form:', e)
      // Scraper could not provide a score; let the user enter it manually
      const row = rows.find(r => r.id === id)
      if (row) startEdit(row)
    } finally {
      setChecking(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  const checkAll = () => {
    rows.filter(r => r.status === 'pending').forEach(r => checkResult(r.id))
  }

  const startEdit = (r) => {
    setEditingId(r.id)
    setEditScore(r.score || '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditScore('')
  }

  const saveEdit = async (id, status) => {
    const score = editScore.trim() || '?-?'
    try {
      await api.updateHistory(id, { score, status })
      setRows(prev => prev.map(r => r.id === id ? { ...r, score, status } : r))
    } catch (e) {
      console.error('Save edit failed:', e)
    } finally {
      setEditingId(null)
      setEditScore('')
    }
  }

  const deleteEntry = async (id, matchName) => {
    if (!window.confirm(`Delete "${matchName}"?\nThis cannot be undone.`)) return
    try {
      await api.deleteHistory(id)
      setRows(prev => prev.filter(r => r.id !== id))
      if (expandedId === id) setExpandedId(null)
      if (editingId  === id) cancelEdit()
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  const toggleExpand = (id) => {
    setExpandedId(prev => prev === id ? null : id)
  }

  // ── Counts (always from full rows, not filtered) ──────────────────────────
  const counts = {
    all:     rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    win:     rows.filter(r => r.status === 'win').length,
    lose:    rows.filter(r => r.status === 'lose').length,
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const resolved  = counts.win + counts.lose
  const winRate   = resolved > 0 ? Math.round((counts.win / resolved) * 100) : 0

  const filtered = rows.filter(r => {
    if (filter === 'all')     return true
    if (filter === 'pending') return r.status === 'pending'
    if (filter === 'win')     return r.status === 'win'
    if (filter === 'lose')    return r.status === 'lose'
    return true
  })

  if (loading) {
    return (
      <div className="card">
        <div className="loading-state">
          <div className="spinner">⟳</div>
          <p>Loading history…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">

      {/* ── Statistics header ───────────────────────────────────────────── */}
      <div className="hist-stats-bar">
        <span className="hist-stat">Total: <strong>{counts.all}</strong></span>
        <span className="hist-stat-sep">|</span>
        <span className="hist-stat">✅ Wins: <strong>{counts.win}</strong></span>
        <span className="hist-stat-sep">|</span>
        <span className="hist-stat">❌ Losses: <strong>{counts.lose}</strong></span>
        <span className="hist-stat-sep">|</span>
        <span className="hist-stat">📊 Win Rate: <strong className={winRate >= 50 ? 'stat-good' : winRate > 0 ? 'stat-mid' : ''}>{winRate}%</strong></span>
      </div>

      {/* ── Filter pills + Check All ─────────────────────────────────────── */}
      <div className="filters-row">
        {[
          { key: 'all',     label: 'All'     },
          { key: 'pending', label: 'Pending' },
          { key: 'win',     label: 'Win'     },
          { key: 'lose',    label: 'Lose'    },
        ].map(({ key, label }) => (
          <button
            key={key}
            className={"fbtn " + (filter === key ? 'active' : '')}
            onClick={() => setFilter(key)}
          >
            {label}({counts[key]})
          </button>
        ))}
        <button className="check-all-btn" onClick={checkAll}>Check All</button>
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <div className="empty-state" style={{ padding: '1.5rem' }}>
          <p>No {filter === 'all' ? '' : filter} predictions yet</p>
        </div>
      )}

      {/* ── Rows ─────────────────────────────────────────────────────────── */}
      {filtered.map(r => {
        const isLose     = r.status === 'lose'
        const isExpanded = expandedId === r.id

        return (
          <div key={r.id} className={`hist-row-wrap${isLose ? ' lose-wrap' : ''}`}>

            {/* Main row */}
            <div
              className={`hist-row${isLose ? ' lose-row' : ''}`}
              onClick={isLose && editingId !== r.id ? () => toggleExpand(r.id) : undefined}
              style={isLose && editingId !== r.id ? { cursor: 'pointer' } : {}}
            >
              <div className="hist-match">
                <div className="hist-name">{r.match}</div>
                <div className="hist-meta">{r.league} · {r.date}</div>
              </div>

              <span className={
                "src-badge " +
                (r.src === 'ANA'  ? 'src-ana'  :
                 r.src === 'LIVE' ? 'src-live' : 'src-rec')
              }>{r.src}</span>
              <span className={"badge " + (r.verdict === 'YES' ? 'badge-yes' : r.verdict === 'DRAW' ? 'badge-draw' : 'badge-no')}>
                {r.verdict}
              </span>

              {/* Outcome / edit form */}
              {editingId === r.id ? (
                <div className="hist-edit-form" onClick={e => e.stopPropagation()}>
                  <input
                    className="hist-score-input"
                    value={editScore}
                    onChange={e => setEditScore(e.target.value)}
                    placeholder="1-1"
                    maxLength={10}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Escape') { cancelEdit(); return }
                      if (e.key === 'Enter') {
                        const parts = editScore.trim().split('-').map(Number)
                        const h = parts[0], a = parts[1]
                        const win = (!isNaN(h) && !isNaN(a))
                          ? ((type === 'btts' || type === 'live') ? (h > 0 && a > 0) : (h === a))
                          : null
                        saveEdit(r.id, win === true ? 'win' : win === false ? 'lose' : 'pending')
                      }
                    }}
                  />
                  <button className="hist-save-btn win"  onClick={() => saveEdit(r.id, 'win')}>✓ Win</button>
                  <button className="hist-save-btn lose" onClick={() => saveEdit(r.id, 'lose')}>✗ Lose</button>
                  <button className="hist-cancel-btn"    onClick={cancelEdit}>✕</button>
                </div>
              ) : (
                <>
                  {r.status === 'pending' ? (
                    <button
                      className="ck-btn"
                      onClick={e => { e.stopPropagation(); checkResult(r.id) }}
                      disabled={checking.has(r.id)}
                    >
                      {checking.has(r.id) ? '…' : '↻'}
                    </button>
                  ) : (
                    <span className={r.status === 'win' ? 'outcome-win' : 'outcome-lose'}>
                      {r.score} {r.status === 'win' ? '✓' : '✗'}
                    </span>
                  )}

                  {/* Edit button */}
                  <button
                    className="edit-btn"
                    onClick={e => { e.stopPropagation(); startEdit(r) }}
                    title="Edit score / result"
                  >edit</button>

                  {/* Delete button */}
                  <button
                    className="del-hist-btn"
                    onClick={e => { e.stopPropagation(); deleteEntry(r.id, r.match) }}
                    title="Delete entry"
                  >🗑</button>

                  {/* Expand chevron on lose rows */}
                  {isLose && (
                    <span className={"chev " + (isExpanded ? 'open' : '')} style={{ fontSize: '16px', marginLeft: '2px' }}>›</span>
                  )}
                </>
              )}
            </div>

            {/* Expanded reasoning (lose only) */}
            {isLose && isExpanded && (
              <div className="hist-expand">
                <div className="hist-expand-label">🧠 Original AI Reasoning</div>
                {r.reasoning
                  ? <p className="reasoning-text">{r.reasoning}</p>
                  : <p className="hist-expand-empty">No reasoning stored for this prediction.</p>
                }
                <div className="hist-expand-note">
                  ⚠ This loss is automatically included in future Council discussions.
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
