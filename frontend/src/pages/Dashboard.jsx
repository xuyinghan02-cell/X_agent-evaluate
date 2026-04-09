import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, MessageSquare, Plus } from 'lucide-react'
import api from '../utils/api'

export default function Dashboard() {
  const [agents, setAgents] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/agents').then((r) => setAgents(r.data)).catch(() => {})
  }, [])

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">智能体概览</h1>
            <p className="text-gray-500 text-sm mt-1">管理和对话你的数字员工</p>
          </div>
          <button
            className="btn-primary"
            onClick={() => navigate('/agents/new')}
          >
            <Plus size={16} />
            新建智能体
          </button>
        </div>

        {agents.length === 0 ? (
          <div className="card p-16 flex flex-col items-center text-center">
            <Bot className="w-16 h-16 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无智能体</h3>
            <p className="text-gray-500 text-sm mb-6">创建你的第一个数字员工，开始智能对话</p>
            <button className="btn-primary" onClick={() => navigate('/agents/new')}>
              <Plus size={16} />
              新建智能体
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AgentCard({ agent }) {
  const navigate = useNavigate()
  return (
    <div className="card p-5 hover:shadow-md transition-shadow cursor-pointer group">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{agent.name}</h3>
          <p className="text-xs text-gray-500 truncate">{agent.primary_model}</p>
        </div>
      </div>
      {agent.description && (
        <p className="text-sm text-gray-600 mb-4 line-clamp-2">{agent.description}</p>
      )}
      <div className="flex gap-2">
        <button
          className="btn-primary flex-1 justify-center text-xs py-1.5"
          onClick={() => navigate(`/agents/${agent.id}/chat`)}
        >
          <MessageSquare size={14} />
          开始对话
        </button>
        <button
          className="btn-secondary text-xs py-1.5 px-3"
          onClick={() => navigate(`/agents/${agent.id}/config`)}
        >
          配置
        </button>
      </div>
    </div>
  )
}
