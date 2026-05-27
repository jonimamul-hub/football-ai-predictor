import { useState, useEffect } from 'react'
import Topbar       from './components/Topbar'
import BTTSTab      from './components/BTTSTab'
import DrawTab      from './components/DrawTab'
import LeaguesPanel from './components/LeaguesPanel'
import { api }      from './api'
import './App.css'

// Compute today's date in a given UTC offset (e.g. +4 for UTC+4)
function todayInTz(offsetHours) {
  const now   = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const tzDate = new Date(utcMs + offsetHours * 3600000)
  return tzDate.toISOString().split('T')[0]   // YYYY-MM-DD
}

export default function App() {
  const [mainTab,     setMainTab]     = useState('btts')
  const [showLeagues, setShowLeagues] = useState(false)
  const [leagues,     setLeagues]     = useState([])   // flat list for AI Search

  // ── Global search date + timezone (shared between LeaguesPanel and Recommendation)
  const [searchDate, setSearchDate] = useState(() => todayInTz(4))   // YYYY-MM-DD
  const [searchTz,   setSearchTz]   = useState(4)                     // UTC offset number

  // Load leagues once on mount so Recommendation can search them
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
      />
      <main className="main-content">
        {showLeagues && (
          <LeaguesPanel
            onLeagueChange={loadLeagues}
            searchDate={searchDate}
            setSearchDate={setSearchDate}
            searchTz={searchTz}
            setSearchTz={setSearchTz}
          />
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
