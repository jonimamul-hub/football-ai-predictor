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
        reasoning: r.reasoning || '',   // ← keep for loss expansion
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
      // Simulate fetching real score (would be a real API in production)
      const scores = ['2-1','1-1','0-0','3-0','1-2','0-1','2-2','1-0','3-1','0-2']
      const score  = scores[Math.floor(Math.random() * scores.length)]
      const [h, a] = score.split('-').map(Number)
      const win    = type === 'btts'
        ? (h > 0 && a > 0)
        : (h === a)
      const status = win ? 'win' : 'lose'

      await api.updateHistory(id, { score, status })
      setRows(rows.map(r => r.id === id ? { ...r, score, status } : r))
    } catch (e) {
      console.error('Check failed:', e)
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

  const toggleExpand = (id) => {
    setExpandedId(prev => prev === id ? null : id)
  }

  const counts = {
    all:     rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    done:    rows.filter(r => r.status !== 'pending').length,
    win:     rows.filter(r => r.status === 'win').length,
    lose:    rows.filter(r => r.status === 'lose').length,
  }

  const filtered = rows.filter(r => {
    if (filter === 'all')     return true
    if (filter === 'pending') return r.status === 'pending'
    if (filter === 'done')    return r.status !== 'pending'
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
      <div className="filters-row">
        {['all','pending','done','win','lose'].map(f => (
          <button
            key={f}
            className={"fbtn " + (filter === f ? 'active' : '')}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)} {counts[f]}
          </button>
        ))}
        <button className="check-all-btn" onClick={checkAll}>Check All</button>
      </div>

      {filtered.length === 0 && (
        <div className="empty-state" style={{ padding: '1.5rem' }}>
          <p>No {filter === 'all' ? '' : filter} predictions yet</p>
        </div>
      )}

      {filtered.map(r => {
        const isLose     = r.status === 'lose'
        const isExpanded = expandedId === r.id

        return (
          <div key={r.id} className={`hist-row-wrap${isLose ? ' lose-wrap' : ''}`}>
            {/* ── Main row ──────────────────────────────────────────── */}
            <div
              className={`hist-row${isLose ? ' lose-row' : ''}`}
              onClick={isLose ? () => toggleExpand(r.id) : undefined}
              style={isLose ? { cursor: 'pointer' } : {}}
            >
              <div className="hist-match">
                <div className="hist-name">{r.match}</div>
                <div className="hist-meta">{r.league} · {r.date}</div>
              </div>
              <span className={"src-badge " + (r.src === 'ANA' ? 'src-ana' : 'src-rec')}>{r.src}</span>
              <span className={"badge " + (r.verdict === 'YES' || r.verdict === 'DRAW' ? (r.verdict === 'YES' ? 'badge-yes' : 'badge-draw') : 'badge-no')}>
                {r.verdict}
              </span>
              {/* ── Outcome / edit form ────────────────────────── */}
              {editingId === r.id ? (
                <div className="hist-edit-form" onClick={e => e.stopPropagation()}>
                  <input
                    className="hist-score-input"
                    value={editScore}
                    onChange={e => setEditScore(e.target.value)}
                    placeholder="1-1"
                    maxLength={7}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Escape') cancelEdit()
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
                  <button
                    className="edit-btn"
                    onClick={e => { e.stopPropagation(); startEdit(r) }}
                    title="Edit score / result"
                  >✎</button>
                  {/* Expand chevron on lose rows */}
                  {isLose && (
                    <span className={"chev " + (isExpanded ? 'open' : '')} style={{ fontSize: '16px', marginLeft: '2px' }}>›</span>
                  )}
                </>
              )}
            </div>

            {/* ── Expanded reasoning (lose only) ────────────────────── */}
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
