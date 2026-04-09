import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, MessageSquare, Settings, Folder, Plus, Trash2 } from 'lucide-react'
import api from '../utils/api'

export default function AgentsPage() {
  const [agents, setAgents] = useState([])
  const navigate = useNavigate()

  const load = () => api.get('/agents').then((r) => setAgents(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const handleDelete = async (id) => {
    if (!confirm('确认删除此智能体？')) return
    await api.delete(`/agents/${id}`)
    load()
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">智能体管理</h1>
          <button className="btn-primary" onClick={() => navigate('/agents/new')}>
            <Plus size={16} />新建智能体
          </button>
        </div>

        <div className="card overflow-hidden">
          {agents.length === 0 ? (
            <div className="p-12 text-center text-gray-500">暂无智能体</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">名称</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">模型</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">提供商</th>
                  <th className="text-right px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {agents.map((agent) => (
                  <tr key={agent.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center">
                          <Bot className="w-4 h-4 text-primary-600" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{agent.name}</div>
                          {agent.description && (
                            <div className="text-xs text-gray-500 truncate max-w-xs">{agent.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600">{agent.primary_model}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 capitalize">
                        {agent.provider}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          title="对话"
                          onClick={() => navigate(`/agents/${agent.id}/chat`)}
                        >
                          <MessageSquare size={16} />
                        </button>
                        <button
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                          title="工作空间"
                          onClick={() => navigate(`/agents/${agent.id}/workspace`)}
                        >
                          <Folder size={16} />
                        </button>
                        <button
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                          title="配置"
                          onClick={() => navigate(`/agents/${agent.id}/config`)}
                        >
                          <Settings size={16} />
                        </button>
                        <button
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除"
                          onClick={() => handleDelete(agent.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
