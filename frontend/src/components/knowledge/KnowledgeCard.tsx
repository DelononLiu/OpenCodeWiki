import { useState } from 'react'
import { FileText, FileCode, Globe, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import type { SourceItem } from '@/api/client'
import { syncSource, deleteSourceApi } from '@/api/client'

interface KnowledgeCardProps {
  source: SourceItem & { _status?: 'syncing' | 'error' }
  onRefresh: () => void
  onError: (msg: string) => void
  onSuccess: (msg: string) => void
}

export function KnowledgeCard({ source, onRefresh, onError, onSuccess }: KnowledgeCardProps) {
  const [syncing, setSyncing] = useState(false)
  const s = source
  const status = s._status

  const Icon = s.type === 'code' ? FileCode : s.type === 'svn' ? Globe : FileText
  const iconColor = s.type === 'code' ? 'text-cyber-blue' : s.type === 'svn' ? 'text-purple-500' : 'text-cyber-green'
  const badgeColor = s.type === 'code' ? 'bg-cyber-blue/10 text-cyber-blue' :
                     s.type === 'svn' ? 'bg-purple-100 text-purple-700' :
                     'bg-cyber-green/10 text-cyber-green'

  const handleSync = async () => {
    if (!s.url) return
    setSyncing(true)
    try {
      await syncSource(s.name)
      onSuccess(`「${s.name}」同步成功`)
      onRefresh()
    } catch {
      onError(`「${s.name}」同步失败`)
    }
    setSyncing(false)
  }

  const handleDelete = async () => {
    if (!confirm(`确认删除「${s.name}」？`)) return
    await deleteSourceApi(s.name)
    onRefresh()
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2.5 hover:shadow-sm transition group">
      {/* 名称 + 类型 */}
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-cyber-blue/5 flex items-center justify-center shrink-0">
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900 truncate flex items-center gap-1.5">
            {s.name}
            {status === 'syncing' && <Loader2 className="w-3 h-3 animate-spin text-cyber-blue" />}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badgeColor}`}>
              {s.type}
            </span>
            {s.git_commit && (
              <span className="text-[10px] font-mono text-gray-400">{s.git_commit.slice(0, 7)}</span>
            )}
          </div>
        </div>
      </div>

      {/* URL */}
      {(s.url || s.svn_url) && (
        <div className="text-[10px] text-gray-400 truncate font-mono">{s.url || s.svn_url}</div>
      )}

      {/* 更新信息 */}
      <div className="flex items-center justify-between text-[10px] text-gray-400 mt-auto">
        <span>{s.updated_at?.slice(0, 10) || s.created_at?.slice(0, 10) || '-'}</span>
        {status === 'syncing' && <span className="text-cyber-blue font-medium">同步中...</span>}
        {status === 'error' && <span className="text-red-500 font-medium">失败</span>}
      </div>

      {/* 操作按钮（hover 显示） */}
      <div className="flex items-center gap-1 pt-2 border-t border-gray-100 opacity-0 group-hover:opacity-100 transition">
        {s.url && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex-1 inline-flex items-center justify-center gap-1 text-[10px] px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            同步
          </button>
        )}
        <button
          onClick={handleDelete}
          className={`flex-1 inline-flex items-center justify-center gap-1 text-[10px] px-2 py-1 border rounded-lg transition ${
            s.url ? 'border-red-200 text-red-500 hover:bg-red-50' : 'border-gray-200 text-red-500 hover:bg-red-50'
          }`}
        >
          <Trash2 className="w-3 h-3" />
          删除
        </button>
      </div>
    </div>
  )
}
