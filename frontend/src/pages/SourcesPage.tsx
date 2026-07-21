import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { fetchSources, syncSource, deleteSourceApi } from '@/api/client'
import type { SourceItem } from '@/api/client'
import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard'
import { UploadDocCard } from '@/components/knowledge/UploadDocCard'
import { useLayout } from '@/contexts/LayoutContext'
import {
  Upload, Globe, Database, Loader2,
  FileText, Plus, Check,
} from 'lucide-react'

export function SourcesPage() {
  const [sources, setSources] = useState<SourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const navigate = useNavigate()
  const { setDrawerContent } = useLayout()

  // Set drawer content (knowledge base list + 知识沉淀)
  useEffect(() => {
    const items: { id: string; label: string; active?: boolean; onClick: () => void }[] = [
      {
        id: '_wiki',
        label: '📄 知识沉淀',
        onClick: () => navigate('/wiki'),
      },
      ...sources.map(s => ({
        id: s.name,
        label: s.name,
        active: false,
        onClick: () => navigate(`/wiki/${s.name}`),
      })),
    ]
    setDrawerContent({ title: '知识库', items })
  }, [sources])

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
  const [uploadedDocs, setUploadedDocs] = useState<{slug: string; kb_name?: string; filename: string; size: number; updated_at: string}[]>([])

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

    try {
      if (addMode === 'upload') {
        // 上传本地文档
        if (!addFiles || addFiles.length === 0) return
        let ok = 0
        const kbName = addName.trim() || 'untitled'
        for (const file of Array.from(addFiles)) {
          const form = new FormData()
          form.append('file', file)
          form.append('name', kbName)
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
        if (!tempName || !addUrl.trim()) return
        setSources(prev => [...prev, {
          name: tempName, type: addType, url: addUrl.trim(),
          _status: 'syncing',
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        } as SourceItem])
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
      }
    } catch (e: any) {
      showError(`添加失败: ${e.message || '请查看后台日志'}`)
    } finally {
      setAddName(''); setAddUrl(''); setAddFiles(null)
      loadAll()
      setAddSubmitting(false)
    }
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

              {/* 上传文档 — 按知识库分组 */}
              {(() => {
                const groups = new Map<string, typeof uploadedDocs>()
                for (const d of uploadedDocs) {
                  const key = d.kb_name || '_root'
                  if (!groups.has(key)) groups.set(key, [])
                  groups.get(key)!.push(d)
                }
                return Array.from(groups.entries()).map(([kbName, docs]) => (
                  <div key={`kb-${kbName}`} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2.5 hover:shadow-sm transition group">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-yellow-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-gray-900 truncate">{kbName === '_root' ? '未分类' : kbName}</div>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                          upload · {docs.length} 个文件
                        </span>
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-400">
                      最后更新: {docs.reduce((latest, d) => d.updated_at > latest ? d.updated_at : latest, docs[0]?.updated_at || '').slice(0, 10)}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {docs.slice(0, 4).map(d => (
                        <span key={d.slug} className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 truncate max-w-[100px]">{d.slug}</span>
                      ))}
                      {docs.length > 4 && <span className="text-[10px] text-gray-400">+{docs.length - 4}</span>}
                    </div>
                    <div className="flex items-center gap-1 pt-2 border-t border-gray-100 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={async () => {
                        if (!confirm(`确认删除知识库「${kbName}」及所有文件？`)) return
                        let deleted = 0
                        for (const d of docs) {
                          try {
                            const res = await fetch(`/api/documents/${d.slug}`, { method: 'DELETE' })
                            if (res.ok) deleted++
                          } catch {}
                        }
                        showSuccess(`已删除 ${deleted}/${docs.length} 个文件`)
                        loadAll()
                      }}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-[10px] px-2 py-1 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition">
                        🗑 删除
                      </button>
                    </div>
                  </div>
                ))
              })()}

              {/* 新建知识库卡片 */}
              <button
                onClick={() => { setAddSubmitting(false); setAddMode('upload'); setAddName(''); setAddFiles(null); setAddUrl(''); setAddType('code'); setAddProtocol('git'); setShowAddModal(true) }}
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
                      <input value={addName} onChange={e => setAddName(e.target.value)}
                        className="flex-1 text-xs bg-transparent border-0 border-b border-dashed border-gray-300 px-0 py-0.5 focus:outline-none focus:border-cyber-blue font-mono font-bold text-gray-700"
                        placeholder="自动识别..." />
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
                        <p className="text-[10px] text-gray-400">支持 .md .txt 文件，可多选</p>
                      </div>
                    )}
                  </div>
                  <input type="file" multiple accept=".md,.txt"
                    onChange={e => {
                      const files = e.target.files
                      setAddFiles(files)
                      if (files && files.length > 0 && !addName) {
                        setAddName(files[0].name.replace(/\.(md|txt)$/i, ''))
                      }
                    }}
                    className="hidden" />
                </label>
                {addFiles && addFiles.length > 0 && (
                  <div className="text-[10px] text-gray-400 mt-1.5">
                    已选 {addFiles.length} 个文件
                  </div>
                )}
                <div className="bg-gray-50 rounded-lg p-3 space-y-2.5 mt-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-10">名称</span>
                    <input value={addName} onChange={e => setAddName(e.target.value)}
                      className="flex-1 text-xs bg-transparent border-0 border-b border-dashed border-gray-300 px-0 py-0.5 focus:outline-none focus:border-cyber-blue font-mono font-bold text-gray-700"
                      placeholder="自动从文件名识别..." />
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
              </div>
            )}

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
