import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import api from '../utils/api'

const MODELS = {
  anthropic: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
  ],
}

export default function AgentConfigPage() {
  const { agentId } = useParams()
  const isNew = !agentId
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    description: '',
    role_description: '',
    primary_model: 'claude-sonnet-4-6',
    fallback_model: '',
    provider: 'anthropic',
    history_count: 20,
    context_window: 8000,
    max_tool_rounds: 50,
  })

  useEffect(() => {
    if (!isNew) {
      setLoading(true)
      api.get(`/agents/${agentId}`)
        .then((r) => setForm({ ...r.data, fallback_model: r.data.fallback_model || '' }))
        .catch(() => setError('加载失败'))
        .finally(() => setLoading(false))
    }
  }, [agentId])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, fallback_model: form.fallback_model || null }
      if (isNew) {
        const res = await api.post('/agents', payload)
        navigate(`/agents/${res.data.id}/config`, { replace: true })
      } else {
        await api.put(`/agents/${agentId}`, payload)
      }
    } catch (err) {
      setError(err.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const setNum = (field) => (e) => setForm((f) => ({ ...f, [field]: parseInt(e.target.value) || 0 }))

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-500">加载中...</div>

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button className="text-gray-400 hover:text-gray-600" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{isNew ? '新建智能体' : '智能体配置'}</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="card p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">基本信息</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">名称 *</label>
                <input className="input" value={form.name} onChange={set('name')} required placeholder="智能体名称" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">简介</label>
                <textarea className="input resize-none" rows={2} value={form.description} onChange={set('description')} placeholder="智能体功能简介" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">角色描述</label>
                <textarea className="input resize-none" rows={3} value={form.role_description} onChange={set('role_description')} placeholder="详细描述该智能体的职责和能力范围" />
              </div>
            </div>
          </div>

          {/* AI Model */}
          <div className="card p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">AI 模型</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">提供商</label>
                <select className="input" value={form.provider} onChange={(e) => {
                  const p = e.target.value
                  setForm((f) => ({ ...f, provider: p, primary_model: MODELS[p][0] }))
                }}>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">主要模型</label>
                <select className="input" value={form.primary_model} onChange={set('primary_model')}>
                  {(MODELS[form.provider] || []).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">备用模型（可选）</label>
                <input className="input" value={form.fallback_model} onChange={set('fallback_model')} placeholder="fallback model ID" />
              </div>
            </div>
          </div>

          {/* Context */}
          <div className="card p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">上下文管理</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">历史消息数</label>
                <input className="input" type="number" min={1} max={100} value={form.history_count} onChange={setNum('history_count')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">上下文窗口</label>
                <input className="input" type="number" min={1000} value={form.context_window} onChange={setNum('context_window')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">最大工具轮数</label>
                <input className="input" type="number" min={1} max={100} value={form.max_tool_rounds} onChange={setNum('max_tool_rounds')} />
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}

          <div className="flex gap-3 justify-end">
            <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>取消</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              <Save size={16} />
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
