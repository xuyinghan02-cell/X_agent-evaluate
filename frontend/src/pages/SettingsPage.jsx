import { useEffect, useState } from 'react'
import { Save, Eye, EyeOff, CheckCircle } from 'lucide-react'
import api from '../utils/api'
import { useAuthStore } from '../store/auth'

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  deepseek: {
    label: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  minimax: {
    label: 'MiniMax',
    models: ['abab6.5s-chat', 'MiniMax-Text-01'],
  },
  volce: {
    label: '火山引擎',
    models: [],  // endpoint IDs are user-defined; use free-text input
    freeText: true,
  },
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const [provider, setProvider] = useState('anthropic')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [apiKeys, setApiKeys] = useState({
    anthropic_api_key: '',
    openai_api_key: '',
    deepseek_api_key: '',
    minimax_api_key: '',
    volce_api_key: '',
  })
  const [showKeys, setShowKeys] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/settings').then((r) => {
      const d = r.data
      if (d.active_provider) setProvider(d.active_provider)
      if (d.active_model) setModel(d.active_model)
      if (isAdmin) {
        setApiKeys({
          anthropic_api_key: d.anthropic_api_key || '',
          openai_api_key: d.openai_api_key || '',
          deepseek_api_key: d.deepseek_api_key || '',
          minimax_api_key: d.minimax_api_key || '',
          volce_api_key: d.volce_api_key || '',
        })
      }
    }).catch(() => {})
  }, [])

  // When provider changes, default to first model (if any)
  const handleProviderChange = (p) => {
    setProvider(p)
    if (PROVIDERS[p].models.length > 0) setModel(PROVIDERS[p].models[0])
    else setModel('')
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = { active_provider: provider, active_model: model }
      if (isAdmin) {
        Object.assign(payload, apiKeys)
      }
      await api.put('/settings', { settings: payload })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleShow = (key) => setShowKeys((s) => ({ ...s, [key]: !s[key] }))

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">设置</h1>
          <p className="text-sm text-gray-500 mt-1">配置模型和 API Key</p>
        </div>

        <div className="space-y-6">
          {/* Model Config */}
          <div className="card p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">模型配置</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">提供商</label>
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(PROVIDERS).map(([key, { label }]) => (
                    <button
                      key={key}
                      className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                        provider === key
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400 hover:text-primary-600'
                      }`}
                      onClick={() => handleProviderChange(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">模型</label>
                {PROVIDERS[provider]?.freeText ? (
                  <input
                    className="input"
                    placeholder="输入模型 ID，例如 ep-20260303110342-xxxxx"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                ) : (
                  <select
                    className="input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {PROVIDERS[provider].models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* API Keys — admin only */}
          {isAdmin && (
            <div className="card p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-1">API Keys</h2>
              <p className="text-xs text-gray-400 mb-4">仅管理员可见和修改。密钥在数据库中加密存储，界面显示已脱敏。</p>
              <div className="space-y-4">
                {[
                  { key: 'anthropic_api_key', label: 'Anthropic API Key', placeholder: 'sk-ant-...' },
                  { key: 'openai_api_key', label: 'OpenAI API Key', placeholder: 'sk-...' },
                  { key: 'deepseek_api_key', label: 'DeepSeek API Key', placeholder: 'sk-...' },
                  { key: 'minimax_api_key', label: 'MiniMax API Key', placeholder: 'eyJ...' },
                  { key: 'volce_api_key', label: '火山引擎 API Key', placeholder: '' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
                    <div className="relative">
                      <input
                        className="input pr-10"
                        type={showKeys[key] ? 'text' : 'password'}
                        placeholder={placeholder}
                        value={apiKeys[key]}
                        onChange={(e) => setApiKeys((k) => ({ ...k, [key]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => toggleShow(key)}
                      >
                        {showKeys[key] ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}

          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-green-600">
                <CheckCircle size={15} />已保存
              </span>
            )}
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              <Save size={16} />
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
