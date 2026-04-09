import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, File, Folder, Upload, Trash2, Save,
  ChevronRight, ChevronDown, RefreshCw, Plus,
} from 'lucide-react'
import api from '../utils/api'

export default function WorkspacePage() {
  const { agentId } = useParams()
  const navigate = useNavigate()

  const [agent, setAgent] = useState(null)
  const [tree, setTree] = useState([])
  const [selectedPath, setSelectedPath] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [editedContent, setEditedContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const uploadRef = useRef()
  const [uploadSubDir, setUploadSubDir] = useState('uploads')

  useEffect(() => {
    api.get(`/agents/${agentId}`).then((r) => setAgent(r.data)).catch(() => {})
    loadTree()
  }, [agentId])

  const loadTree = async () => {
    try {
      const res = await api.get(`/agents/${agentId}/workspace/files`)
      setTree(res.data)
    } catch {
      setError('加载工作空间失败')
    }
  }

  const openFile = async (item) => {
    if (item.is_dir) return
    if (isDirty && !confirm('当前文件有未保存的修改，确认切换？')) return
    setSelectedPath(item.path)
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/agents/${agentId}/workspace/files/content`, {
        params: { path: item.path },
        responseType: 'text',
      })
      setFileContent(res.data)
      setEditedContent(res.data)
      setIsDirty(false)
    } catch {
      setError('读取文件失败')
    } finally {
      setLoading(false)
    }
  }

  const saveFile = async () => {
    if (!selectedPath) return
    setSaving(true)
    setError('')
    try {
      await api.put(`/agents/${agentId}/workspace/files`, {
        path: selectedPath,
        content: editedContent,
      })
      setFileContent(editedContent)
      setIsDirty(false)
      flash('保存成功')
    } catch {
      setError('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteFile = async (path, e) => {
    e.stopPropagation()
    if (!confirm(`确认删除 ${path}？`)) return
    try {
      await api.delete(`/agents/${agentId}/workspace/files`, { params: { path } })
      if (selectedPath === path) {
        setSelectedPath(null)
        setFileContent('')
        setEditedContent('')
        setIsDirty(false)
      }
      loadTree()
      flash('已删除')
    } catch {
      setError('删除失败')
    }
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    try {
      await api.post(`/agents/${agentId}/workspace/upload`, form, {
        params: { sub_dir: uploadSubDir },
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      loadTree()
      flash(`已上传到 ${uploadSubDir}/`)
    } catch {
      setError('上传失败')
    }
    e.target.value = ''
  }

  const flash = (msg) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 2500)
  }

  const isEditable = (path) => {
    if (!path) return false
    const ext = path.split('.').pop().toLowerCase()
    return ['md', 'txt', 'json', 'yaml', 'yml', 'py', 'js', 'ts', 'sh', 'toml'].includes(ext)
  }

  // Group top-level items: files first then dirs
  const topFiles = tree.filter((i) => !i.is_dir)
  const topDirs = tree.filter((i) => i.is_dir)

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* File Tree Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="h-14 border-b border-gray-200 flex items-center px-4 gap-2">
          <button className="text-gray-400 hover:text-gray-600" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} />
          </button>
          <span className="font-semibold text-gray-900 flex-1 truncate">
            {agent?.name || '工作空间'}
          </span>
          <button
            className="text-gray-400 hover:text-gray-600"
            title="刷新"
            onClick={loadTree}
          >
            <RefreshCw size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {/* Top-level files (soul.md, memory.md, agent.md) */}
          {topFiles.map((item) => (
            <FileRow
              key={item.path}
              item={item}
              selected={selectedPath === item.path}
              onOpen={openFile}
              onDelete={deleteFile}
            />
          ))}

          {/* Directories */}
          {topDirs.map((dir) => (
            <DirRow
              key={dir.path}
              dir={dir}
              agentId={agentId}
              selectedPath={selectedPath}
              onOpen={openFile}
              onDelete={deleteFile}
            />
          ))}
        </div>

        {/* Upload panel */}
        <div className="border-t border-gray-200 p-3 space-y-2">
          <div className="text-xs font-medium text-gray-500 mb-1">上传文件</div>
          <select
            className="input text-xs py-1"
            value={uploadSubDir}
            onChange={(e) => setUploadSubDir(e.target.value)}
          >
            <option value="uploads">uploads/</option>
            <option value="skills">skills/</option>
            <option value="outputs">outputs/</option>
          </select>
          <button
            className="btn-secondary w-full text-xs py-1.5 justify-center"
            onClick={() => uploadRef.current?.click()}
          >
            <Upload size={13} />
            选择文件上传
          </button>
          <input ref={uploadRef} type="file" className="hidden" onChange={handleUpload} />
        </div>
      </aside>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Editor Header */}
        <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
          {selectedPath ? (
            <>
              <File size={15} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-700 flex-1">{selectedPath}</span>
              {isDirty && (
                <span className="text-xs text-amber-500 font-medium">未保存</span>
              )}
              {isEditable(selectedPath) && (
                <button
                  className="btn-primary text-xs py-1.5"
                  onClick={saveFile}
                  disabled={saving || !isDirty}
                >
                  <Save size={13} />
                  {saving ? '保存中...' : '保存'}
                </button>
              )}
            </>
          ) : (
            <span className="text-sm text-gray-400">选择左侧文件进行查看或编辑</span>
          )}
        </div>

        {/* Notifications */}
        {(error || successMsg) && (
          <div className={`px-4 py-2 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {error || successMsg}
            {error && (
              <button className="ml-2 underline" onClick={() => setError('')}>关闭</button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">加载中...</div>
          ) : selectedPath ? (
            isEditable(selectedPath) ? (
              <textarea
                className="w-full h-full p-4 text-sm font-mono text-gray-800 bg-gray-50 border-0 outline-none resize-none leading-relaxed"
                value={editedContent}
                onChange={(e) => {
                  setEditedContent(e.target.value)
                  setIsDirty(e.target.value !== fileContent)
                }}
                spellCheck={false}
              />
            ) : (
              <div className="p-4 text-sm text-gray-500 italic">
                该文件类型不支持在线编辑，可通过下载后修改再上传。
                <pre className="mt-4 text-xs text-gray-700 bg-gray-100 p-3 rounded-lg overflow-auto max-h-[60vh]">
                  {fileContent}
                </pre>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
              <Folder className="w-16 h-16 mb-3 text-gray-200" />
              <p className="text-sm">从左侧选择一个文件</p>
              <p className="text-xs mt-1 text-gray-300">支持编辑 .md .txt .json .yaml .py .js 等文本文件</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FileRow({ item, selected, onOpen, onDelete }) {
  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
        selected ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
      onClick={() => onOpen(item)}
    >
      <File size={14} className="flex-shrink-0 text-gray-400" />
      <span className="flex-1 truncate text-xs">{item.name}</span>
      <button
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-colors"
        onClick={(e) => onDelete(item.path, e)}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function DirRow({ dir, agentId, selectedPath, onOpen, onDelete }) {
  const [open, setOpen] = useState(dir.name !== 'outputs')
  const [children, setChildren] = useState([])
  const [loaded, setLoaded] = useState(false)

  const toggle = async () => {
    if (!loaded) {
      try {
        const res = await api.get(`/agents/${agentId}/workspace/files`, {
          params: { sub_dir: dir.path },
        })
        setChildren(res.data)
        setLoaded(true)
      } catch {}
    }
    setOpen((o) => !o)
  }

  // Reload when dir changes
  useEffect(() => {
    if (open) {
      api.get(`/agents/${agentId}/workspace/files`, { params: { sub_dir: dir.path } })
        .then((r) => { setChildren(r.data); setLoaded(true) })
        .catch(() => {})
    }
  }, [open, dir.path])

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm text-gray-600 hover:bg-gray-100 transition-colors"
        onClick={toggle}
      >
        {open ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
        <Folder size={14} className="text-amber-400 flex-shrink-0" />
        <span className="flex-1 text-xs font-medium">{dir.name}/</span>
      </div>
      {open && (
        <div className="ml-4 border-l border-gray-100 pl-2 space-y-0.5">
          {children.length === 0 ? (
            <div className="text-xs text-gray-400 px-2 py-1">空目录</div>
          ) : (
            children.map((child) => (
              <FileRow
                key={child.path}
                item={child}
                selected={selectedPath === child.path}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
