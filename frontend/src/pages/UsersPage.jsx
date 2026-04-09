import { useEffect, useState } from 'react'
import { UserPlus, Pencil, Trash2, X, Check, ShieldCheck, User } from 'lucide-react'
import api from '../utils/api'
import { useAuthStore } from '../store/auth'

export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null) // null = create mode
  const [error, setError] = useState('')

  const load = () => api.get('/users').then((r) => setUsers(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const openCreate = () => { setEditUser(null); setShowModal(true) }
  const openEdit = (u) => { setEditUser(u); setShowModal(true) }
  const closeModal = () => { setShowModal(false); setError('') }

  const handleDelete = async (u) => {
    if (!confirm(`确认删除用户 "${u.username}"？此操作不可撤销。`)) return
    try {
      await api.delete(`/users/${u.id}`)
      load()
    } catch (err) {
      alert(err.response?.data?.detail || '删除失败')
    }
  }

  const handleSave = async (formData) => {
    setError('')
    try {
      if (editUser) {
        await api.put(`/users/${editUser.id}`, formData)
      } else {
        await api.post('/users', formData)
      }
      load()
      closeModal()
    } catch (err) {
      setError(err.response?.data?.detail || '保存失败')
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">用户管理</h1>
            <p className="text-sm text-gray-500 mt-1">管理平台账号与权限</p>
          </div>
          <button className="btn-primary" onClick={openCreate}>
            <UserPlus size={16} />
            新建用户
          </button>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">账号</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">显示名称</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">角色</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">状态</th>
                <th className="text-right px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-sm font-semibold text-gray-600">
                        {(u.display_name || u.username)[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 text-sm">{u.username}</div>
                        {u.id === currentUser?.user_id && (
                          <div className="text-xs text-gray-400">（当前账号）</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600">{u.display_name || '—'}</td>
                  <td className="px-5 py-4">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      u.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {u.is_active ? <Check size={11} /> : <X size={11} />}
                      {u.is_active ? '正常' : '停用'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="编辑"
                        onClick={() => openEdit(u)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="删除"
                        disabled={u.id === currentUser?.user_id}
                        onClick={() => handleDelete(u)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-sm text-gray-400">暂无用户</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <UserModal
          user={editUser}
          error={error}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

function RoleBadge({ role }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
        <ShieldCheck size={11} />
        管理员
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
      <User size={11} />
      普通用户
    </span>
  )
}

function UserModal({ user, error, onSave, onClose }) {
  const isEdit = !!user
  const [form, setForm] = useState({
    username: user?.username || '',
    display_name: user?.display_name || '',
    password: '',
    role: user?.role || 'user',
    is_active: user?.is_active ?? true,
  })

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = { ...form }
    if (isEdit && !payload.password) delete payload.password
    if (!isEdit && !payload.password) return
    onSave(payload)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="card w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? `编辑用户：${user.username}` : '新建用户'}
          </h2>
          <button className="text-gray-400 hover:text-gray-600" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">账号 *</label>
              <input
                className="input"
                value={form.username}
                onChange={set('username')}
                required
                placeholder="登录账号"
                autoFocus
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">显示名称</label>
            <input
              className="input"
              value={form.display_name}
              onChange={set('display_name')}
              placeholder="可选"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isEdit ? '新密码（留空不修改）' : '密码 *'}
            </label>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={set('password')}
              required={!isEdit}
              placeholder={isEdit ? '留空表示不修改密码' : '登录密码'}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">角色</label>
            <select className="input" value={form.role} onChange={set('role')}>
              <option value="user">普通用户</option>
              <option value="admin">平台管理员</option>
            </select>
          </div>
          {isEdit && (
            <div className="flex items-center gap-3">
              <input
                id="is_active"
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300 text-primary-600"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">账号启用</label>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1 justify-center" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn-primary flex-1 justify-center">
              {isEdit ? '保存修改' : '创建用户'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
