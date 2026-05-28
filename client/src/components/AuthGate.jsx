import { useState, useEffect } from 'react'
import { api } from '../api'

const TOKEN_KEY = 'football_ai_auth'

export default function AuthGate({ children }) {
  const [status,   setStatus]   = useState('checking') // 'checking' | 'authed' | 'login'
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    api.authCheck(token)
      .then(() => setStatus('authed'))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        setStatus('login')
      })
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    if (!password.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      const { token } = await api.authLogin(password)
      localStorage.setItem(TOKEN_KEY, token)
      setStatus('authed')
    } catch {
      setError('Wrong password')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'checking') {
    return <div className="auth-checking" />
  }

  if (status === 'login') {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <div className="auth-icon">⚽</div>
          <div className="auth-title">Football AI Predictor</div>
          <form className="auth-form" onSubmit={handleLogin}>
            <input
              className={`auth-input${error ? ' auth-input-err' : ''}`}
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              autoFocus
              autoComplete="current-password"
            />
            {error && <div className="auth-error">{error}</div>}
            <button
              className="auth-btn"
              type="submit"
              disabled={loading || !password.trim()}
            >
              {loading ? '…' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return children
}
