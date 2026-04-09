import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Send, Plus, Trash2, ChevronDown, ChevronRight, Loader2, CheckCircle, XCircle, Brain } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import api from '../utils/api'
import { useAuthStore } from '../store/auth'

export default function ChatPage() {
  const { agentId } = useParams()
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.token)

  const [agent, setAgent] = useState(null)
  const [conversations, setConversations] = useState([])
  const [activeConvId, setActiveConvId] = useState(null)
  const [messages, setMessages] = useState([]) // rendered message blocks
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const wsRef = useRef(null)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  // Load agent & conversations
  useEffect(() => {
    api.get(`/agents/${agentId}`).then((r) => setAgent(r.data)).catch(() => {})
    loadConversations()
  }, [agentId])

  const loadConversations = () =>
    api.get(`/agents/${agentId}/conversations`).then((r) => setConversations(r.data)).catch(() => {})

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeConvId) {
      setMessages([])
      return
    }
    api.get(`/agents/${agentId}/conversations/${activeConvId}/messages`)
      .then((r) => {
        setMessages(r.data.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: m.tool_calls,
          thinking: m.thinking,
          status: 'done',
        })))
      })
      .catch(() => {})
  }, [activeConvId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const newConversation = () => {
    setActiveConvId(null)
    setMessages([])
  }

  const deleteConversation = async (id) => {
    await api.delete(`/agents/${agentId}/conversations/${id}`)
    if (activeConvId === id) newConversation()
    loadConversations()
  }

  const sendMessage = useCallback(() => {
    const text = input.trim()
    if (!text || sending) return

    setInput('')
    setSending(true)

    // Append user message immediately
    const userMsg = { id: Date.now(), role: 'user', content: text, status: 'done' }
    setMessages((prev) => [...prev, userMsg])

    // Create assistant message placeholder
    const assistantId = Date.now() + 1
    setMessages((prev) => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      thinking: '',
      status: 'streaming',
    }])

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/agents/${agentId}/conversations/ws`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({
        token,
        message: text,
        conversation_id: activeConvId,
      }))
    }

    const toolCallMap = {} // id -> {name, input, result, status}

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data)

      if (event.type === 'conversation_id') {
        setActiveConvId(event.id)
        loadConversations()
        return
      }

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
          toolCallMap[event.id] = {
            id: event.id, name: event.name, input: event.input,
            result: null, status: 'pending',
          }
          msg.toolCalls = Object.values(toolCallMap)
        } else if (event.type === 'tool_executing') {
          if (toolCallMap[event.id]) {
            toolCallMap[event.id].status = 'running'
            msg.toolCalls = Object.values(toolCallMap)
          }
        } else if (event.type === 'tool_result') {
          if (toolCallMap[event.id]) {
            toolCallMap[event.id].result = event.result
            toolCallMap[event.id].status = event.is_error ? 'error' : 'done'
            msg.toolCalls = Object.values(toolCallMap)
          }
        } else if (event.type === 'done') {
          msg.status = 'done'
          setSending(false)
        } else if (event.type === 'error') {
          msg.content = (msg.content || '') + `\n\n**错误:** ${event.content}`
          msg.status = 'done'
          setSending(false)
        }

        msgs[idx] = msg
        return msgs
      })
    }

    ws.onerror = () => {
      setSending(false)
    }
    ws.onclose = () => {
      setSending(false)
    }
  }, [input, sending, activeConvId, agentId, token])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Conversations sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-3 border-b border-gray-100">
          <button
            className="btn-primary w-full justify-center text-sm py-2"
            onClick={newConversation}
          >
            <Plus size={15} />
            新对话
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
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
          <button className="text-gray-400 hover:text-gray-600" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <span className="font-semibold text-gray-900">{agent?.name || '智能体'}</span>
            {agent?.primary_model && (
              <span className="ml-2 text-xs text-gray-400">{agent.primary_model}</span>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
              <div className="text-4xl mb-3">👋</div>
              <p className="text-sm">开始和 <strong className="text-gray-600">{agent?.name}</strong> 对话吧</p>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="bg-white border-t border-gray-200 p-4">
          <div className="flex gap-3 items-end">
            <textarea
              ref={textareaRef}
              className="flex-1 input resize-none min-h-[44px] max-h-32"
              rows={1}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            <button
              className="btn-primary h-11 px-4 flex-shrink-0"
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
      <div className={`max-w-[75%] ${isUser ? 'order-2' : ''}`}>
        {/* Thinking */}
        {!isUser && msg.thinking && (
          <ThinkingBlock thinking={msg.thinking} />
        )}

        {/* Tool calls */}
        {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="space-y-2 mb-2">
            {msg.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} tc={tc} />
            ))}
          </div>
        )}

        {/* Content */}
        {(msg.content || msg.status === 'streaming') && (
          <div
            className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
              isUser
                ? 'bg-primary-600 text-white rounded-br-sm'
                : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'
            }`}
          >
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
      <button
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <Brain size={13} />
        思考过程
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
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setOpen(!open)}
      >
        {statusIcon}
        <span className="font-mono font-medium text-gray-700 flex-1">{tc.name}</span>
        <span className="text-gray-400 text-xs capitalize">{tc.status}</span>
        {open ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-200 divide-y divide-gray-100">
          <div className="px-3 py-2">
            <div className="text-gray-500 mb-1 font-medium">入参</div>
            <pre className="text-gray-700 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(tc.input, null, 2)}
            </pre>
          </div>
          {tc.result !== null && (
            <div className="px-3 py-2">
              <div className="text-gray-500 mb-1 font-medium">结果</div>
              <pre className={`overflow-x-auto whitespace-pre-wrap break-words ${tc.status === 'error' ? 'text-red-600' : 'text-gray-700'}`}>
                {tc.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
