import { useState, useEffect } from 'react'
import Topbar       from './components/Topbar'
import BTTSTab      from './components/BTTSTab'
import DrawTab      from './components/DrawTab'
import LeaguesPanel from './components/LeaguesPanel'
import { api }      from './api'
import './App.css'

// Auto-detect the browser's UTC offset (e.g. UTC+4 → 4, UTC-5 → -5)
// Handles fractional offsets like UTC+5:30 by rounding to nearest 0.5
function detectTzOffset() {
  try {
    const rawMinutes = -new Date().getTimezoneOffset()   // JS gives offset in reverse sign
    return rawMinutes / 60                               // exact (e.g. 5.5 for India)
  } catch {
    return 4   // fallback UTC+4
  }
}

// Get today's date string (YYYY-MM-DD) in the given UTC offset
function todayInTz(offsetHours) {
  const now    = new Date()
  const utcMs  = now.getTime() + now.getTimezoneOffset() * 60000
  const tzDate = new Date(utcMs + offsetHours * 3600000)
  return tzDate.toISOString().split('T')[0]
}

export default function App() {
  const [mainTab,     setMainTab]     = useState('btts')
  const [showLeagues, setShowLeagues] = useState(false)
  const [leagues,     setLeagues]     = useState([])

  // ── Global search date + timezone — auto-detected from browser on first load
  const [searchTz,   setSearchTz]   = useState(() => detectTzOffset())
  const [searchDate, setSearchDate] = useState(() => todayInTz(detectTzOffset()))

  useEffect(() => { loadLeagues() }, [])

  async function loadLeagues() {
    try {
      const { leagues: rows } = await api.getLeagues()
      setLeagues(rows)
    } catch (e) {
      console.error('App: failed to load leagues', e)
    }
  }

  return (
    <div className="app">
      <Topbar
        mainTab={mainTab}
        setMainTab={setMainTab}
        showLeagues={showLeagues}
        setShowLeagues={setShowLeagues}
        searchDate={searchDate}
        setSearchDate={setSearchDate}
        searchTz={searchTz}
        setSearchTz={setSearchTz}
      />
      <main className="main-content">
        {showLeagues && (
          <LeaguesPanel onLeagueChange={loadLeagues} />
        )}
        {!showLeagues && mainTab === 'btts' && (
          <BTTSTab leagues={leagues} searchDate={searchDate} searchTz={searchTz} />
        )}
        {!showLeagues && mainTab === 'draw' && (
          <DrawTab leagues={leagues} searchDate={searchDate} searchTz={searchTz} />
        )}
        {!showLeagues && mainTab === 'live' && (
          <div className="coming-soon">🔴 Live predictions — coming soon</div>
        )}
      </main>
    </div>
  )
}
