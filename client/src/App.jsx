import { useState, useEffect } from 'react'
import Topbar       from './components/Topbar'
import BTTSTab      from './components/BTTSTab'
import DrawTab      from './components/DrawTab'
import LeaguesPanel from './components/LeaguesPanel'
import { api }      from './api'
import './App.css'

export default function App() {
  const [mainTab,     setMainTab]     = useState('btts')
  const [showLeagues, setShowLeagues] = useState(false)
  const [leagues,     setLeagues]     = useState([])   // flat list for AI Search

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
        {showLeagues && <LeaguesPanel onLeagueChange={loadLeagues} />}
        {!showLeagues && mainTab === 'btts' && <BTTSTab leagues={leagues} />}
        {!showLeagues && mainTab === 'draw' && <DrawTab leagues={leagues} />}
        {!showLeagues && mainTab === 'live' && (
          <div className="coming-soon">🔴 Live predictions — coming soon</div>
        )}
      </main>
    </div>
  )
}
