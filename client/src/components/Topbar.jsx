export default function Topbar({ mainTab, setMainTab, showLeagues, setShowLeagues }) {
  return (
    <header className="topbar">
      <div className="logo">
        <span className="logo-icon">⚽</span>
        <span className="logo-text">Football AI</span>
      </div>
      <nav className="main-nav">
        <button
          className={"nav-btn " + (mainTab === 'btts' && !showLeagues ? 'active-btts' : '')}
          onClick={() => { setMainTab('btts'); setShowLeagues(false); }}
        >🔵 BTTS</button>
        <button
          className={"nav-btn " + (mainTab === 'draw' && !showLeagues ? 'active-draw' : '')}
          onClick={() => { setMainTab('draw'); setShowLeagues(false); }}
        >🟡 Draw</button>
        <button
          className={"nav-btn " + (mainTab === 'live' && !showLeagues ? 'active-live' : '')}
          onClick={() => { setMainTab('live'); setShowLeagues(false); }}
        >🔴 Live</button>
      </nav>
      <button
        className={"leagues-btn " + (showLeagues ? 'active' : '')}
        onClick={() => setShowLeagues(!showLeagues)}
      >🏆 Leagues</button>
    </header>
  )
}
