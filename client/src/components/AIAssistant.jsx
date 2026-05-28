import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import { checkOllamaAvailable, askOllama } from '../ollama_agent'

export default function AIAssistant() {
  // ── Ollama status ─────────────────────────────────────────────────────
  const [ollamaStatus,  setOllamaStatus]  = useState('checking') // checking|online|offline|remote
  const [ollamaModels,  setOllamaModels]  = useState([])
  const [selectedModel, setSelectedModel] = useState('')

  // ── Chat state ────────────────────────────────────────────────────────
  const [messages,  setMessages]  = useState([])  // {id,role,content,source,saved}
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)

  // ── Panels ────────────────────────────────────────────────────────────
  const [criteria,     setCriteria]     = useState('')
  const [showCriteria, setShowCriteria] = useState(false)
  const [knowledge,    setKnowledge]    = useState([])
  const [showKB,       setShowKB]       = useState(false)

  const bottomRef = useRef(null)

  useEffect(() => {
    checkOllama()
    loadKnowledge()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // ── Ollama ────────────────────────────────────────────────────────────
  async function checkOllama() {
    setOllamaStatus('checking')
    const { available, models, reason } = await checkOllamaAvailable()
    setOllamaStatus(available ? 'online' : (reason || 'offline'))
    setOllamaModels(models)
    if (models.length > 0) setSelectedModel(models[0])
  }

  // ── Knowledge base ────────────────────────────────────────────────────
  async function loadKnowledge() {
    try {
      const { items } = await api.getKnowledge()
      setKnowledge(items || [])
    } catch (e) {
      console.error('Failed to load knowledge:', e)
    }
  }

  async function saveToKnowledge(msg) {
    const msgIdx  = messages.findIndex(m => m.id === msg.id)
    const prevUser = [...messages].slice(0, msgIdx).reverse().find(m => m.role === 'user')
    const topic    = (prevUser?.content || 'General').slice(0, 120)
    try {
      await api.addKnowledge({ topic, content: msg.content, source: msg.source })
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, saved: true } : m))
      loadKnowledge()
    } catch (e) {
      console.error('Save knowledge failed:', e)
    }
  }

  async function toggleApprove(item) {
    await api.updateKnowledge(item.id, { approved: !item.approved }).catch(console.error)
    setKnowledge(prev => prev.map(k => k.id === item.id ? { ...k, approved: !k.approved } : k))
  }

  async function deleteKnowledge(id) {
    await api.deleteKnowledge(id).catch(console.error)
    setKnowledge(prev => prev.filter(k => k.id !== id))
  }

  // ── Send message ──────────────────────────────────────────────────────
  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { id: Date.now(), role: 'user', content: text, source: 'user' }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setLoading(true)

    try {
      // Build conversation for AI (only role + content)
      const aiMessages = history.map(m => ({ role: m.role, content: m.content }))

      // Fetch relevant approved knowledge for context
      const { items: kItems } = await api.getKnowledge(text).catch(() => ({ items: [] }))
      const knowledgeCtx = (kItems || [])
        .filter(k => k.approved)
        .map(k => `${k.topic}: ${k.content}`)
        .join('\n')
      const fullContext = [criteria, knowledgeCtx].filter(Boolean).join('\n\n')

      let reply  = ''
      let source = 'claude'

      // 1 — Try Ollama first (if available)
      if (ollamaStatus === 'online' && selectedModel) {
        try {
          const result = await askOllama(aiMessages, { model: selectedModel, context: fullContext })
          if (result.text) {
            reply  = result.text
            source = 'ollama'
          }
        } catch (e) {
          console.warn('Ollama failed, falling back to Claude:', e.message)
        }
      }

      // 2 — Fallback to Claude
      if (!reply) {
        const { reply: r } = await api.askAssistant(aiMessages, fullContext)
        reply  = r
        source = 'claude'
      }

      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'assistant', content: reply, source, saved: false,
      }])
    } catch (e) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'assistant',
        content: `Error: ${e.message}`, source: 'error', saved: false,
      }])
    } finally {
      setLoading(false)
    }
  }

  // ── Re-ask with Claude ────────────────────────────────────────────────
  async function askClaudeInstead(msgId) {
    const idx     = messages.findIndex(m => m.id === msgId)
    if (idx === -1) return
    const history = messages.slice(0, idx)   // everything before this AI reply
    const aiMessages = history.map(m => ({ role: m.role, content: m.content }))

    setLoading(true)
    try {
      const { reply } = await api.askAssistant(aiMessages, criteria)
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, content: reply, source: 'claude', saved: false } : m
      ))
    } catch (e) {
      console.error('Claude fallback failed:', e)
    } finally {
      setLoading(false)
    }
  }

  // ── Status helpers ────────────────────────────────────────────────────
  const dotColor    = { checking: '#888', online: '#4ade80', offline: '#f87171', remote: '#f5a623' }[ollamaStatus] || '#888'
  const statusLabel = { checking: 'Checking…', online: 'Online', offline: 'Offline', remote: 'Local only' }[ollamaStatus] || '—'

  return (
    <div className="ai-assistant">

      {/* ── Status bar ───────────────────────────────────────────────── */}
      <div className="aia-statusbar">
        <div className="aia-agent-status">
          <span className="aia-dot" style={{ background: dotColor }} />
          <span className="aia-agent-label">Ollama</span>
          <span className="aia-agent-val">{statusLabel}</span>
          {ollamaStatus === 'online' && ollamaModels.length > 0 && (
            <select
              className="aia-model-sel"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
            >
              {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <button className="aia-refresh-btn" onClick={checkOllama} title="Recheck Ollama">↺</button>
        </div>
        <div className="aia-statusbar-right">
          <button className="aia-kb-btn" onClick={() => setShowKB(v => !v)}>
            📚 Knowledge ({knowledge.length})
          </button>
          <button className="aia-crit-btn" onClick={() => setShowCriteria(v => !v)}>
            ⚙ Criteria
          </button>
        </div>
      </div>

      {/* ── Ollama setup note ─────────────────────────────────────────── */}
      {ollamaStatus === 'remote' && (
        <div className="aia-setup-note">
          ℹ Ollama is only available when accessing the app from localhost.
          On the Railway URL the browser origin is blocked by Ollama's CORS policy — Claude will answer instead.
        </div>
      )}
      {ollamaStatus === 'offline' && (
        <div className="aia-setup-note">
          ⚠ Ollama not detected at localhost:11434. Start it with:&nbsp;
          <code>OLLAMA_ORIGINS=http://localhost:5173 ollama serve</code> — Claude will answer in the meantime.
        </div>
      )}

      {/* ── Criteria panel ───────────────────────────────────────────── */}
      {showCriteria && (
        <div className="aia-criteria-panel">
          <label className="aia-criteria-label">Additional Criteria — prepended to every query</label>
          <textarea
            className="aia-criteria-input"
            value={criteria}
            onChange={e => setCriteria(e.target.value)}
            placeholder="e.g. Focus only on top-5 European leagues. Ignore cup matches. Prioritise home form."
            rows={3}
          />
        </div>
      )}

      {/* ── Knowledge base panel ─────────────────────────────────────── */}
      {showKB && (
        <div className="aia-kb-panel">
          {knowledge.length === 0 ? (
            <div className="aia-kb-empty">No knowledge saved yet — save AI answers below</div>
          ) : (
            knowledge.map(k => (
              <div key={k.id} className={`aia-kb-item${k.approved ? ' aia-kb-approved' : ''}`}>
                <div className="aia-kb-topic">{k.topic}</div>
                <div className="aia-kb-content">{k.content}</div>
                <div className="aia-kb-actions">
                  <span className="aia-kb-source">{k.source}</span>
                  <button
                    className={`aia-kb-approve${k.approved ? ' approved' : ''}`}
                    onClick={() => toggleApprove(k)}
                  >{k.approved ? '✓ Approved' : 'Approve'}</button>
                  <button className="aia-kb-del" onClick={() => deleteKnowledge(k.id)}>×</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Message thread ───────────────────────────────────────────── */}
      <div className="aia-messages">
        {messages.length === 0 && (
          <div className="aia-welcome">
            <div className="aia-welcome-icon">🤖</div>
            <div className="aia-welcome-title">Football AI Assistant</div>
            <div className="aia-welcome-sub">
              Ask about signals, patterns, predictions, or specific matches.
              {ollamaStatus === 'online'
                ? ` Ollama (${selectedModel}) answers first — Claude as fallback.`
                : ollamaStatus === 'remote'
                  ? ' Claude will answer (Ollama only works on localhost).'
                  : ' Claude will answer (Ollama offline).'}
              <br />Approved knowledge is automatically fed to Ollama as context.
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`aia-msg aia-msg-${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="aia-msg-header">
                <span className={`aia-source-badge aia-src-${msg.source}`}>
                  {msg.source === 'ollama' ? `🤖 Ollama (${selectedModel})` :
                   msg.source === 'claude' ? '🧠 Claude'                   : '⚠ Error'}
                </span>
              </div>
            )}
            <div className="aia-msg-body">{msg.content}</div>
            {msg.role === 'assistant' && msg.source !== 'error' && (
              <div className="aia-msg-actions">
                {msg.source === 'ollama' && !loading && (
                  <button className="aia-act-btn" onClick={() => askClaudeInstead(msg.id)}>
                    Ask Claude instead ↗
                  </button>
                )}
                {!msg.saved ? (
                  <button className="aia-act-btn aia-act-save" onClick={() => saveToKnowledge(msg)}>
                    💾 Save to Knowledge
                  </button>
                ) : (
                  <span className="aia-saved-label">✓ Saved</span>
                )}
              </div>
            )}
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

      {/* ── Input bar ────────────────────────────────────────────────── */}
      <div className="aia-input-bar">
        <textarea
          className="aia-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about signals, matches, patterns… (Enter to send, Shift+Enter for newline)"
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
