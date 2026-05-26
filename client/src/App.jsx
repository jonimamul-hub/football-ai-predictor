import { useState } from 'react'
import Topbar from './components/Topbar'
import BTTSTab from './components/BTTSTab'
import DrawTab from './components/DrawTab'
import LeaguesPanel from './components/LeaguesPanel'
import './App.css'

export default function App() {
  const [mainTab, setMainTab] = useState('btts')
  const [showLeagues, setShowLeagues] = useState(false)

  return (
    <div className="app">
      <Topbar
        mainTab={mainTab}
        setMainTab={setMainTab}
        showLeagues={showLeagues}
        setShowLeagues={setShowLeagues}
      />
      <main className="main-content">
        {showLeagues && <LeaguesPanel />}
        {!showLeagues && mainTab === 'btts' && <BTTSTab />}
        {!showLeagues && mainTab === 'draw' && <DrawTab />}
        {!showLeagues && mainTab === 'live' && (
          <div className="coming-soon">Live — Phase 6</div>
        )}
      </main>
    </div>
  )
}
