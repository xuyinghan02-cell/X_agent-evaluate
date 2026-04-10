import { useEffect, useState } from 'react'
import { Save, Eye, EyeOff, CheckCircle, Star } from 'lucide-react'
import api from '../utils/api'
import { useAuthStore } from '../store/auth'

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    keyPlaceholder: 'sk-ant-...',
    defaultModel: 'claude-sonnet-4-6',
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    keyPlaceholder: 'sk-...',
    defaultModel: 'gpt-4o',
  },
  deepseek: {
    label: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyPlaceholder: 'sk-...',
    defaultModel: 'deepseek-chat',
  },
  minimax: {
    label: 'MiniMax',
    models: ['abab6.5s-chat', 'MiniMax-Text-01'],
    keyPlaceholder: 'eyJ...',
    defaultModel: 'abab6.5s-chat',
  },
  volce: {
    label: '火山引擎',
    models: [],
    freeText: true,
    keyPlaceholder: '',
    defaultModel: '',
  },
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const [activeProvider, setActiveProvider] = useState('anthropic')
  const [perProviderModels, setPerProviderModels] = useState(
    Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.defaultModel]))
  )
  const [apiKeys, setApiKeys] = useState(
    Object.fromEntries(Object.keys(PROVIDERS).map((k) => [`${k}_api_key`, '']))
  )
  const [showKeys, setShowKeys] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/settings').then((r) => {
      const d = r.data
      if (d.active_provider) setActiveProvider(d.active_provider)
      setPerProviderModels((prev) => {
        const next = { ...prev }
        Object.keys(PROVIDERS).forEach((k) => {
          if (d[`${k}_model`]) next[k] = d[`${k}_model`]
        })
        return next
      })
      if (isAdmin) {
        setApiKeys((prev) => {
          const next = { ...prev }
          Object.keys(PROVIDERS).forEach((k) => {
            const key = `${k}_api_key`
            if (d[key] !== undefined) next[key] = d[key] || ''
          })
          return next
        })
      }
    }).catch(() => {})
  }, [isAdmin])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = { active_provider: activeProvider }
      Object.keys(PROVIDERS).forEach((k) => {
        payload[`${k}_model`] = perProviderModels[k] || ''
      })
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
          <p className="text-sm text-gray-500 mt-1">为每个提供商单独配置模型和 API Key</p>
        </div>

        <div className="space-y-4">
          {Object.entries(PROVIDERS).map(([key, { label, models, freeText, keyPlaceholder }]) => {
            const isActive = activeProvider === key
            return (
              <div
                key={key}
                className={`card p-5 border-2 transition-colors ${
                  isActive ? 'border-primary-400' : 'border-gray-100'
                }`}
              >
                {/* Provider header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{label}</span>
                    {isActive && (
                      <span className="flex items-center gap-1 text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full font-medium">
                        <Star size={10} />默认使用
                      </span>
                    )}
                  </div>
                  {!isActive && (
                    <button
                      className="text-xs text-gray-500 border border-gray-300 px-3 py-1 rounded-lg hover:border-primary-400 hover:text-primary-600 transition-colors"
                      onClick={() => setActiveProvider(key)}
                    >
                      设为默认
                    </button>
                  )}
                </div>

                {/* Model */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">模型</label>
                  {freeText ? (
                    <input
                      className="input"
                      placeholder="输入模型 / 端点 ID，例如 ep-20260303110342-xxxxx"
                      value={perProviderModels[key]}
                      onChange={(e) =>
                        setPerProviderModels((m) => ({ ...m, [key]: e.target.value }))
                      }
                    />
                  ) : (
                    <select
                      className="input"
                      value={perProviderModels[key]}
                      onChange={(e) =>
                        setPerProviderModels((m) => ({ ...m, [key]: e.target.value }))
                      }
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* API Key — admin only */}
                {isAdmin && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      API Key
                    </label>
                    <div className="relative">
                      <input
                        className="input pr-10"
                        type={showKeys[key] ? 'text' : 'password'}
                        placeholder={keyPlaceholder || '输入 API Key'}
                        value={apiKeys[`${key}_api_key`]}
                        onChange={(e) =>
                          setApiKeys((k) => ({ ...k, [`${key}_api_key`]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => toggleShow(key)}
                      >
                        {showKeys[key] ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    {!isAdmin && (
                      <p className="text-xs text-gray-400 mt-1">仅管理员可配置 API Key</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
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
