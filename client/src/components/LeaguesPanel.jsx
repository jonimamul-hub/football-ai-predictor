import { useState } from 'react'

export default function LeaguesPanel() {
  const [countries, setCountries] = useState([
    { id: 'england', name: 'England', emoji: '🏴', leagues: ['Premier League', 'Championship'], open: true },
    { id: 'spain', name: 'Spain', emoji: '🇪🇸', leagues: ['La Liga'], open: false },
  ])
  const [newCountry, setNewCountry] = useState('')
  const [newLeagues, setNewLeagues] = useState({})

  const addCountry = () => {
    if (!newCountry.trim()) return
    const emojis = { england: '🏴', spain: '🇪🇸', germany: '🇩🇪', france: '🇫🇷', italy: '🇮🇹', georgia: '🇬🇪', portugal: '🇵🇹' }
    const id = newCountry.toLowerCase().replace(/\s+/g, '-')
    if (countries.find(c => c.id === id)) return
    setCountries([...countries, { id, name: newCountry, emoji: emojis[newCountry.toLowerCase()] || '🌍', leagues: [], open: true }])
    setNewCountry('')
  }

  const toggleCountry = (id) => {
    setCountries(countries.map(c => c.id === id ? { ...c, open: !c.open } : c))
  }

  const addLeague = (countryId) => {
    const val = (newLeagues[countryId] || '').trim()
    if (!val) return
    setCountries(countries.map(c => c.id === countryId ? { ...c, leagues: [...c.leagues, val] } : c))
    setNewLeagues({ ...newLeagues, [countryId]: '' })
  }

  const removeLeague = (countryId, league) => {
    setCountries(countries.map(c => c.id === countryId ? { ...c, leagues: c.leagues.filter(l => l !== league) } : c))
  }

  return (
    <div className="leagues-panel">
      <div className="add-country-row">
        <input
          value={newCountry}
          onChange={e => setNewCountry(e.target.value)}
          placeholder="Add country (e.g. Georgia)"
          onKeyDown={e => e.key === 'Enter' && addCountry()}
        />
        <button onClick={addCountry}>+ Add Country</button>
      </div>
      {countries.map(c => (
        <div key={c.id} className="country-block">
          <div className="country-header" onClick={() => toggleCountry(c.id)}>
            <span>{c.emoji}</span>
            <span className="country-name">{c.name}</span>
            <span className="country-count">{c.leagues.length} leagues</span>
            <span className={"chev " + (c.open ? 'open' : '')}>›</span>
          </div>
          {c.open && (
            <div className="leagues-inner">
              {c.leagues.map(l => (
                <div key={l} className="league-row">
                  <span>{l}</span>
                  <span className="st-ready">Ready</span>
                  <button className="del-btn" onClick={() => removeLeague(c.id, l)}>×</button>
                </div>
              ))}
              <div className="add-league-row">
                <input
                  value={newLeagues[c.id] || ''}
                  onChange={e => setNewLeagues({ ...newLeagues, [c.id]: e.target.value })}
                  placeholder="Add league..."
                  onKeyDown={e => e.key === 'Enter' && addLeague(c.id)}
                />
                <button onClick={() => addLeague(c.id)}>+ Add</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
