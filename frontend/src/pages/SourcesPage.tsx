import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchKBs, createKB, deleteKB, fetchDocuments, uploadDocument, deleteDocument, syncKB, submitSVNAuth } from '@/api/opencodewiki'
import type { KB, Document } from '@/types/opencodewiki'
import { useSessionHistory } from '@/hooks/useSessionHistory'
import {
  Upload, Database, Loader2, FileText, Plus, Check, X, Trash2, Globe, RefreshCw, RotateCw, ArrowDownToLine,
} from 'lucide-react'

export function SourcesPage() {
  const [kbs, setKbs] = useState<KB[]>([])
  const [loading, setLoading] = useState(true)
  useSessionHistory()

  // Selected KB + documents
  const [selectedKB, setSelectedKB] = useState<KB | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [docsLoading, setDocsLoading] = useState(false)

  // Add modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addMode, setAddMode] = useState<'upload' | 'online'>('upload')
  const [addName, setAddName] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [addFiles, setAddFiles] = useState<FileList | null>(null)
  const [addSubmitting, setAddSubmitting] = useState(false)

  // Online repo fields (auto-detected + editable)
  const [repoName, setRepoName] = useState('')
  const [repoType, setRepoType] = useState<'git' | 'svn'>('git')
  const [contentType, setContentType] = useState<'code' | 'docs'>('docs')
  const [repoBranch, setRepoBranch] = useState('main')
  const [nameError, setNameError] = useState('')
  const [branchError, setBranchError] = useState('')
  const [svnUsername, setSvnUsername] = useState('')
  const [svnPassword, setSvnPassword] = useState('')
  const [svnSaveCreds, setSvnSaveCreds] = useState(true)
  const [showAuthDialog, setShowAuthDialog] = useState<{ kbId: string; kbName: string; repoType?: string } | null>(null)
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authSave, setAuthSave] = useState(true)
  const [authSubmitting, setAuthSubmitting] = useState(false)

  // URL → auto-detect
  useEffect(() => {
    if (addMode !== 'online' || !addUrl.trim()) return
    const t = addUrl.trim()
    const detected = /^svn:\/\//i.test(t) || /^svn\+ssh:\/\//i.test(t) ? 'svn' : 'git'
    setRepoType(detected)
    setRepoBranch(detected === 'git' ? 'main' : 'trunk')
    const sshM = t.match(/:([^\/]+)\/([^\/]+?)(\.git)?\/?$/)
    const httpM = t.match(/\/([^\/]+?)(\.git)?\/?$/)
    const name = sshM ? sshM[2] : (httpM ? httpM[1] : '')
    if (name) setRepoName(name)
  }, [addUrl, addMode])

  // Toast
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(null), 3000) }
  const showError = (msg: string) => { setError(msg); setTimeout(() => setError(null), 5000) }

  const loadKBs = useCallback(async () => {
    try { setKbs(await fetchKBs()) } catch {}
    setLoading(false)
  }, [])

  const loadDocuments = useCallback(async (kbId: string) => {
    setDocsLoading(true)
    try { setDocuments(await fetchDocuments(kbId)) } catch {}
    setDocsLoading(false)
  }, [])

  // Track running rebuild tasks
  const [runningTasks, setRunningTasks] = useState<Record<string, {progress: number; msg: string}>>({})
  const kbsRef = useRef(kbs)
  kbsRef.current = kbs
  const dismissedTaskIdsRef = useRef(new Set<string>())
  const pendingRepoUrlRef = useRef('')

  useEffect(() => { loadKBs() }, [loadKBs])

  useEffect(() => {
    if (selectedKB) loadDocuments(selectedKB.id)
  }, [selectedKB, loadDocuments])

  // Poll running tasks for rebuild status
  useEffect(() => {
    const poll = async () => {
      try {
        const [runningTasks_, pendingTasks_] = await Promise.all([
          fetch('/api/tasks?status=running').then(r => r.json()),
          fetch('/api/tasks?status=pending').then(r => r.json()),
          fetch('/api/tasks?status=cancelled').then(r => r.json()),
        ])
        const tasks = [
          ...(Array.isArray(runningTasks_) ? runningTasks_ : []),
          ...(Array.isArray(pendingTasks_) ? pendingTasks_ : []),
        ]
        const map: Record<string, {progress: number; msg: string}> = {}
        for (const t of Array.isArray(tasks) ? tasks : []) {
          if (t.kb_id && (t.type === 'rebuild' || t.type === 'sync_repo')) {
            map[t.kb_id] = { progress: t.progress || 0, msg: t.progress_msg || '同步中...' }
          }
        }
        setRunningTasks(map)
        // Detect SVN auth required — use refs to avoid stale closure
        for (const t of Array.isArray(tasks) ? tasks : []) {
          if (t.params?.auth_required && t.kb_id && !dismissedTaskIdsRef.current.has(t.id)) {
            const kb = kbsRef.current.find((k: KB) => k.id === t.kb_id)
            // Only prompt if KB still needs sync (no documents imported yet)
            if (kb && (kb.doc_count || 0) === 0) {
              setShowAuthDialog({ kbId: t.kb_id, kbName: kb.name || '' })
            }
          }
        }
      } catch {}
    }
    poll()
    const timer = setInterval(poll, 3000)
    return () => clearInterval(timer)
  }, [])

  const handleAddSubmit = async () => {
    if (addMode === 'online' ? !repoName.trim() : !addName.trim()) return
    setBranchError('')
    setAddSubmitting(true)
    let shouldReset = true

    try {
      const name = repoName.trim()
      const desc = addUrl.trim()

      if (addMode === 'online') {
        // Pre-check if auth needed before creating task (SVN or Git HTTPS)
        const needsPreCheck = (
          (repoType === 'svn' && !svnUsername.trim() && !svnPassword.trim()) ||
          (repoType === 'git' && !svnUsername.trim() && !svnPassword.trim())
        )
        if (needsPreCheck) {
          try {
            const check = await fetch('/api/check-repo-auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ repo_url: addUrl.trim(), repo_branch: repoBranch, repo_type: repoType }),
            }).then(r => r.json())
            if (!check.ok && check.error) {
              setBranchError(check.error)
              if (check.default_branch) {
                setRepoBranch(check.default_branch)
              }
              setAddSubmitting(false)
              shouldReset = false
              return
            }
            if (check.auth_required) {
              pendingRepoUrlRef.current = addUrl.trim()
              setSvnUsername(''); setSvnPassword(''); setSvnSaveCreds(true)
              setShowAuthDialog({ kbId: 'new', kbName: name, repoType })
              setAddSubmitting(false)
              return
            }
          } catch {}
        }

        // 成功后才关窗口

        // 1. Create KB with repo info, then trigger sync
        const kb = await createKB(name, desc, {
          repo_url: addUrl.trim(), repo_type: repoType,
          repo_branch: repoBranch, content_type: contentType,
          svn_username: svnSaveCreds ? svnUsername : '',
          svn_password: svnSaveCreds ? svnPassword : '',
        })
        await syncKB(kb.id, svnSaveCreds ? undefined : svnUsername,
                     svnSaveCreds ? undefined : svnPassword)
        showSuccess(`仓库「${name}」已添加，首轮同步已启动`)
        setShowAddModal(false)
      } else if (addMode === 'upload' && addFiles && addFiles.length > 0) {
        const kb = await createKB(name, desc)
        // 2. Upload files
        let ok = 0
        for (const file of Array.from(addFiles)) {
          try { await uploadDocument(kb.id, file); ok++ } catch {}
        }
        showSuccess(`知识库「${name}」已创建，上传 ${ok}/${addFiles.length} 个文档`)
      } else {
        showSuccess(`知识库「${name}」已创建`)
        setShowAddModal(false)
      }
      await loadKBs()
    } catch (e: any) {
      const msg = e.message || '未知错误'
      if (msg.includes('已存在')) {
        setNameError(msg)
        setAddSubmitting(false)
        shouldReset = false
        return  // 不关闭窗口，不重置表单
      }
      showError(`创建失败: ${msg}`)
    } finally {
      if (shouldReset) {
        setAddName(''); setAddDesc(''); setAddUrl(''); setAddFiles(null); setAddSubmitting(false)
        setRepoName(''); setRepoType('git'); setRepoBranch('main')
      }
    }
  }

  const handleDeleteKB = async (kb: KB) => {
    if (!confirm(`确认删除知识库「${kb.name}」及其所有文档？`)) return
    try { await deleteKB(kb.id); setSelectedKB(null); await loadKBs(); showSuccess(`已删除「${kb.name}」`) }
    catch (e: any) { showError(`删除失败: ${e.message || '未知错误'}`) }
  }

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedKB || !e.target.files?.length) return
    const file = e.target.files[0]
    try {
      await uploadDocument(selectedKB.id, file)
      await loadDocuments(selectedKB.id)
      showSuccess(`「${file.name}」上传成功`)
    } catch (e: any) { showError(`上传失败: ${e.message}`) }
    e.target.value = ''
  }

  const handleDeleteDoc = async (docId: string) => {
    if (!selectedKB) return
    try { await deleteDocument(selectedKB.id, docId); await loadDocuments(selectedKB.id) }
    catch (e: any) { showError(`删除失败: ${e.message}`) }
  }

  const handleRebuildIndex = async () => {
    if (!selectedKB) return
    try {
      const resp = await fetch(`/api/kb/${selectedKB.id}/rebuild`, { method: 'POST' })
      if (!resp.ok) throw new Error((await resp.json()).detail)
      showSuccess(`重建任务已提交，卡片会显示进度`)
    } catch (e: any) { showError(`重建失败: ${e.message || '未知错误'}`) }
  }

  const statusColor = (status: string) =>
    status === 'completed' ? 'text-green-600' : status === 'failed' ? 'text-red-600' : 'text-yellow-600'

  const handleAuthSubmit = async () => {
    if (!showAuthDialog) return
    setAuthSubmitting(true)
    try {
      if (showAuthDialog.kbId === 'new') {
        // Pre-check flow: create KB with credentials, then sync
        const repoType = showAuthDialog.repoType || 'svn'
        const branch = repoType === 'svn' ? 'trunk' : 'main'
        const kb = await createKB(showAuthDialog.kbName, pendingRepoUrlRef.current, {
          repo_url: pendingRepoUrlRef.current, repo_type: repoType,
          repo_branch: branch, content_type: 'docs',
          svn_username: authSave ? authUsername : '',
          svn_password: authSave ? authPassword : '',
        })
        await syncKB(kb.id, authSave ? undefined : authUsername,
                     authSave ? undefined : authPassword)
        await loadKBs()
        setSelectedKB(kb)
        showSuccess(`仓库「${showAuthDialog.kbName}」已添加，首轮同步已启动`)
      } else {
        await submitSVNAuth(showAuthDialog.kbId, authUsername, authPassword, authSave)
        showSuccess('认证信息已提交，正在重新同步')
      }
      setShowAuthDialog(null); setAuthUsername(''); setAuthPassword('')
    } catch (e: any) {
      showError(`认证失败: ${e.message || '未知错误'}`)
    }
    setAuthSubmitting(false)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toast */}
      {success && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
          <Check className="w-3.5 h-3.5" /> {success}
        </div>
      )}
      {error && (
        <div className="fixed bottom-6 right-6 z-50 bg-red-600 text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
          <X className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Database className="w-5 h-5 text-cyber-blue" /> 知识库
            </h2>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-16 text-sm">加载中...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">

              {/* KB cards */}
              {kbs.map(kb => (
                <div
                  key={kb.id}
                  onClick={() => setSelectedKB(kb)}
                  className={`bg-white border rounded-xl p-4 flex flex-col gap-2 cursor-pointer transition ${
                    selectedKB?.id === kb.id
                      ? 'ring-2 ring-cyber-blue shadow-md border-cyber-blue'
                      : 'border-gray-200 hover:shadow-sm hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-cyber-blue/10">
                        <FileText className="w-4 h-4 text-cyber-blue" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-gray-900 truncate flex items-center gap-1">
                          {kb.name}
                          {kb.is_default && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1 py-0 rounded flex-shrink-0">默认</span>
                          )}
                          {(kb.chunk_count || 0) > 0 && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block shrink-0" />
                          )}
                        </div>
                      </div>
                    </div>
                    {!kb.is_default && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteKB(kb) }}
                        className="text-gray-300 hover:text-red-500 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 line-clamp-2">
                    {kb.repo_url ? kb.repo_url : (kb.description || '暂无描述')}
                  </p>
                  {kb.repo_url && kb.repo_type && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-mono">{kb.repo_type.toUpperCase()}</span>
                      {kb.repo_version && <span className="text-[10px] text-gray-400 font-mono">{kb.repo_version.slice(0, 7)}</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 pt-1 flex-wrap">
                    {runningTasks[kb.id] ? (
                      <span className="flex items-center gap-1 text-amber-600">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        重建中 {runningTasks[kb.id].msg}
                      </span>
                    ) : (
                      <>
                        {kb.doc_count !== undefined && <span>{kb.doc_count} 文档</span>}
                        {kb.chunk_count !== undefined && <span>{kb.chunk_count} 分片</span>}
                        {kb.created_at && <span>· {kb.created_at.slice(0, 10)}</span>}
                      </>
                    )}
                  </div>
                </div>
              ))}

              {/* Plus-box — 新建知识库 */}
              <button
                onClick={() => { setAddName(''); setAddDesc(''); setAddUrl(''); setAddFiles(null); setRepoName(''); setRepoType('git'); setContentType('docs'); setRepoBranch('main'); setSvnUsername(''); setSvnPassword(''); setSvnSaveCreds(true); setNameError(''); setBranchError(''); setShowAddModal(true) }}
                className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center gap-2 hover:border-cyber-blue hover:bg-cyber-blue/5 transition group min-h-[160px]"
              >
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center group-hover:bg-cyber-blue/10 transition">
                  <Plus className="w-5 h-5 text-gray-400 group-hover:text-cyber-blue" />
                </div>
                <span className="text-sm font-bold text-gray-500 group-hover:text-cyber-blue">新建知识库</span>
                <span className="text-[10px] text-gray-400">上传文档或创建空知识库</span>
              </button>

            </div>
          )}

          {/* Selected KB — document list */}
          {selectedKB && (
            <div className="pt-4 border-t space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm">{selectedKB.name}</h3>
                  <p className="text-xs text-gray-400">
                    {docsLoading ? '加载中...' : `${documents.length} 个文档 · 模型 ${selectedKB.embedding_model}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedKB.repo_url && (
                    <button onClick={() => syncKB(selectedKB.id).then(() => showSuccess('同步任务已提交')).catch(e => showError(`同步失败: ${e.message}`))}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition">
                      <ArrowDownToLine className="w-3.5 h-3.5" /> 同步远程
                    </button>
                  )}
                  <button onClick={handleRebuildIndex}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition">
                    <RefreshCw className="w-3.5 h-3.5" /> 重建索引
                  </button>
                  <label className="cursor-pointer">
                    <button className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark transition" onClick={() => {}}>
                      <Upload className="w-3.5 h-3.5" /> 上传文档
                    </button>
                    <input type="file" className="hidden" accept=".md,.txt,.pdf,.docx" onChange={handleUploadDoc} />
                  </label>
                </div>
              </div>

              {documents.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">暂无文档，点击上方按钮上传。</p>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-10">#</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500">文件名</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-20">状态</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-16">切片</th>
                        <th className="text-right px-4 py-2.5 font-medium text-gray-500 w-20">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {documents.map((doc, idx) => (
                        <tr key={doc.id} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-2.5 text-gray-400 tabular-nums">{idx + 1}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 shrink-0 text-gray-400" />
                              <span className="text-gray-700 truncate max-w-[300px]">{doc.title}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={statusColor(doc.status)}>
                              {doc.status === 'completed' ? '已完成' : doc.status === 'failed' ? '失败' : '处理中'}
                            </span>
                            {doc.error_message && (
                              <span className="block text-red-400 truncate max-w-[120px]" title={doc.error_message}>{doc.error_message}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500">
                            {doc.status === 'completed' ? doc.chunks_count : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => {
                                if (!selectedKB) return;
                                fetch(`/api/kb/${selectedKB.id}/documents/${doc.id}/rebuild`, {method:'POST'})
                                  .then(r => r.ok ? showSuccess(`「${doc.title}」重建已提交`) : Promise.reject())
                                  .then(() => setTimeout(() => loadDocuments(selectedKB.id), 1000))
                                  .catch(() => showError(`重建失败`));
                              }}
                                className="text-gray-300 hover:text-cyber-blue p-1 rounded hover:bg-cyber-blue/5 transition"
                                title="重建">
                                <RotateCw className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDeleteDoc(doc.id)}
                                className="text-gray-300 hover:text-red-500 p-1 rounded hover:bg-red-50 transition"
                                title="删除">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── 新建知识库弹窗 ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-900">新建知识库</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 mb-4">
              <button
                onClick={() => { setAddMode('upload'); setAddUrl(''); setRepoName(''); setRepoType('git'); setContentType('docs'); setRepoBranch('main') }}
                className={`flex-1 pb-2 text-xs font-bold border-b-2 transition ${addMode === 'upload' ? 'border-cyber-blue text-cyber-blue' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                <Upload className="w-3.5 h-3.5 inline mr-1" />上传本地文件
              </button>
              <button
                onClick={() => { setAddMode('online'); setAddFiles(null); setAddName('') }}
                className={`flex-1 pb-2 text-xs font-bold border-b-2 transition ${addMode === 'online' ? 'border-cyber-blue text-cyber-blue' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                <Globe className="w-3.5 h-3.5 inline mr-1" />添加在线仓库
              </button>
            </div>


            {addMode === 'online' ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">仓库地址</label>
                  <input value={addUrl} onChange={e => setAddUrl(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 font-mono"
                    placeholder="https://github.com/user/repo" />
                </div>

                {addUrl.trim() && (
                  <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-10 shrink-0">名称</span>
                      <input value={repoName} onChange={e => { setNameError(''); setRepoName(e.target.value) }}
                        className={`flex-1 text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 bg-white ${nameError ? 'border-red-400' : 'border-gray-200'}`} />
                    </div>
                    {nameError && <p className="text-xs text-red-500 -mt-2 mb-2 ml-10">{nameError}</p>}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-10 shrink-0">类型</span>
                      <div className="flex gap-1">
                        {(['code', 'docs'] as const).map(t => (
                          <button key={t} onClick={() => setContentType(t)}
                            className={`px-3 py-1 text-xs font-bold rounded-lg border transition ${
                              contentType === t
                                ? 'bg-white border-cyber-blue text-cyber-blue shadow-sm'
                                : 'bg-white/60 border-gray-200 text-gray-400 hover:border-gray-300'
                            }`}>
                            {t === 'code' ? '代码' : '文档'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-10 shrink-0">协议</span>
                      <div className="flex gap-1">
                        {(['git', 'svn'] as const).map(t => (
                          <button key={t} onClick={() => { setRepoType(t); setRepoBranch(t === 'svn' ? 'trunk' : 'main') }}
                            className={`px-3 py-1 text-xs font-bold rounded-lg border transition ${
                              repoType === t
                                ? 'bg-white border-cyber-blue text-cyber-blue shadow-sm'
                                : 'bg-white/60 border-gray-200 text-gray-400 hover:border-gray-300'
                            }`}>
                            {t.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                    {repoType === 'git' && (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400 w-10 shrink-0">分支</span>
                        <input value={repoBranch} onChange={e => { setRepoBranch(e.target.value); setBranchError('') }}
                          className={`flex-1 text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 bg-white font-mono ${branchError ? 'border-red-400' : 'border-gray-200'}`} />
                        {branchError && <p className="text-xs text-red-500 mt-1">{branchError}</p>}
                      </div>
                    )}
                    {repoType === 'svn' && (
                      <div className="border-t border-gray-100 pt-3 mt-2 space-y-2.5">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-400 w-10 shrink-0">用户名</span>
                          <input value={svnUsername} onChange={e => setSvnUsername(e.target.value)}
                            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 bg-white font-mono"
                            placeholder="可选" />
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-400 w-10 shrink-0">密码</span>
                          <input type="password" value={svnPassword} onChange={e => setSvnPassword(e.target.value)}
                            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 bg-white font-mono"
                            placeholder="可选" />
                        </div>
                        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                          <input type="checkbox" checked={svnSaveCreds} onChange={e => setSvnSaveCreds(e.target.checked)}
                            className="rounded border-gray-300 text-cyber-blue focus:ring-cyber-blue/20" />
                          保存密码到知识库
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">知识库名称</label>
                  <input value={addName} onChange={e => setAddName(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20"
                    placeholder="输入名称" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">描述（可选）</label>
                  <input value={addDesc} onChange={e => setAddDesc(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20"
                    placeholder="简单描述知识库内容" />
                </div>
                {/* File upload zone */}
                <label className="cursor-pointer block">
                  <div className={`border-2 border-dashed rounded-xl p-6 text-center transition ${addFiles && addFiles.length > 0 ? 'border-cyber-blue bg-cyber-blue/5' : 'border-gray-300 hover:border-cyber-blue hover:bg-gray-50'}`}>
                    <Upload className={`w-8 h-8 mx-auto mb-1 ${addFiles && addFiles.length > 0 ? 'text-cyber-blue' : 'text-gray-300'}`} />
                    {addFiles && addFiles.length > 0 ? (
                      <div>
                        <p className="text-sm font-bold text-cyber-blue mb-1">已选 {addFiles.length} 个文件</p>
                        <p className="text-[10px] text-gray-400">点击重新选择</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-bold text-gray-600 mb-1">上传初始文档（可选）</p>
                        <p className="text-[10px] text-gray-400">支持 .md .txt .pdf .docx，可多选</p>
                      </div>
                    )}
                  </div>
                  <input type="file" multiple accept=".md,.txt,.pdf,.docx"
                    onChange={e => setAddFiles(e.target.files)}
                    className="hidden" />
                </label>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-4">
              <button onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition">取消</button>
              <button onClick={handleAddSubmit} disabled={addSubmitting || (addMode === 'online' ? !repoName.trim() || !addUrl.trim() : !addName.trim())}
                className="inline-flex items-center gap-1 px-4 py-2 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark transition disabled:opacity-50">
                {addSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {addSubmitting ? '创建中...' : addMode === 'online' ? '添加并同步' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 认证弹窗 ── */}
      {showAuthDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowAuthDialog(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-900 mb-1">认证</h3>
            <p className="text-xs text-gray-400 mb-4">{showAuthDialog.kbName} 需要输入密码</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">用户名</label>
                <input value={authUsername} onChange={e => setAuthUsername(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">密码</label>
                <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                <input type="checkbox" checked={authSave} onChange={e => setAuthSave(e.target.checked)}
                  className="rounded border-gray-300 text-cyber-blue focus:ring-cyber-blue/20" />
                保存密码到知识库
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <button onClick={() => { setShowAuthDialog(null); setAuthUsername(''); setAuthPassword('') }}
                className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition">取消</button>
              <button onClick={handleAuthSubmit} disabled={authSubmitting || !authUsername.trim()}
                className="inline-flex items-center gap-1 px-4 py-2 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark transition disabled:opacity-50">
                {authSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                提交并重试
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
