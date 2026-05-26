import { useState } from 'react'

const INIT = [
  { id: 1, match: 'PSG vs Monaco', league: '🇫🇷 Ligue 1 · R37', date: '18.05.2026', verdict: 'YES', src: 'REC', status: 'win', score: '2-1' },
  { id: 2, match: 'Juventus vs Inter', league: '🇮🇹 Serie A · R37', date: '15.05.2026', verdict: 'YES', src: 'REC', status: 'lose', score: '1-0' },
  { id: 3, match: 'Dortmund vs Bayern', league: '🇩🇪 Bundesliga · R33', date: '10.05.2026', verdict: 'YES', src: 'ANA', status: 'win', score: '3-2' },
  { id: 4, match: 'Man City vs Liverpool', league: '🏴 PL · R37', date: '20.05.2026', verdict: 'YES', src: 'REC', status: 'pending', score: null },
]

export default function History({ type }) {
  const [rows, setRows] = useState(INIT)
  const [filter, setFilter] = useState('all')
  const [checking, setChecking] = useState([])

  const checkResult = (id) => {
    setChecking([...checking, id])
    setTimeout(() => {
      const scores = ['2-1','1-1','0-0','3-0','1-2','0-1','2-2','1-0']
      const score = scores[Math.floor(Math.random() * scores.length)]
      const [h, a] = score.split('-').map(Number)
      const win = type === 'btts' ? (h > 0 && a > 0) : (h === a)
      setRows(rows.map(r => r.id === id ? { ...r, status: win ? 'win' : 'lose', score } : r))
      setChecking(checking.filter(c => c !== id))
    }, 1200)
  }

  const checkAll = () => {
    const pending = rows.filter(r => r.status === 'pending')
    pending.forEach(r => checkResult(r.id))
  }

  const filtered = rows.filter(r => {
    if (filter === 'all') return true
    if (filter === 'pending') return r.status === 'pending'
    if (filter === 'done') return r.status !== 'pending'
    if (filter === 'win') return r.status === 'win'
    if (filter === 'lose') return r.status === 'lose'
    return true
  })

  const counts = {
    all: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    done: rows.filter(r => r.status !== 'pending').length,
    win: rows.filter(r => r.status === 'win').length,
    lose: rows.filter(r => r.status === 'lose').length,
  }

  return (
    <div className="card">
      <div className="filters-row">
        {['all','pending','done','win','lose'].map(f => (
          <button key={f} className={"fbtn " + (filter === f ? 'active' : '')} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)} {counts[f]}
          </button>
        ))}
        <button className="check-all-btn" onClick={checkAll}>Check All</button>
      </div>
      {filtered.map(r => (
        <div key={r.id} className="hist-row">
          <div className="hist-match">
            <div className="hist-name">{r.match}</div>
            <div className="hist-meta">{r.league} · {r.date}</div>
          </div>
          <span className={"src-badge " + (r.src === 'ANA' ? 'src-ana' : 'src-rec')}>{r.src}</span>
          <span className={"badge " + (r.verdict === 'YES' ? 'badge-yes' : 'badge-draw')}>{r.verdict}</span>
          {r.status === 'pending' ? (
            <button className="ck-btn" onClick={() => checkResult(r.id)} disabled={checking.includes(r.id)}>
              {checking.includes(r.id) ? '...' : '↻'}
            </button>
          ) : (
            <span className={r.status === 'win' ? 'outcome-win' : 'outcome-lose'}>
              {r.score} {r.status === 'win' ? '✓' : '✗'}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
