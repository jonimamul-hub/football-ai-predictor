import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

const MODES = {
  lbr: {
    icon:  '📚',
    label: 'LBR',
    placeholder: 'Ask about signals, quality levels, learning lifecycle, pattern discovery…',
    welcome: 'Ask about any signal — why it exists, whether its quality level seems right, what patterns are worth building, or how the learning system calibrates over time.',
  },
  analysis: {
    icon:  '🔬',
    label: 'Analysis',
    placeholder: 'Enter a match to analyze, or ask about a prediction…',
    welcome: 'Enter a match (e.g. "Liverpool vs Arsenal, Premier League") and ask for a BTTS or Draw analysis. Or discuss any prediction — signals applied, confidence, verdict reasoning.',
  },
}

export default function AIAssistant() {
  const [mode,     setMode]     = useState('analysis')  // 'lbr' | 'analysis'
  const [messages, setMessages] = useState([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [criteria, setCriteria] = useState('')
  const [showCrit, setShowCrit] = useState(false)

  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Clear chat when mode changes
  function switchMode(m) {
    setMode(m)
    setMessages([])
    setInput('')
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { id: Date.now(), role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setLoading(true)

    try {
      const aiMessages = history.map(m => ({ role: m.role, content: m.content }))
      const { reply }  = await api.askAssistant(aiMessages, criteria, mode)
      setMessages(prev => [...prev, {
        id:      Date.now() + 1,
        role:    'assistant',
        content: reply,
        mode,
      }])
    } catch (e) {
      setMessages(prev => [...prev, {
        id:      Date.now() + 1,
        role:    'assistant',
        content: `Error: ${e.message}`,
        mode:    'error',
      }])
    } finally {
      setLoading(false)
    }
  }

  const m = MODES[mode]

  return (
    <div className="ai-assistant">

      {/* ── Mode selector ────────────────────────────────────────────── */}
      <div className="aia-modebar">
        <div className="aia-mode-btns">
          {Object.entries(MODES).map(([key, cfg]) => (
            <button
              key={key}
              className={`aia-mode-btn${mode === key ? ' active' : ''}`}
              onClick={() => switchMode(key)}
            >
              {cfg.icon} {cfg.label}
            </button>
          ))}
        </div>
        <button className="aia-crit-btn" onClick={() => setShowCrit(v => !v)}>
          ⚙ Context
        </button>
      </div>

      {/* ── Context panel ────────────────────────────────────────────── */}
      {showCrit && (
        <div className="aia-criteria-panel">
          <label className="aia-criteria-label">
            Additional context — prepended to every query in this mode
          </label>
          <textarea
            className="aia-criteria-input"
            value={criteria}
            onChange={e => setCriteria(e.target.value)}
            placeholder={
              mode === 'lbr'
                ? 'e.g. Focus on Premier League signals. Ignore stats older than 2 seasons.'
                : 'e.g. Only consider Serie A matches. Treat BTTS signals as primary.'
            }
            rows={3}
          />
        </div>
      )}

      {/* ── Messages ─────────────────────────────────────────────────── */}
      <div className="aia-messages">
        {messages.length === 0 && (
          <div className="aia-welcome">
            <div className="aia-welcome-icon">{m.icon}</div>
            <div className="aia-welcome-title">
              {m.label} Mode
            </div>
            <div className="aia-welcome-sub">{m.welcome}</div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`aia-msg aia-msg-${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="aia-msg-header">
                <span className={`aia-source-badge aia-src-${msg.mode === 'error' ? 'error' : 'claude'}`}>
                  {msg.mode === 'error'
                    ? '⚠ Error'
                    : `🧠 Claude · ${MODES[msg.mode]?.icon} ${MODES[msg.mode]?.label}`}
                </span>
              </div>
            )}
            <div className="aia-msg-body">{msg.content}</div>
          </div>
        ))}

        {loading && (
          <div className="aia-msg aia-msg-assistant">
            <div className="aia-msg-header">
              <span className="aia-source-badge aia-src-thinking">⟳ Thinking…</span>
            </div>
            <div className="aia-msg-body aia-thinking-body" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ────────────────────────────────────────────────────── */}
      <div className="aia-input-bar">
        <textarea
          className="aia-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={m.placeholder}
          rows={2}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
          }}
        />
        <button
          className="aia-send-btn"
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          title="Send (Enter)"
        >
          {loading ? '⟳' : '↗'}
        </button>
      </div>

    </div>
  )
}
