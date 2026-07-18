import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { fetchSettings, saveSettings, fetchSources, addSource, addSourceZip, syncSource, deleteSourceApi } from '@/api/client'
import type { SourceItem } from '@/api/client'
import { Settings, Cpu, Check, Loader2, Database, Plus, RefreshCw, Trash2 } from 'lucide-react'

export function SettingsPage() {
  const [section, setSection] = useState<'general' | 'model' | 'sources'>('general')
  const [siteName, setSiteName] = useState('')
  const [provider, setProvider] = useState('openai')
  const [apiKey, setApiKey] = useState('')
  const [modelName, setModelName] = useState('gpt-4o')
  const [temperature, setTemperature] = useState(0.7)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

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

  useEffect(() => {
    fetchSettings().then((cfg: any) => {
      // 兼容扁平格式 { apiKey, provider, model } 和嵌套格式 { general: { site_name }, model: { ... } }
      if (cfg.general) {
        setSiteName(cfg.general.site_name || '')
      } else {
        setSiteName('OpenCodeWiki')
      }
      if (cfg.model) {
        setProvider(cfg.model.provider || 'openai')
        setApiKey(cfg.model.api_key || '')
        setModelName(cfg.model.model || 'gpt-4o')
        setTemperature(cfg.model.temperature ?? 0.7)
      } else {
        setProvider(cfg.provider || 'openai')
        setApiKey(cfg.apiKey || '')
        setModelName(cfg.model || 'gpt-4o')
        setTemperature(cfg.temperature ?? 0.7)
      }
    }).catch(() => {})
    fetchSources().then(setSources).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true); setSaved(false)
    try {
      // 保存为扁平格式
      await saveSettings(section, section === 'general'
        ? { site_name: siteName }
        : { provider, api_key: apiKey, model: modelName, temperature }
      )
      setSaved(true)
    } catch {}
    setSaving(false)
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" />
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-56 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col shrink-0">
          <div className="p-4 space-y-4 text-xs font-medium">
            <button onClick={() => setSection('general')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition ${
                section === 'general' ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              <Settings className="w-3.5 h-3.5" /> 通用
            </button>
            <button onClick={() => setSection('model')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition ${
                section === 'model' ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              <Cpu className="w-3.5 h-3.5" /> 模型
            </button>
            <button onClick={() => setSection('sources')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition ${
                section === 'sources' ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              <Database className="w-3.5 h-3.5" /> 知识源
            </button>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
          <div className="max-w-4xl mx-auto">
            {section === 'general' ? (
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-bold text-gray-900">通用设置</h2>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">系统名称</label>
                  <input value={siteName} onChange={e => setSiteName(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" />
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                    保存
                  </Button>
                  {saved && <span className="text-xs text-cyber-green">已保存</span>}
                </div>
              </div>
            ) : section === 'model' ? (
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-bold text-gray-900">模型配置</h2>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Provider</label>
                  <select value={provider} onChange={e => setProvider(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20">
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">API Key</label>
                  <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Model</label>
                  <input value={modelName} onChange={e => setModelName(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Temperature: {temperature}</label>
                  <input type="range" min="0" max="2" step="0.1" value={temperature}
                    onChange={e => setTemperature(parseFloat(e.target.value))}
                    className="w-full" />
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                    保存
                  </Button>
                  {saved && <span className="text-xs text-cyber-green">已保存</span>}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Database className="w-5 h-5 text-cyber-blue" /> 知识源管理
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
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                            s.type === 'code' ? 'bg-cyber-blue/10 text-cyber-blue' : 'bg-cyber-green/10 text-cyber-green'
                          }`}>{s.type === 'code' ? 'code' : 'docs'}</span>
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
                              {syncing === s.name
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <RefreshCw className="w-3 h-3" />}
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
            )}
          </div>
          {showSourceModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowSourceModal(false)}>
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <Database className="w-4 h-4 text-cyber-blue" /> 添加知识源
                  </h2>
                  <button onClick={() => setShowSourceModal(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">名称</label>
                  <input value={newSourceName} onChange={e => setNewSourceName(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20"
                    placeholder="my-project" />
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">类型</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="sourceType" checked={newSourceType === 'code'} onChange={() => setNewSourceType('code')} />
                      <span className="text-[10px] bg-cyber-blue/10 text-cyber-blue font-bold px-1.5 py-0.5 rounded-full">code</span>
                      代码仓库
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="sourceType" checked={newSourceType === 'docs'} onChange={() => setNewSourceType('docs')} />
                      <span className="text-[10px] bg-cyber-green/10 text-cyber-green font-bold px-1.5 py-0.5 rounded-full">docs</span>
                      纯文档
                    </label>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">来源</label>
                  <div className="flex gap-4 mb-2">
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="sourceMode" checked={sourceMode === 'git'} onChange={() => setSourceMode('git')} />
                      git URL
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="sourceMode" checked={sourceMode === 'zip'} onChange={() => setSourceMode('zip')} />
                      上传 zip
                    </label>
                  </div>
                  {sourceMode === 'git' ? (
                    <input value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20"
                      placeholder="git@github.com:user/project.git" />
                  ) : (
                    <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center">
                      <input type="file" accept=".zip" onChange={e => setNewSourceZip(e.target.files?.[0] || null)}
                        className="text-sm" />
                    </div>
                  )}
                </div>

                {sourceError && (
                  <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{sourceError}</div>
                )}

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
                    } catch (e: any) { setSourceError(e.message) }
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
    </div>
  )
}
