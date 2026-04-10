import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Send, Plus, Trash2, ChevronDown, ChevronRight, Loader2,
  CheckCircle, XCircle, Brain, ChevronUp,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import api from '../utils/api'
import { useAuthStore } from '../store/auth'

const PROVIDERS = {
  anthropic: { label: 'Anthropic', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
  openai:    { label: 'OpenAI',    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  deepseek:  { label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  minimax:   { label: 'MiniMax',  models: ['abab6.5s-chat', 'MiniMax-Text-01'] },
  volce:     { label: '火山引擎', models: [], freeText: true },
}

export default function ChatPage() {
  const token = useAuthStore((s) => s.token)

  const [agent, setAgent] = useState(null)
  const [conversations, setConversations] = useState([])
  const [activeConvId, setActiveConvId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const wsRef = useRef(null)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  // Model / provider / skills
  const [selectedProvider, setSelectedProvider] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [availableSkills, setAvailableSkills] = useState([])
  const [selectedSkills, setSelectedSkills] = useState([])  // [] = all
  const [showSelector, setShowSelector] = useState(false)
  const selectorRef = useRef(null)

  // Load single agent, default settings, and skills on mount
  useEffect(() => {
    api.get('/agent').then((r) => {
      setAgent(r.data)
      loadConversations(r.data.id)
      api.get(`/agents/${r.data.id}/workspace/skills`)
        .then((sr) => setAvailableSkills(sr.data.skills || []))
        .catch(() => {})
    }).catch(() => {})

    api.get('/settings').then((r) => {
      const d = r.data
      const prov = d.active_provider || 'anthropic'
      setSelectedProvider(prov)
      setSelectedModel(d[`${prov}_model`] || '')
    }).catch(() => {})
  }, [])

  // Close selector when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target)) {
        setShowSelector(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadConversations = (agentId) => {
    const id = agentId || agent?.id
    if (!id) return
    api.get(`/agents/${id}/conversations`).then((r) => setConversations(r.data)).catch(() => {})
  }

  useEffect(() => {
    if (!activeConvId || !agent) { setMessages([]); return }
    api.get(`/agents/${agent.id}/conversations/${activeConvId}/messages`)
      .then((r) => setMessages(r.data.map((m) => ({
        id: m.id, role: m.role, content: m.content,
        toolCalls: m.tool_calls, thinking: m.thinking, status: 'done',
      }))))
      .catch(() => {})
  }, [activeConvId, agent])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const newConversation = () => { setActiveConvId(null); setMessages([]) }

  const deleteConversation = async (id) => {
    await api.delete(`/agents/${agent.id}/conversations/${id}`)
    if (activeConvId === id) newConversation()
    loadConversations()
  }

  const handleProviderChange = (p) => {
    setSelectedProvider(p)
    // Try to load this provider's saved model from settings
    api.get('/settings').then((r) => {
      setSelectedModel(r.data[`${p}_model`] || (PROVIDERS[p]?.models[0] ?? ''))
    }).catch(() => {
      setSelectedModel(PROVIDERS[p]?.models[0] ?? '')
    })
  }

  const toggleSkill = (skill) => {
    if (selectedSkills.length === 0) {
      // All active → deselect this one
      setSelectedSkills(availableSkills.filter((s) => s !== skill))
    } else if (selectedSkills.includes(skill)) {
      const next = selectedSkills.filter((s) => s !== skill)
      setSelectedSkills(next.length === availableSkills.length ? [] : next)
    } else {
      const next = [...selectedSkills, skill]
      setSelectedSkills(next.length === availableSkills.length ? [] : next)
    }
  }

  const sendMessage = useCallback(() => {
    const text = input.trim()
    if (!text || sending || !agent) return

    setInput('')
    setSending(true)
    setShowSelector(false)

    const userMsg = { id: Date.now(), role: 'user', content: text, status: 'done' }
    setMessages((prev) => [...prev, userMsg])

    const assistantId = Date.now() + 1
    setMessages((prev) => [...prev, {
      id: assistantId, role: 'assistant', content: '', toolCalls: [], thinking: '', status: 'streaming',
    }])

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/agents/${agent.id}/conversations/ws`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({
        token,
        message: text,
        conversation_id: activeConvId,
        provider: selectedProvider || undefined,
        model: selectedModel || undefined,
        selected_skills: selectedSkills.length > 0 ? selectedSkills : undefined,
      }))
    }

    const toolCallMap = {}

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'conversation_id') { setActiveConvId(event.id); loadConversations(); return }

      setMessages((prev) => {
        const msgs = [...prev]
        const idx = msgs.findIndex((m) => m.id === assistantId)
        if (idx === -1) return prev
        const msg = { ...msgs[idx] }

        if (event.type === 'text_delta') {
          msg.content = (msg.content || '') + event.content
        } else if (event.type === 'thinking') {
          msg.thinking = (msg.thinking || '') + event.content
        } else if (event.type === 'tool_use') {
          toolCallMap[event.id] = { id: event.id, name: event.name, input: event.input, result: null, status: 'pending' }
          msg.toolCalls = Object.values(toolCallMap)
        } else if (event.type === 'tool_executing') {
          if (toolCallMap[event.id]) { toolCallMap[event.id].status = 'running'; msg.toolCalls = Object.values(toolCallMap) }
        } else if (event.type === 'tool_result') {
          if (toolCallMap[event.id]) {
            toolCallMap[event.id].result = event.result
            toolCallMap[event.id].status = event.is_error ? 'error' : 'done'
            msg.toolCalls = Object.values(toolCallMap)
          }
        } else if (event.type === 'done') {
          msg.status = 'done'; setSending(false)
        } else if (event.type === 'error') {
          msg.content = (msg.content || '') + `\n\n**错误:** ${event.content}`
          msg.status = 'done'; setSending(false)
        }

        msgs[idx] = msg
        return msgs
      })
    }

    ws.onerror = () => { setSending(false) }
    ws.onclose = () => { setSending(false) }
  }, [input, sending, activeConvId, agent, token, selectedProvider, selectedModel, selectedSkills])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const providerLabel = PROVIDERS[selectedProvider]?.label || selectedProvider
  const skillsLabel = selectedSkills.length === 0
    ? (availableSkills.length > 0 ? `技能·全部(${availableSkills.length})` : '无技能')
    : `技能·${selectedSkills.length}/${availableSkills.length}`

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Conversations sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-3 border-b border-gray-100">
          <button className="btn-primary w-full justify-center text-sm py-2" onClick={newConversation}>
            <Plus size={15} />新对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm ${
                activeConvId === c.id ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
              onClick={() => setActiveConvId(c.id)}
            >
              <span className="flex-1 truncate">{c.title || `对话 #${c.id}`}</span>
              <button
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"
                onClick={(e) => { e.stopPropagation(); deleteConversation(c.id) }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-14 bg-white border-b border-gray-200 flex items-center px-5">
          <span className="font-semibold text-gray-900">{agent?.name || '评估智能体'}</span>
          {selectedModel && (
            <span className="ml-2 text-xs text-gray-400">{providerLabel} · {selectedModel}</span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
              <div className="text-4xl mb-3">👋</div>
              <p className="text-sm">开始和 <strong className="text-gray-600">{agent?.name || '评估智能体'}</strong> 对话吧</p>
              {selectedModel && <p className="text-xs mt-1 text-gray-300">{providerLabel} · {selectedModel}</p>}
            </div>
          )}
          {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="bg-white border-t border-gray-200 p-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1 flex flex-col">
              <textarea
                ref={textareaRef}
                className="input resize-none min-h-[44px] max-h-32 mb-2"
                rows={1}
                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending}
              />
              {/* Model / Skills selector row */}
              <div className="flex items-center gap-2" ref={selectorRef}>
                <button
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                    showSelector
                      ? 'bg-primary-50 border-primary-300 text-primary-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                  onClick={() => setShowSelector((v) => !v)}
                >
                  {providerLabel}{selectedModel ? ` · ${selectedModel}` : ''}
                  {showSelector ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
                </button>
                {availableSkills.length > 0 && (
                  <button
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                      selectedSkills.length > 0
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                    onClick={() => setShowSelector((v) => !v)}
                  >
                    {skillsLabel}
                  </button>
                )}

                {/* Popover */}
                {showSelector && (
                  <div className="absolute bottom-[110px] left-[16rem] z-50 w-80 bg-white rounded-xl shadow-lg border border-gray-200 p-4 space-y-4">
                    {/* Provider */}
                    <div>
                      <div className="text-xs font-medium text-gray-500 mb-2">提供商</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(PROVIDERS).map(([key, { label }]) => (
                          <button
                            key={key}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                              selectedProvider === key
                                ? 'bg-primary-600 text-white border-primary-600'
                                : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'
                            }`}
                            onClick={() => handleProviderChange(key)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Model */}
                    <div>
                      <div className="text-xs font-medium text-gray-500 mb-2">模型</div>
                      {PROVIDERS[selectedProvider]?.freeText ? (
                        <input
                          className="input text-xs py-1.5"
                          placeholder="输入模型 / 端点 ID"
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                        />
                      ) : (
                        <select
                          className="input text-xs py-1.5"
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                        >
                          {(PROVIDERS[selectedProvider]?.models || []).map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Skills */}
                    {availableSkills.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 mb-2">
                          技能
                          <span className="ml-1 text-gray-400 font-normal">
                            {selectedSkills.length === 0 ? '(全部启用)' : `(已选 ${selectedSkills.length}/${availableSkills.length})`}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {availableSkills.map((skill) => {
                            const active = selectedSkills.length === 0 || selectedSkills.includes(skill)
                            return (
                              <button
                                key={skill}
                                className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                                  active
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                    : 'bg-white text-gray-400 border-gray-200 line-through'
                                }`}
                                onClick={() => toggleSkill(skill)}
                              >
                                {skill}
                              </button>
                            )
                          })}
                          {selectedSkills.length > 0 && (
                            <button
                              className="px-2.5 py-1 rounded-lg text-xs border border-dashed border-gray-300 text-gray-400 hover:text-gray-600"
                              onClick={() => setSelectedSkills([])}
                            >
                              全部启用
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <button
              className="btn-primary h-11 px-4 flex-shrink-0 self-start"
              onClick={sendMessage}
              disabled={sending || !input.trim()}
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[75%]">
        {!isUser && msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
        {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="space-y-2 mb-2">
            {msg.toolCalls.map((tc) => <ToolCallCard key={tc.id} tc={tc} />)}
          </div>
        )}
        {(msg.content || msg.status === 'streaming') && (
          <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-primary-600 text-white rounded-br-sm'
              : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'
          }`}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            ) : (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {msg.content || ''}
                </ReactMarkdown>
                {msg.status === 'streaming' && !msg.content && (
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingBlock({ thinking }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2">
      <button className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(!open)}>
        <Brain size={13} />思考过程
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="mt-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 whitespace-pre-wrap max-h-48 overflow-y-auto">
          {thinking}
        </div>
      )}
    </div>
  )
}

function ToolCallCard({ tc }) {
  const [open, setOpen] = useState(false)
  const statusIcon = {
    pending: <Loader2 size={13} className="text-gray-400 animate-spin" />,
    running: <Loader2 size={13} className="text-blue-500 animate-spin" />,
    done: <CheckCircle size={13} className="text-green-500" />,
    error: <XCircle size={13} className="text-red-500" />,
  }[tc.status] || null

  return (
    <div className="border border-gray-200 rounded-xl bg-gray-50 overflow-hidden text-xs">
      <button className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 text-left" onClick={() => setOpen(!open)}>
        {statusIcon}
        <span className="font-mono font-medium text-gray-700 flex-1">{tc.name}</span>
        <span className="text-gray-400 capitalize">{tc.status}</span>
        {open ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-200 divide-y divide-gray-100">
          <div className="px-3 py-2">
            <div className="text-gray-500 mb-1 font-medium">入参</div>
            <pre className="text-gray-700 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(tc.input, null, 2)}</pre>
          </div>
          {tc.result !== null && (
            <div className="px-3 py-2">
              <div className="text-gray-500 mb-1 font-medium">结果</div>
              <pre className={`overflow-x-auto whitespace-pre-wrap break-words ${tc.status === 'error' ? 'text-red-600' : 'text-gray-700'}`}>{tc.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
