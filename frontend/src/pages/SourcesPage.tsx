import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { fetchSources, syncSource, deleteSourceApi } from '@/api/client'
import type { SourceItem } from '@/api/client'
import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard'
import { UploadDocCard } from '@/components/knowledge/UploadDocCard'
import {
  Upload, Globe, Database, Loader2,
  FileText, Plus, Check,
} from 'lucide-react'

export function SourcesPage() {
  const [sources, setSources] = useState<SourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)

  // 统一添加弹窗
  const [showAddModal, setShowAddModal] = useState(false)
  const [addMode, setAddMode] = useState<'upload' | 'online'>('upload')
  const [addName, setAddName] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [addFiles, setAddFiles] = useState<FileList | null>(null)
  const [addType, setAddType] = useState<'code' | 'docs'>('code')
  const [addProtocol, setAddProtocol] = useState<'git' | 'svn'>('git')
  const [addSubmitting, setAddSubmitting] = useState(false)

  // 从 URL 智能推断名称和协议
  const parseUrl = (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return

    if (trimmed.startsWith('svn://') || trimmed.startsWith('svn+ssh://')) {
      setAddProtocol('svn')
    } else {
      setAddProtocol('git')
    }

    let name = ''
    const m = trimmed.match(/[\/:](\w[\w.-]*?)(?:\.git)?\/?$/)
    if (m) name = m[1]
    if (!name) {
      const parts = trimmed.replace(/\/+$/, '').split('/')
      name = parts[parts.length - 1].replace(/\.git$/, '')
    }
    if (name) setAddName(name)
  }

  // 上传的文档列表
  const [uploadedDocs, setUploadedDocs] = useState<{slug: string; filename: string; size: number; updated_at: string}[]>([])

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(null), 3000) }
  const showError = (msg: string) => { setError(msg); setTimeout(() => setError(null), 5000) }

  const loadAll = async () => {
    const [s, d] = await Promise.all([
      fetchSources().catch(() => []),
      fetch('/api/documents').then(r => r.json()).then(d => d.data || []).catch(() => []),
    ])
    setSources(s)
    setUploadedDocs(d)
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  // 统一提交
  const handleAddSubmit = async () => {
    setAddSubmitting(true)
    setShowAddModal(false)

    if (addMode === 'upload') {
      // 上传本地文档
      if (!addFiles || addFiles.length === 0) { setAddSubmitting(false); return }
      let ok = 0
      for (const file of Array.from(addFiles)) {
        const form = new FormData()
        form.append('file', file)
        form.append('tags', 'uploaded')
        try {
          const resp = await fetch('/api/documents/upload', { method: 'POST', body: form })
          if (resp.ok) ok++
        } catch { /* skip */ }
      }
      showSuccess(`成功上传 ${ok}/${addFiles.length} 个文档`)
    } else {
      // 添加在线文档
      const tempName = addName.trim()
      if (!tempName || !addUrl.trim()) { setAddSubmitting(false); return }
      // 立即插入"同步中"条目
      setSources(prev => [...prev, {
        name: tempName, type: addType, url: addUrl.trim(),
        _status: 'syncing',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      } as SourceItem])
      try {
        const body: Record<string, string> = { name: tempName, type: addType }
        if (addProtocol === 'svn') {
          body.url = addUrl.trim(); body.svn_url = addUrl.trim()
        } else {
          body.url = addUrl.trim()
        }
        const res = await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await res.json()
        if (!data.ok) throw new Error(data.error || '添加失败')
        showSuccess(`「${tempName}」添加成功`)
      } catch (e: any) {
        setSources(prev => prev.map(s => s.name === tempName ? { ...s, _status: 'error' as const } : s))
        showError(`「${tempName}」添加失败: ${e.message || '请查看后台日志'}`)
        setAddSubmitting(false)
        loadAll()
        return
      }
    }
    setAddName(''); setAddUrl(''); setAddFiles(null)
    loadAll()
    setAddSubmitting(false)
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" />

      {/* 提示条 */}
      {success && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
          <Check className="w-3.5 h-3.5" /> {success}
        </div>
      )}
      {error && (
        <div className="fixed bottom-6 right-6 z-50 bg-red-600 text-white text-xs px-4 py-2.5 rounded-xl shadow-lg">
          {error}
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* 标题 */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Database className="w-5 h-5 text-cyber-blue" /> 知识库
            </h2>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-16 text-sm">加载中...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">

              {/* 知识库卡片 */}
              {sources.map(s => (
                <KnowledgeCard
                  key={s.name}
                  source={s}
                  onRefresh={() => fetchSources().then(setSources)}
                  onError={msg => { setError(msg); setTimeout(() => setError(null), 5000) }}
                  onSuccess={msg => { setSuccess(msg); setTimeout(() => setSuccess(null), 3000) }}
                />
              ))}

              {/* 上传的文档卡片 */}
              {uploadedDocs.map(d => (
                <UploadDocCard
                  key={`doc-${d.slug}`}
                  slug={d.slug}
                  filename={d.filename}
                  size={d.size}
                  updatedAt={d.updated_at}
                  onDelete={async () => {
                    if (!confirm(`确认删除文档「${d.slug}」？`)) return
                    try {
                      const res = await fetch(`/api/documents/${d.slug}`, { method: 'DELETE' })
                      const data = await res.json()
                      if (!data.ok) throw new Error(data.error)
                      showSuccess(`「${d.slug}」已删除`)
                      loadAll()
                    } catch { showError('删除失败') }
                  }}
                />
              ))}

              {/* 新建知识库卡片 */}
              <button
                onClick={() => { setAddMode('upload'); setAddName(''); setAddFiles(null); setAddUrl(''); setAddType('code'); setAddProtocol('git'); setShowAddModal(true) }}
                className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center gap-2 hover:border-cyber-blue hover:bg-cyber-blue/5 transition group min-h-[180px]"
              >
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center group-hover:bg-cyber-blue/10 transition">
                  <Plus className="w-5 h-5 text-gray-400 group-hover:text-cyber-blue" />
                </div>
                <span className="text-sm font-bold text-gray-500 group-hover:text-cyber-blue">新建知识库</span>
                <span className="text-[10px] text-gray-400">上传文档或导入在线仓库</span>
              </button>

            </div>
          )}
        </div>
      </main>

      {/* ── 新建知识库弹窗（Tab 切换） ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { setShowAddModal(false); setAddName(''); setAddUrl(''); setAddFiles(null) }}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            {/* 标题 */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-900">新建知识库</h2>
              <button onClick={() => { setShowAddModal(false); setAddName(''); setAddUrl(''); setAddFiles(null) }} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>

            {/* Tab */}
            <div className="flex border-b border-gray-200 mb-4">
              <button
                onClick={() => { setAddMode('upload'); setAddName(''); setAddFiles(null); setAddUrl('') }}
                className={`flex-1 pb-2 text-xs font-bold border-b-2 transition ${addMode === 'upload' ? 'border-cyber-blue text-cyber-blue' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                <Upload className="w-3.5 h-3.5 inline mr-1" />上传本地文件
              </button>
              <button
                onClick={() => { setAddMode('online'); setAddName(''); setAddUrl(''); setAddFiles(null) }}
                className={`flex-1 pb-2 text-xs font-bold border-b-2 transition ${addMode === 'online' ? 'border-cyber-blue text-cyber-blue' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                <Globe className="w-3.5 h-3.5 inline mr-1" />添加在线仓库
              </button>
            </div>

            {/* Tab 内容 — 核心操作放首位 */}
            {addMode === 'online' ? (
              <>
                <div className="mb-3">
                  <label className="text-xs text-gray-500 mb-1 block">仓库地址</label>
                  <input value={addUrl} onChange={e => { setAddUrl(e.target.value); parseUrl(e.target.value) }}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 font-mono"
                    placeholder="git@github.com:user/repo.git 或 svn://..." />
                </div>
                {addUrl.trim() && (
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2.5 mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-10">名称</span>
                      <span className="text-xs font-mono font-bold text-gray-700">{addName || '—'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-10">协议</span>
                      <div className="flex gap-1">
                        <button onClick={() => setAddProtocol('git')}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${addProtocol === 'git' ? 'bg-orange-100 border-orange-300 text-orange-700' : 'border-gray-200 text-gray-400 hover:bg-gray-100'}`}>Git</button>
                        <button onClick={() => setAddProtocol('svn')}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${addProtocol === 'svn' ? 'bg-purple-100 border-purple-300 text-purple-700' : 'border-gray-200 text-gray-400 hover:bg-gray-100'}`}>SVN</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-10">类型</span>
                      <div className="flex gap-1">
                        <button onClick={() => setAddType('code')}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${addType === 'code' ? 'bg-cyber-blue/10 border-cyber-blue text-cyber-blue' : 'border-gray-200 text-gray-400 hover:bg-gray-100'}`}>代码</button>
                        <button onClick={() => setAddType('docs')}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${addType === 'docs' ? 'bg-cyber-green/10 border-cyber-green text-cyber-green' : 'border-gray-200 text-gray-400 hover:bg-gray-100'}`}>文档</button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="mb-3">
                <label className="cursor-pointer">
                  <div className={`border-2 border-dashed rounded-xl p-6 text-center transition ${addFiles && addFiles.length > 0 ? 'border-cyber-blue bg-cyber-blue/5' : 'border-gray-300 hover:border-cyber-blue hover:bg-gray-50'}`}>
                    <FileText className={`w-8 h-8 mx-auto mb-1 ${addFiles && addFiles.length > 0 ? 'text-cyber-blue' : 'text-gray-300'}`} />
                    {addFiles && addFiles.length > 0 ? (
                      <div>
                        <p className="text-sm font-bold text-cyber-blue mb-1">已选 {addFiles.length} 个文件</p>
                        <p className="text-[10px] text-gray-400">点击重新选择</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-bold text-gray-600 mb-1">点击选择文件</p>
                        <p className="text-[10px] text-gray-400">支持 .md .txt .pdf，可多选</p>
                      </div>
                    )}
                  </div>
                  <input type="file" multiple accept=".md,.txt,.pdf"
                    onChange={e => {
                      setAddFiles(e.target.files)
                      if (e.target.files && e.target.files[0] && !addName) {
                        setAddName(e.target.files[0].name.replace(/\.(md|txt|pdf)$/, ''))
                      }
                    }}
                    className="hidden" />
                </label>
              </div>
            )}

            {/* 名称（自动填充，放在下面） */}
            <div className="mb-3">
              <label className="text-xs text-gray-400 mb-1 block">
                名称 <span className="text-gray-300">（自动识别）</span>
              </label>
              <input value={addName} onChange={e => setAddName(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20"
                placeholder={addMode === 'online' ? '自动从 URL 识别...' : '自动从文件名识别...'} />
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => { setShowAddModal(false); setAddName(''); setAddUrl(''); setAddFiles(null) }}
                className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition">取消</button>
              <button onClick={handleAddSubmit} disabled={
                (addMode === 'online' && (!addName.trim() || !addUrl.trim())) ||
                (addMode === 'upload' && (!addFiles || addFiles.length === 0)) ||
                addSubmitting
              }
                className="inline-flex items-center gap-1 px-4 py-2 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark transition disabled:opacity-50">
                {addSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (addMode === 'upload' ? <Upload className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />)}
                {addSubmitting ? '提交中...' : (addMode === 'upload' ? '上传' : '添加')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
