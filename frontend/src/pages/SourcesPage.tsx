import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { fetchSources, addSource, addSourceZip, syncSource, deleteSourceApi } from '@/api/client'
import type { SourceItem } from '@/api/client'
import {
  Upload, Globe, Database, RefreshCw, Trash2, Loader2,
  FileText, FileCode, Link, X, Check, ChevronDown,
} from 'lucide-react'

export function SourcesPage() {
  const [sources, setSources] = useState<SourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)

  // 上传本地文档弹窗
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null)
  const [uploading, setUploading] = useState(false)

  // 添加在线文档弹窗
  const [showOnlineModal, setShowOnlineModal] = useState(false)
  const [onlineUrl, setOnlineUrl] = useState('')
  const [onlineName, setOnlineName] = useState('')
  const [onlineType, setOnlineType] = useState<'code' | 'docs'>('code')
  const [onlineMode, setOnlineMode] = useState<'git' | 'svn'>('git')
  const [addingOnline, setAddingOnline] = useState(false)

  // 从 URL 智能推断名称和类型
  const parseUrl = (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) { setOnlineName(''); return }

    // 检测 git vs svn
    if (trimmed.startsWith('svn://') || trimmed.startsWith('svn+ssh://')) {
      setOnlineMode('svn')
    } else {
      setOnlineMode('git')
    }

    // 从 URL 提取项目名
    let name = ''
    // git@github.com:user/repo.git → repo
    // https://github.com/user/repo.git → repo
    // svn://example.com/svn/project/trunk → project
    const m = trimmed.match(/[\/:](\w[\w.-]*?)(?:\.git)?\/?$/)
    if (m) name = m[1]
    // 如果还没有，取最后一段
    if (!name) {
      const parts = trimmed.replace(/\/+$/, '').split('/')
      name = parts[parts.length - 1].replace(/\.git$/, '')
    }
    setOnlineName(name || '')
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

  // 上传文档
  const handleUploadDocs = async () => {
    if (!uploadFiles || uploadFiles.length === 0) return
    setUploading(true)
    let ok = 0
    for (const file of Array.from(uploadFiles)) {
      const form = new FormData()
      form.append('file', file)
      form.append('tags', 'uploaded')
      try {
        const resp = await fetch('/api/documents/upload', { method: 'POST', body: form })
        const data = await resp.json()
        if (resp.ok) ok++
      } catch { /* skip */ }
    }
    setUploading(false)
    setShowUploadModal(false)
    setUploadFiles(null)
    showSuccess(`成功上传 ${ok}/${uploadFiles.length} 个文档`)
    // 刷新列表
    loadAll()
  }

  // 添加在线文档
  const handleAddOnline = async () => {
    if (!onlineName.trim() || !onlineUrl.trim()) return
    setAddingOnline(true)
    setShowOnlineModal(false)

    // 立即插入一条"同步中"条目
    const tempName = onlineName.trim()
    setSources(prev => [...prev, {
      name: tempName,
      type: onlineType as 'code' | 'docs',
      url: onlineUrl.trim(),
      _status: 'syncing',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as SourceItem])

    try {
      const body: Record<string, string> = {
        name: tempName,
        type: onlineType,
      }
      if (onlineMode === 'svn') {
        body.url = onlineUrl.trim()
        body.svn_url = onlineUrl.trim()
      } else {
        body.url = onlineUrl.trim()
      }
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || data.error || '添加失败')
      setOnlineUrl(''); setOnlineName('')
      showSuccess(`「${tempName}」添加成功`)
    } catch (e: any) {
      // 更新为失败状态
      setSources(prev => prev.map(s =>
        s.name === tempName ? { ...s, _status: 'error' as const } : s
      ))
      showError(`「${tempName}」添加失败: ${e.message || '请查看后台日志'}`)
      return
    }
    // 刷新真实数据
    const s = await fetchSources().catch(() => [])
    setSources(s)
    setAddingOnline(false)
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

          {/* 标题 + 右上角操作按钮 */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Database className="w-5 h-5 text-cyber-blue" /> 知识管理
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowUploadModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-cyber-blue/5 hover:border-cyber-blue hover:text-cyber-blue transition"
              >
                <Upload className="w-3.5 h-3.5" /> 上传本地文档
              </button>
              <button
                onClick={() => setShowOnlineModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark transition"
              >
                <Globe className="w-3.5 h-3.5" /> 添加在线文档
              </button>
            </div>
          </div>

          {/* 列表 */}

            {loading ? (
              <div className="text-center text-gray-400 py-8 text-sm">加载中...</div>
            ) : sources.length === 0 && uploadedDocs.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
                <Database className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-400">暂无知识源</p>
                <p className="text-xs text-gray-300 mt-1">点击上方按钮添加代码仓库或文档</p>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2.5 font-bold text-gray-500 uppercase tracking-wider">名称</th>
                      <th className="text-left px-4 py-2.5 font-bold text-gray-500 uppercase tracking-wider">类型</th>
                      <th className="text-left px-4 py-2.5 font-bold text-gray-500 uppercase tracking-wider">版本</th>
                      <th className="text-left px-4 py-2.5 font-bold text-gray-500 uppercase tracking-wider hidden md:table-cell">地址</th>
                      <th className="text-left px-4 py-2.5 font-bold text-gray-500 uppercase tracking-wider hidden sm:table-cell">更新</th>
                      <th className="text-right px-4 py-2.5 font-bold text-gray-500 uppercase tracking-wider">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* 上传的文档 */}
                    {uploadedDocs.map(d => (
                      <tr key={`doc-${d.slug}`} className="border-b border-gray-100 hover:bg-gray-50 transition">
                        <td className="px-4 py-3 font-mono font-bold text-gray-800">{d.slug}</td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">upload</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-500 text-[10px]">{d.filename}</td>
                        <td className="px-4 py-3 text-gray-400 truncate max-w-[200px] hidden md:table-cell text-[10px]">{(d.size / 1024).toFixed(1)} KB</td>
                        <td className="px-4 py-3 text-gray-400 hidden sm:table-cell">{d.updated_at?.slice(0, 10)}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={async () => {
                            if (!confirm(`确认删除文档「${d.slug}」？`)) return
                            // 暂不支持直接删除，提示
                            showError('文档删除暂不支持，可手动删除文件')
                          }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {/* 知识源 */}
                    {sources.map(s => {
                      const status = (s as any)._status
                      return (
                      <tr key={s.name} className="border-b border-gray-100 hover:bg-gray-50 transition">
                        <td className="px-4 py-3 font-mono font-bold text-gray-800 flex items-center gap-2">
                          {s.name}
                          {status === 'syncing' && (
                            <Loader2 className="w-3 h-3 animate-spin text-cyber-blue" />
                          )}
                        </td>
                        <td className="px-4 py-3 flex items-center gap-1.5">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            s.type === 'code' ? 'bg-cyber-blue/10 text-cyber-blue' :
                            s.type === 'docs' ? 'bg-cyber-green/10 text-cyber-green' :
                            'bg-purple-100 text-purple-700'
                          }`}>{s.type}</span>
                          {status === 'syncing' && (
                            <span className="text-[10px] text-cyber-blue font-medium">同步中...</span>
                          )}
                          {status === 'error' && (
                            <span className="text-[10px] text-red-500 font-medium">失败</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-500">
                          {s.git_commit ? s.git_commit.slice(0, 7) : '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-400 truncate max-w-[200px] hidden md:table-cell">{s.url || s.svn_url || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 hidden sm:table-cell">{s.updated_at?.slice(0, 10)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            {s.url && (
                              <button onClick={async () => {
                                setSyncing(s.name)
                                try {
                                  await syncSource(s.name)
                                  setSources(await fetchSources())
                                  showSuccess(`「${s.name}」同步成功`)
                                } catch {
                                  showError(`「${s.name}」同步失败`)
                                }
                                setSyncing(null)
                              }} disabled={syncing === s.name}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50">
                                {syncing === s.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                同步
                              </button>
                            )}
                            <button onClick={async () => {
                              if (!confirm(`确认删除「${s.name}」？`)) return
                              await deleteSourceApi(s.name)
                              setSources(await fetchSources())
                            }}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition">
                              <Trash2 className="w-3 h-3" /> 删除
                            </button>
                          </div>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </main>

      {/* ── 上传本地文档弹窗 ── */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowUploadModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Upload className="w-4 h-4 text-cyber-blue" /> 上传本地文档
              </h2>
              <button onClick={() => setShowUploadModal(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-cyber-blue transition">
              <FileText className="w-10 h-10 mx-auto text-gray-300 mb-2" />
              <p className="text-xs text-gray-500 mb-3">支持 .md .txt .pdf，可多选</p>
              <input
                type="file"
                multiple
                accept=".md,.txt,.pdf"
                onChange={e => setUploadFiles(e.target.files)}
                className="text-sm w-full"
              />
            </div>
            {uploadFiles && uploadFiles.length > 0 && (
              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                已选 {uploadFiles.length} 个文件
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowUploadModal(false); setUploadFiles(null) }}
                className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition">取消</button>
              <button onClick={handleUploadDocs} disabled={!uploadFiles || uploadFiles.length === 0 || uploading}
                className="inline-flex items-center gap-1 px-4 py-2 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark transition disabled:opacity-50">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {uploading ? '上传中...' : '上传'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 添加在线文档弹窗 ── */}
      {showOnlineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowOnlineModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Globe className="w-4 h-4 text-cyber-green" /> 添加在线文档
              </h2>
              <button onClick={() => setShowOnlineModal(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>

            {/* URL 输入 — 核心 */}
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block font-medium">仓库地址</label>
              <input
                value={onlineUrl}
                onChange={e => {
                  setOnlineUrl(e.target.value)
                  parseUrl(e.target.value)
                }}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 font-mono"
                placeholder="git@github.com:user/repo.git 或 svn://..."
              />
            </div>

            {/* 自动识别结果 */}
            {onlineUrl.trim() && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-10">名称</span>
                  <span className="text-xs font-mono font-bold text-gray-700">{onlineName || '—'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-10">协议</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setOnlineMode('git')}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${
                        onlineMode === 'git'
                          ? 'bg-orange-100 border-orange-300 text-orange-700'
                          : 'border-gray-200 text-gray-400 hover:bg-gray-100'
                      }`}
                    >
                      Git
                    </button>
                    <button
                      onClick={() => setOnlineMode('svn')}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${
                        onlineMode === 'svn'
                          ? 'bg-purple-100 border-purple-300 text-purple-700'
                          : 'border-gray-200 text-gray-400 hover:bg-gray-100'
                      }`}
                    >
                      SVN
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-10">类型</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setOnlineType('code')}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${
                        onlineType === 'code'
                          ? 'bg-cyber-blue/10 border-cyber-blue text-cyber-blue'
                          : 'border-gray-200 text-gray-400 hover:bg-gray-100'
                      }`}
                    >
                      代码
                    </button>
                    <button
                      onClick={() => setOnlineType('docs')}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${
                        onlineType === 'docs'
                          ? 'bg-cyber-green/10 border-cyber-green text-cyber-green'
                          : 'border-gray-200 text-gray-400 hover:bg-gray-100'
                      }`}
                    >
                      文档
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowOnlineModal(false); setOnlineUrl(''); setOnlineName('') }}
                className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition">取消</button>
              <button onClick={handleAddOnline} disabled={!onlineName.trim() || !onlineUrl.trim() || addingOnline}
                className="inline-flex items-center gap-1 px-4 py-2 text-xs bg-cyber-green text-white rounded-lg hover:bg-cyber-green-dark transition disabled:opacity-50">
                {addingOnline ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                {addingOnline ? '添加中...' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
