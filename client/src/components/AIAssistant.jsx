import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'

// ── localStorage helpers ───────────────────────────────────────────────────
const STORE_KEY = 'football_ai_sessions'

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { sessions: [], activeId: null }
  } catch {
    return { sessions: [], activeId: null }
  }
}
function saveStore(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)) } catch {}
}
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}
function autoName() {
  const d = new Date()
  return `Session ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
function newSession() {
  return { id: makeId(), name: autoName(), created_at: new Date().toISOString(), archived: false, messages: [] }
}

// ── Mode config ────────────────────────────────────────────────────────────
const MODES = {
  lbr:      { icon: '📚', label: 'LBR' },
  analysis: { icon: '🔬', label: 'Analysis' },
  council:  { icon: '⚖️', label: 'Council' },
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AIAssistant() {
  const [sessions,        setSessions]        = useState([])
  const [activeId,        setActiveId]        = useState(null)
  const [input,           setInput]           = useState('')
  const [loading,         setLoading]         = useState(false)
  const [criteria,        setCriteria]        = useState('')
  const [showCrit,        setShowCrit]        = useState(false)
  const [editingId,       setEditingId]       = useState(null)
  const [editName,        setEditName]        = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [showArchives,    setShowArchives]    = useState(false)
  const [sidebarOpen,     setSidebarOpen]     = useState(true)

  const bottomRef = useRef(null)
  const editRef   = useRef(null)

  // ── Load on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    const store = loadStore()
    let { sessions: stored, activeId: sid } = store
    if (!stored.length) {
      const s = newSession()
      stored = [s]; sid = s.id
    }
    if (!stored.find(s => s.id === sid)) {
      sid = stored.find(s => !s.archived)?.id || stored[0].id
    }
    setSessions(stored)
    setActiveId(sid)
  }, [])

  // ── Persist whenever sessions or activeId change ──────────────────────────
  useEffect(() => {
    if (!sessions.length) return
    saveStore({ sessions, activeId })
  }, [sessions, activeId])

  // ── Scroll to bottom ──────────────────────────────────────────────────────
  const messages = sessions.find(s => s.id === activeId)?.messages || []
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, loading])

  // ── Focus rename input ────────────────────────────────────────────────────
  useEffect(() => {
    if (editingId) editRef.current?.select()
  }, [editingId])

  // ── Update messages for active session ───────────────────────────────────
  const updateMessages = useCallback((msgs, forId) => {
    setSessions(prev => prev.map(s => s.id === (forId ?? activeId) ? { ...s, messages: msgs } : s))
  }, [activeId])

  // ── Session operations ────────────────────────────────────────────────────
  function handleNew() {
    const s = newSession()
    setSessions(prev => [s, ...prev])
    setActiveId(s.id)
    setInput('')
    setEditingId(null)
    setConfirmDeleteId(null)
  }

  function switchSession(id) {
    if (id === activeId || loading) return
    setActiveId(id)
    setInput('')
    setEditingId(null)
    setConfirmDeleteId(null)
  }

  function startRename(s, e) {
    e.stopPropagation()
    setEditingId(s.id)
    setEditName(s.name)
    setConfirmDeleteId(null)
  }

  function commitRename() {
    const name = editName.trim()
    if (name) setSessions(prev => prev.map(s => s.id === editingId ? { ...s, name } : s))
    setEditingId(null)
  }

  function toggleArchive(id, e) {
    e.stopPropagation()
    setConfirmDeleteId(null)
    setEditingId(null)
    setSessions(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, archived: !s.archived } : s)
      // If archiving the active session, switch to first non-archived
      if (id === activeId) {
        const next = updated.find(s => !s.archived && s.id !== id)
        if (next) {
          setActiveId(next.id)
        } else {
          const s = newSession()
          setActiveId(s.id)
          return [s, ...updated]
        }
      }
      return updated
    })
  }

  function requestDelete(id, e) {
    e.stopPropagation()
    setEditingId(null)
    setConfirmDeleteId(id === confirmDeleteId ? null : id)
  }

  function doDelete(id, e) {
    e.stopPropagation()
    const remaining = sessions.filter(s => s.id !== id)
    if (id === activeId) {
      const next = remaining.find(s => !s.archived) || remaining[0]
      if (next) {
        setActiveId(next.id)
      } else {
        const s = newSession()
        setSessions([s])
        setActiveId(s.id)
        setConfirmDeleteId(null)
        return
      }
    }
    setSessions(remaining)
    setConfirmDeleteId(null)
  }

  // ── Send message ──────────────────────────────────────────────────────────
  async function sendMessage(selectedMode) {
    const text = input.trim()
    if (!text || loading) return

    const capturedId = activeId   // capture in case user switches mid-flight
    const userMsg    = { id: Date.now(), role: 'user', content: text, sentWith: selectedMode }
    const base       = [...messages, userMsg]
    updateMessages(base, capturedId)
    setInput('')
    setLoading(true)

    try {
      const aiMsgs = base.map(m => ({ role: m.role, content: m.content }))

      if (selectedMode === 'council') {
        // Step 1: LBR
        const { reply: lbrReply } = await api.askAssistant(aiMsgs, criteria, 'lbr')
        const lbrMsg  = { id: Date.now() + 1, role: 'assistant', content: lbrReply, mode: 'lbr' }
        const afterLbr = [...base, lbrMsg]
        updateMessages(afterLbr, capturedId)

        // Step 2: Analysis sees LBR reply
        const msgsWithLbr = [...aiMsgs, { role: 'assistant', content: lbrReply }]
        const { reply: anaReply } = await api.askAssistant(msgsWithLbr, criteria, 'analysis')
        const anaMsg = { id: Date.now() + 2, role: 'assistant', content: anaReply, mode: 'analysis' }
        updateMessages([...afterLbr, anaMsg], capturedId)
      } else {
        const { reply } = await api.askAssistant(aiMsgs, criteria, selectedMode)
        updateMessages([...base, { id: Date.now() + 1, role: 'assistant', content: reply, mode: selectedMode }], capturedId)
      }
    } catch (e) {
      updateMessages([...base, { id: Date.now() + 1, role: 'assistant', content: `Error: ${e.message}`, mode: 'error' }], capturedId)
    } finally {
      setLoading(false)
    }
  }

  // ── Sidebar session item ──────────────────────────────────────────────────
  function SessionItem({ s }) {
    const isActive  = s.id === activeId
    const isEditing = s.id === editingId
    const isConfirm = s.id === confirmDeleteId
    return (
      <div
        className={`aia-session-item${isActive ? ' active' : ''}`}
        onClick={() => switchSession(s.id)}
      >
        {isEditing ? (
          <input
            ref={editRef}
            className="aia-session-rename"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') setEditingId(null)
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="aia-session-name" title={s.name}>{s.name}</span>
        )}

        {!isEditing && (
          <div className="aia-session-actions">
            <button className="aia-sess-btn" title="Rename" onClick={e => startRename(s, e)}>✏️</button>
            <button
              className={`aia-sess-btn${s.archived ? ' aia-sess-unarchive' : ''}`}
              title={s.archived ? 'Unarchive' : 'Archive'}
              onClick={e => toggleArchive(s.id, e)}
            >
              {s.archived ? '📤' : '🗄️'}
            </button>
            {isConfirm ? (
              <>
                <button className="aia-sess-btn aia-sess-confirm" title="Confirm delete" onClick={e => doDelete(s.id, e)}>✓</button>
                <button className="aia-sess-btn" title="Cancel" onClick={e => { e.stopPropagation(); setConfirmDeleteId(null) }}>✕</button>
              </>
            ) : (
              <button className="aia-sess-btn aia-sess-delete" title="Delete" onClick={e => requestDelete(s.id, e)}>🗑️</button>
            )}
          </div>
        )}
      </div>
    )
  }

  const activeSessions  = sessions.filter(s => !s.archived)
  const archivedSessions = sessions.filter(s =>  s.archived)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="ai-assistant">

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <div className={`aia-sidebar${sidebarOpen ? '' : ' collapsed'}`}>
        <div className="aia-sidebar-header">
          {sidebarOpen && <span className="aia-sidebar-title">Sessions</span>}
          <button className="aia-sidebar-toggle" onClick={() => setSidebarOpen(v => !v)} title={sidebarOpen ? 'Collapse' : 'Expand'}>
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {sidebarOpen && (
          <>
            <button className="aia-new-session-btn" onClick={handleNew}>
              + New Session
            </button>

            <div className="aia-session-list">
              {activeSessions.map(s => <SessionItem key={s.id} s={s} />)}
              {activeSessions.length === 0 && (
                <div className="aia-session-empty">No sessions yet</div>
              )}
            </div>

            {archivedSessions.length > 0 && (
              <>
                <button
                  className="aia-archives-toggle"
                  onClick={() => setShowArchives(v => !v)}
                >
                  {showArchives ? '▾' : '▸'} Archives ({archivedSessions.length})
                </button>
                {showArchives && (
                  <div className="aia-session-list aia-archived-list">
                    {archivedSessions.map(s => <SessionItem key={s.id} s={s} />)}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Main chat area ─────────────────────────────────────────────── */}
      <div className="aia-main">

        {/* Context bar */}
        <div className="aia-modebar">
          <span className="aia-modebar-hint">Choose a mode button to send your message</span>
          <button className="aia-crit-btn" onClick={() => setShowCrit(v => !v)}>
            ⚙ Context
          </button>
        </div>

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

        {/* Messages */}
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

        {/* Input bar */}
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
            <button className="aia-send-btn aia-send-lbr"      onClick={() => sendMessage('lbr')}      disabled={loading || !input.trim()} title="Send to LBR">{loading ? '⟳' : '📚'}</button>
            <button className="aia-send-btn aia-send-analysis"  onClick={() => sendMessage('analysis')}  disabled={loading || !input.trim()} title="Send to Analysis (Enter)">{loading ? '⟳' : '🔬'}</button>
            <button className="aia-send-btn aia-send-council"   onClick={() => sendMessage('council')}   disabled={loading || !input.trim()} title="Send to Council">{loading ? '⟳' : '⚖️'}</button>
          </div>
        </div>

      </div>
    </div>
  )
}
