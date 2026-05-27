import { useState, useEffect } from 'react'
import { api } from '../api'

const COUNTRY_EMOJI = {
  england: '🏴', spain: '🇪🇸', germany: '🇩🇪', france: '🇫🇷',
  italy: '🇮🇹', georgia: '🇬🇪', portugal: '🇵🇹', netherlands: '🇳🇱',
  turkey: '🇹🇷', russia: '🇷🇺', brazil: '🇧🇷', argentina: '🇦🇷',
  usa: '🇺🇸', scotland: '🏴', belgium: '🇧🇪', greece: '🇬🇷',
}

function getEmoji(country) {
  return COUNTRY_EMOJI[country.toLowerCase()] || '🌍'
}

function LbrStatus({ status, signalCount }) {
  const map = {
    pending: { cls: 'lbr-pending', label: '⏳ LBR pending' },
    running: { cls: 'lbr-running', label: '🔄 LBR running…' },
    failed:  { cls: 'lbr-failed',  label: '❌ LBR failed'  },
    done:    { cls: 'lbr-done',    label: `✅ ${signalCount || 0} signals` },
  }
  const s = map[status]
  if (!s) return null
  return <span className={`lbr-pill ${s.cls}`}>{s.label}</span>
}

// Date/tz controls now live in Topbar — LeaguesPanel only manages league CRUD
export default function LeaguesPanel({ onLeagueChange }) {
  const [countries,  setCountries]  = useState([])
  const [newCountry, setNewCountry] = useState('')
  const [newLeagues, setNewLeagues] = useState({})
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    loadLeagues()
    const iv = setInterval(() => {
      setCountries(c => {
        const needsPoll = c.some(ct =>
          ct.leagues.some(l => l.lbr_status === 'running' || l.lbr_status === 'pending')
        )
        if (needsPoll) loadLeagues()
        return c
      })
    }, 5000)
    return () => clearInterval(iv)
  }, [])

  async function loadLeagues() {
    try {
      const { leagues } = await api.getLeagues()
      const grouped = {}
      for (const l of leagues) {
        if (!grouped[l.country]) {
          grouped[l.country] = { name: l.country, emoji: l.emoji, leagues: [], open: false }
        }
        grouped[l.country].leagues.push(l)
      }
      setCountries(Object.values(grouped))
    } catch (e) {
      console.error('Failed to load leagues:', e)
    } finally {
      setLoading(false)
    }
  }

  const addCountry = () => {
    const name = newCountry.trim()
    if (!name) return
    if (countries.find(c => c.name.toLowerCase() === name.toLowerCase())) return
    setCountries([...countries, { name, emoji: getEmoji(name), leagues: [], open: true }])
    setNewCountry('')
  }

  const toggleCountry = (name) => {
    setCountries(countries.map(c => c.name === name ? { ...c, open: !c.open } : c))
  }

  const removeCountry = async (countryName) => {
    const country = countries.find(c => c.name === countryName)
    if (!country) return
    setCountries(prev => prev.filter(c => c.name !== countryName))
    try {
      await Promise.all(country.leagues.map(l => api.deleteLeague(l.id)))
    } catch (e) {
      console.error('Delete country failed:', e)
      loadLeagues()
    }
  }

  const addLeague = async (countryName) => {
    const val = (newLeagues[countryName] || '').trim()
    if (!val) return
    const country = countries.find(c => c.name === countryName)
    if (!country) return

    const tempId = `temp-${Date.now()}`
    setCountries(countries.map(c =>
      c.name === countryName
        ? { ...c, leagues: [...c.leagues, { id: tempId, name: val, country: countryName, lbr_status: 'pending' }] }
        : c
    ))
    setNewLeagues({ ...newLeagues, [countryName]: '' })

    try {
      await api.addLeague({ country: countryName, name: val, emoji: getEmoji(countryName) })
      loadLeagues()
      if (onLeagueChange) onLeagueChange()
    } catch (e) {
      console.error('Add league failed:', e)
      setCountries(countries.map(c =>
        c.name === countryName
          ? { ...c, leagues: c.leagues.filter(l => l.id !== tempId) }
          : c
      ))
    }
  }

  const removeLeague = async (leagueId, countryName, leagueName) => {
    setCountries(countries.map(c =>
      c.name === countryName
        ? { ...c, leagues: c.leagues.filter(l => l.id !== leagueId && l.name !== leagueName) }
        : c
    ))
    try {
      await api.deleteLeague(leagueId)
    } catch (e) {
      console.error('Delete failed:', e)
      loadLeagues()
    }
  }

  if (loading) {
    return (
      <div className="leagues-panel">
        <div className="loading-state">
          <div className="spinner">⟳</div>
          <p>Loading leagues…</p>
        </div>
      </div>
    )
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

      {countries.length === 0 && (
        <div className="empty-state" style={{ padding: '2rem' }}>
          <p>No countries yet — add one above</p>
        </div>
      )}

      {countries.map(c => (
        <div key={c.name} className="country-block">
          <div className="country-header" onClick={() => toggleCountry(c.name)}>
            <span>{c.emoji}</span>
            <span className="country-name">{c.name}</span>
            <span className="country-count">{c.leagues.length} leagues</span>
            <span className={"chev " + (c.open ? 'open' : '')}>›</span>
            <button
              className="del-btn country-del-btn"
              title="Delete country and all its leagues"
              onClick={e => { e.stopPropagation(); removeCountry(c.name) }}
            >×</button>
          </div>

          {c.open && (
            <div className="leagues-inner">
              {c.leagues.map(l => (
                <div key={l.id} className="league-row">
                  <span>{l.name}</span>
                  <LbrStatus status={l.lbr_status} signalCount={l.signal_count} />
                  <button
                    className="del-btn"
                    onClick={() => removeLeague(l.id, c.name, l.name)}
                  >×</button>
                </div>
              ))}
              <div className="add-league-row">
                <input
                  value={newLeagues[c.name] || ''}
                  onChange={e => setNewLeagues({ ...newLeagues, [c.name]: e.target.value })}
                  placeholder="Add league…"
                  onKeyDown={e => e.key === 'Enter' && addLeague(c.name)}
                />
                <button onClick={() => addLeague(c.name)}>+ Add</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
