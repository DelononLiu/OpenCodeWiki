import { useState, useEffect, useCallback } from 'react'
import { fetchKBs, createKB, deleteKB, fetchDocuments, uploadDocument, deleteDocument } from '@/api/opencodewiki'
import type { KB, Document } from '@/types/opencodewiki'
import { useSessionHistory } from '@/hooks/useSessionHistory'
import {
  Upload, Database, Loader2, FileText, Plus, Check, X, Trash2, Globe, RefreshCw,
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

  useEffect(() => { loadKBs() }, [loadKBs])

  useEffect(() => {
    if (selectedKB) loadDocuments(selectedKB.id)
  }, [selectedKB, loadDocuments])

  const handleAddSubmit = async () => {
    if (!addName.trim()) return
    setAddSubmitting(true)
    setShowAddModal(false)

    try {
      // Build description — append URL for online repos
      const desc = addMode === 'online' && addUrl.trim()
        ? `${addDesc}\n[来源: ${addUrl.trim()}]`.trim()
        : addDesc.trim()

      // 1. Create KB
      const kb = await createKB(addName.trim(), desc)
      // 2. Upload files if in upload mode
      if (addMode === 'upload' && addFiles && addFiles.length > 0) {
        let ok = 0
        for (const file of Array.from(addFiles)) {
          try { await uploadDocument(kb.id, file); ok++ } catch {}
        }
        showSuccess(`知识库「${addName}」已创建，上传 ${ok}/${addFiles.length} 个文档`)
      } else {
        showSuccess(`知识库「${addName}」已创建`)
      }
      await loadKBs()
    } catch (e: any) {
      showError(`创建失败: ${e.message || '未知错误'}`)
    } finally {
      setAddName(''); setAddDesc(''); setAddUrl(''); setAddFiles(null); setAddSubmitting(false)
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
      const docs = await fetchDocuments(selectedKB.id)
      for (const doc of docs) {
        await deleteDocument(selectedKB.id, doc.id)
      }
      for (const doc of docs) {
        if (doc.status === 'completed') {
          // Re-upload each document
          const resp = await fetch(doc.file_path)
          if (resp.ok) {
            const blob = await resp.blob()
            const file = new File([blob], doc.title)
            await uploadDocument(selectedKB.id, file)
          }
        }
      }
      showSuccess(`「${selectedKB.name}」索引重建完成`)
      await loadDocuments(selectedKB.id)
      await loadKBs()
    } catch (e: any) { showError(`重建失败: ${e.message}`) }
  }

  const statusColor = (status: string) =>
    status === 'completed' ? 'text-green-600' : status === 'failed' ? 'text-red-600' : 'text-yellow-600'

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
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
                  <p className="text-xs text-gray-400 line-clamp-2">{kb.description || '暂无描述'}</p>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 pt-1 flex-wrap">
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded">{kb.embedding_model}</span>
                    {kb.doc_count !== undefined && (
                      <span>{kb.doc_count} 文档</span>
                    )}
                    {kb.chunk_count !== undefined && (
                      <span>{kb.chunk_count} 片段</span>
                    )}
                    {kb.created_at && <span>{kb.created_at.slice(0, 10)}</span>}
                  </div>
                </div>
              ))}

              {/* Plus-box — 新建知识库 */}
              <button
                onClick={() => { setAddName(''); setAddDesc(''); setAddFiles(null); setShowAddModal(true) }}
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
                <div className="space-y-1.5">
                  {documents.map(doc => (
                    <div key={doc.id} className="bg-white border border-gray-100 rounded-lg px-4 py-2.5 flex items-center justify-between hover:border-gray-200 transition">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="w-4 h-4 flex-shrink-0 text-gray-400" />
                        <span className="text-sm truncate">{doc.title}</span>
                        <span className={`text-xs flex-shrink-0 ${statusColor(doc.status)}`}>· {doc.status}</span>
                        {doc.status === 'completed' && (
                          <span className="text-xs text-gray-400 flex-shrink-0">· {doc.chunks_count} 切片</span>
                        )}
                        {doc.error_message && (
                          <span className="text-xs text-red-400 truncate">{doc.error_message}</span>
                        )}
                      </div>
                      <button onClick={() => handleDeleteDoc(doc.id)} className="text-gray-300 hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
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
                onClick={() => { setAddMode('upload'); setAddUrl('') }}
                className={`flex-1 pb-2 text-xs font-bold border-b-2 transition ${addMode === 'upload' ? 'border-cyber-blue text-cyber-blue' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                <Upload className="w-3.5 h-3.5 inline mr-1" />上传本地文件
              </button>
              <button
                onClick={() => { setAddMode('online'); setAddFiles(null) }}
                className={`flex-1 pb-2 text-xs font-bold border-b-2 transition ${addMode === 'online' ? 'border-cyber-blue text-cyber-blue' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                <Globe className="w-3.5 h-3.5 inline mr-1" />添加在线仓库
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">知识库名称</label>
                <input value={addName} onChange={e => setAddName(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20"
                  placeholder="输入名称" />
              </div>

              {addMode === 'online' ? (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">仓库地址</label>
                  <input value={addUrl} onChange={e => setAddUrl(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 font-mono"
                    placeholder="https://github.com/user/repo.git" />
                  <p className="text-[10px] text-gray-400 mt-1">Git/SVN 仓库地址，Phase 2 支持自动导入</p>
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <button onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition">取消</button>
              <button onClick={handleAddSubmit} disabled={!addName.trim() || addSubmitting}
                className="inline-flex items-center gap-1 px-4 py-2 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark transition disabled:opacity-50">
                {addSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {addSubmitting ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
