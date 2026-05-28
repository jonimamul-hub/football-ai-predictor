import { useState, useEffect } from 'react'

// ── Timezone string helpers ──────────────────────────────────────────────────
// 4 → "UTC+4",  -3 → "UTC-3",  0 → "UTC+0",  5.5 → "UTC+5.5"
function tzToStr(offset) {
  if (offset == null || isNaN(offset)) return 'UTC+4'
  return offset >= 0 ? `UTC+${offset}` : `UTC${offset}`
}

// "UTC+4" → 4,  "UTC-3" → -3,  "+4" → 4,  "4" → 4
// Returns null if not parseable or out of valid range
function parseTzStr(str) {
  const s = str.trim().toUpperCase()
  // Full "UTC+N" or "UTC-N" or "UTC+N.5" form
  const m1 = s.match(/^UTC([+-]?\d{1,2}(?:\.\d+)?)$/)
  if (m1) {
    const n = parseFloat(m1[1])
    return n >= -12 && n <= 14 ? n : null
  }
  // Bare "+N", "-N", "N" form
  const m2 = s.match(/^([+-]?\d{1,2}(?:\.\d+)?)$/)
  if (m2) {
    const n = parseFloat(m2[1])
    return n >= -12 && n <= 14 ? n : null
  }
  return null
}

export default function Topbar({
  mainTab, setMainTab,
  showLeagues, setShowLeagues,
  searchDate, setSearchDate,
  searchTz,   setSearchTz,
}) {
  // Local string state so the user can type freely before we parse
  const [tzInput, setTzInput] = useState(() => tzToStr(searchTz))

  // Keep in sync when parent changes searchTz (e.g. initial auto-detect)
  useEffect(() => { setTzInput(tzToStr(searchTz)) }, [searchTz])

  return (
    <header className="topbar">

      {/* ── Left: logo + date/tz ────────────────────────────────────────── */}
      <div className="topbar-left">
        <div className="logo">
          <span className="logo-icon">⚽</span>
          <span className="logo-text">Football AI</span>
        </div>

        <div className="topbar-datetime">
          <input
            type="date"
            className="date-input"
            value={searchDate || ''}
            onChange={e => setSearchDate(e.target.value)}
            title="Match date to search"
          />
          <input
            type="text"
            className="tz-input"
            value={tzInput}
            placeholder="UTC+4"
            title="Timezone — type UTC+4, UTC-3, UTC+0 …"
            onChange={e => {
              const raw = e.target.value
              setTzInput(raw)
              const n = parseTzStr(raw)
              if (n !== null) setSearchTz(n)
            }}
            onBlur={() => setTzInput(tzToStr(searchTz))}
          />
        </div>
      </div>

      {/* ── Centre: tab nav ────────────────────────────────────────────── */}
      <nav className="main-nav">
        <button
          className={"nav-btn " + (mainTab === 'btts' && !showLeagues ? 'active-btts' : '')}
          onClick={() => { setMainTab('btts'); setShowLeagues(false) }}
        >🔵 BTTS</button>
        <button
          className={"nav-btn " + (mainTab === 'draw' && !showLeagues ? 'active-draw' : '')}
          onClick={() => { setMainTab('draw'); setShowLeagues(false) }}
        >🟡 Draw</button>
        <button
          className={"nav-btn " + (mainTab === 'live' && !showLeagues ? 'active-live' : '')}
          onClick={() => { setMainTab('live'); setShowLeagues(false) }}
        >🔴 Live</button>
        <button
          className={"nav-btn " + (mainTab === 'assistant' && !showLeagues ? 'active-ai' : '')}
          onClick={() => { setMainTab('assistant'); setShowLeagues(false) }}
        >🤖 AI</button>
      </nav>

      {/* ── Right: leagues ─────────────────────────────────────────────── */}
      <button
        className={"leagues-btn " + (showLeagues ? 'active' : '')}
        onClick={() => setShowLeagues(!showLeagues)}
      >🏆 Leagues</button>

    </header>
  )
}
