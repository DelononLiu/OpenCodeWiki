import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { fetchSources, addSource, addSourceZip, syncSource, deleteSourceApi } from '@/api/client'
import type { SourceItem } from '@/api/client'
import { Database, Plus, RefreshCw, Trash2, Loader2 } from 'lucide-react'

export function SourcesPage() {
  const [sources, setSources] = useState<SourceItem[]>([])
  const [showSourceModal, setShowSourceModal] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [newSourceName, setNewSourceName] = useState('')
  const [newSourceType, setNewSourceType] = useState<'code' | 'docs'>('code')
  const [newSourceUrl, setNewSourceUrl] = useState('')
  const [newSourceZip, setNewSourceZip] = useState<File | null>(null)
  const [sourceMode, setSourceMode] = useState<'git' | 'zip'>('git')
  const [addingSource, setAddingSource] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  useEffect(() => {
    fetchSources().then(setSources).catch(() => {})
  }, [])

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" />
      <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
        <div className="max-w-4xl mx-auto space-y-4">
          {pageError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 rounded-xl flex items-center justify-between">
              <span>{pageError}</span>
              <button onClick={() => setPageError(null)} className="text-red-400 hover:text-red-600 ml-2">&times;</button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Database className="w-5 h-5 text-cyber-blue" /> 知识管理
            </h2>
            <button onClick={() => setShowSourceModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark transition">
              <Plus className="w-3.5 h-3.5" /> 添加知识源
            </button>
          </div>

          {sources.length === 0 ? (
            <div className="text-center text-gray-400 py-16 text-sm">暂无知识源，点击上方按钮添加</div>
          ) : (
            <div className="space-y-2">
              {sources.map(s => (
                <div key={s.name} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between hover:border-gray-300 transition">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-sm font-bold text-gray-800">{s.name}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${s.type === 'code' ? 'bg-cyber-blue/10 text-cyber-blue' : 'bg-cyber-green/10 text-cyber-green'}`}>{s.type}</span>
                    {s.git_commit && (
                      <span className="text-[10px] text-gray-400 font-mono bg-gray-100 px-1.5 py-0.5 rounded" title={s.git_commit}>
                        #{s.git_count} · {s.git_commit?.slice(0, 12)}...
                      </span>
                    )}
                    <span className="text-xs text-gray-400 font-mono truncate max-w-[200px]">{s.url || '(zip 导入)'}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-gray-400">{s.updated_at?.slice(0, 10)}</span>
                    {s.url && (
                      <button onClick={async () => {
                        setSyncing(s.name)
                        try {
                          await syncSource(s.name)
                          setSources(await fetchSources())
                        } catch {}
                        setSyncing(null)
                      }} disabled={syncing === s.name}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50">
                        {syncing === s.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        同步
                      </button>
                    )}
                    <button onClick={async () => {
                      if (!confirm(`确认删除知识源「${s.name}」？`)) return
                      await deleteSourceApi(s.name)
                      setSources(await fetchSources())
                    }}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition">
                      <Trash2 className="w-3 h-3" /> 删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showSourceModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowSourceModal(false)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2"><Database className="w-4 h-4 text-cyber-blue" /> 添加知识源</h2>
                <button onClick={() => setShowSourceModal(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">名称</label>
                <input value={newSourceName} onChange={e => setNewSourceName(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" placeholder="my-project" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">类型</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="st" checked={newSourceType === 'code'} onChange={() => setNewSourceType('code')} />
                    <span className="text-[10px] bg-cyber-blue/10 text-cyber-blue font-bold px-1.5 py-0.5 rounded-full">code</span> 代码仓库
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="st" checked={newSourceType === 'docs'} onChange={() => setNewSourceType('docs')} />
                    <span className="text-[10px] bg-cyber-green/10 text-cyber-green font-bold px-1.5 py-0.5 rounded-full">docs</span> 纯文档
                  </label>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">来源</label>
                <div className="flex gap-4 mb-2">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="sm" checked={sourceMode === 'git'} onChange={() => setSourceMode('git')} /> git URL
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="sm" checked={sourceMode === 'zip'} onChange={() => setSourceMode('zip')} /> 上传 zip
                  </label>
                </div>
                {sourceMode === 'git' ? (
                  <input value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" placeholder="git@github.com:user/project.git" />
                ) : (
                  <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center">
                    <input type="file" accept=".zip" onChange={e => setNewSourceZip(e.target.files?.[0] || null)} className="text-sm" />
                  </div>
                )}
              </div>
              {sourceError && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{sourceError}</div>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowSourceModal(false); setNewSourceName(''); setNewSourceUrl(''); setNewSourceZip(null); setSourceMode('git'); setNewSourceType('code'); setSourceError(null) }}
                  className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition">取消</button>
                <button onClick={async () => {
                  if (!newSourceName.trim()) { setSourceError('请输入名称'); return }
                  setAddingSource(true); setSourceError(null)
                  try {
                    if (sourceMode === 'git') {
                      await addSource(newSourceName.trim(), newSourceUrl.trim(), newSourceType)
                    } else {
                      if (!newSourceZip) { setSourceError('请选择 zip 文件'); setAddingSource(false); return }
                      await addSourceZip(newSourceName.trim(), newSourceType, newSourceZip)
                    }
                    setSources(await fetchSources())
                    setShowSourceModal(false)
                    setNewSourceName(''); setNewSourceUrl(''); setNewSourceZip(null)
                  } catch (e: any) { setSourceError(e.message); setPageError(e.message) }
                  setAddingSource(false)
                }} disabled={addingSource || !newSourceName.trim()}
                  className="inline-flex items-center gap-1 px-4 py-2 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark transition disabled:opacity-50">
                  {addingSource && <Loader2 className="w-3 h-3 animate-spin" />}
                  {addingSource ? '添加中...' : '提交'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
