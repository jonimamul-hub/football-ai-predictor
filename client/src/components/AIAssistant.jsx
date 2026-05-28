import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

const MODES = {
  lbr: {
    icon:  '📚',
    label: 'LBR',
  },
  analysis: {
    icon:  '🔬',
    label: 'Analysis',
  },
  council: {
    icon:  '⚖️',
    label: 'Council',
  },
}

export default function AIAssistant() {
  const [messages, setMessages] = useState([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [criteria, setCriteria] = useState('')
  const [showCrit, setShowCrit] = useState(false)

  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function sendMessage(selectedMode) {
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { id: Date.now(), role: 'user', content: text, sentWith: selectedMode }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setLoading(true)

    try {
      const aiMessages = history.map(m => ({ role: m.role, content: m.content }))

      if (selectedMode === 'council') {
        // Step 1: LBR responds
        const { reply: lbrReply } = await api.askAssistant(aiMessages, criteria, 'lbr')
        const lbrMsg = {
          id:   Date.now() + 1,
          role: 'assistant',
          content: lbrReply,
          mode: 'lbr',
        }
        setMessages(prev => [...prev, lbrMsg])

        // Step 2: Analysis sees LBR's response and adds its own
        const msgsWithLbr = [...aiMessages, { role: 'assistant', content: lbrReply }]
        const { reply: anaReply } = await api.askAssistant(msgsWithLbr, criteria, 'analysis')
        setMessages(prev => [...prev, {
          id:      Date.now() + 2,
          role:    'assistant',
          content: anaReply,
          mode:    'analysis',
        }])
      } else {
        const { reply } = await api.askAssistant(aiMessages, criteria, selectedMode)
        setMessages(prev => [...prev, {
          id:      Date.now() + 1,
          role:    'assistant',
          content: reply,
          mode:    selectedMode,
        }])
      }
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

  return (
    <div className="ai-assistant">

      {/* ── Context toggle ───────────────────────────────────────────── */}
      <div className="aia-modebar">
        <span className="aia-modebar-hint">Select a mode to send your message:</span>
        <button className="aia-crit-btn" onClick={() => setShowCrit(v => !v)}>
          ⚙ Context
        </button>
      </div>

      {/* ── Context panel ────────────────────────────────────────────── */}
      {showCrit && (
        <div className="aia-criteria-panel">
          <label className="aia-criteria-label">
            Additional context — prepended to every query
          </label>
          <textarea
            className="aia-criteria-input"
            value={criteria}
            onChange={e => setCriteria(e.target.value)}
            placeholder="e.g. Focus on Premier League. Treat BTTS signals as primary."
            rows={3}
          />
        </div>
      )}

      {/* ── Messages ─────────────────────────────────────────────────── */}
      <div className="aia-messages">
        {messages.length === 0 && (
          <div className="aia-welcome">
            <div className="aia-welcome-icon">🤖</div>
            <div className="aia-welcome-title">AI Assistant</div>
            <div className="aia-welcome-sub">
              Type a message and choose how to send it:<br />
              <strong>📚 LBR</strong> — signal research &amp; learning lifecycle<br />
              <strong>🔬 Analysis</strong> — match predictions &amp; verdict reasoning<br />
              <strong>⚖️ Council</strong> — both respond: LBR first, then Analysis
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`aia-msg aia-msg-${msg.role}`}>
            {msg.role === 'user' && (
              <div className="aia-msg-header">
                <span className={`aia-source-badge aia-src-user-${msg.sentWith}`}>
                  {MODES[msg.sentWith]
                    ? `${MODES[msg.sentWith].icon} ${MODES[msg.sentWith].label}`
                    : '💬 You'}
                </span>
              </div>
            )}
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

      {/* ── Input + send buttons ──────────────────────────────────────── */}
      <div className="aia-input-bar">
        <textarea
          className="aia-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type your message, then choose a mode to send…"
          rows={2}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage('analysis') }
          }}
        />
        <div className="aia-send-btns">
          <button
            className="aia-send-btn aia-send-lbr"
            onClick={() => sendMessage('lbr')}
            disabled={loading || !input.trim()}
            title="Send to LBR"
          >
            {loading ? '⟳' : '📚'}
          </button>
          <button
            className="aia-send-btn aia-send-analysis"
            onClick={() => sendMessage('analysis')}
            disabled={loading || !input.trim()}
            title="Send to Analysis (Enter)"
          >
            {loading ? '⟳' : '🔬'}
          </button>
          <button
            className="aia-send-btn aia-send-council"
            onClick={() => sendMessage('council')}
            disabled={loading || !input.trim()}
            title="Send to Council (LBR + Analysis)"
          >
            {loading ? '⟳' : '⚖️'}
          </button>
        </div>
      </div>

    </div>
  )
}
