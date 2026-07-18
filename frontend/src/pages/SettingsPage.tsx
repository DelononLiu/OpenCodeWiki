import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { fetchSettings, saveSettings } from '@/api/client'
import { Settings, Cpu, Check, Loader2 } from 'lucide-react'

export function SettingsPage() {
  const [section, setSection] = useState<'general' | 'model'>('general')
  const [general, setGeneral] = useState({ site_name: '' })
  const [model, setModel] = useState({ provider: 'openai', api_key: '', model: 'gpt-4o', temperature: 0.7 })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchSettings().then(cfg => {
      setGeneral(cfg.general)
      setModel(cfg.model)
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true); setSaved(false)
    try {
      await saveSettings(section, section === 'general' ? general as any : model as any)
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
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
          <div className="max-w-2xl mx-auto">
            {section === 'general' ? (
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-bold text-gray-900">通用设置</h2>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">系统名称</label>
                  <input value={general.site_name} onChange={e => setGeneral(prev => ({ ...prev, site_name: e.target.value }))}
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
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-bold text-gray-900">模型配置</h2>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Provider</label>
                  <select value={model.provider} onChange={e => setModel(prev => ({ ...prev, provider: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20">
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">API Key</label>
                  <input type="password" value={model.api_key} onChange={e => setModel(prev => ({ ...prev, api_key: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Model</label>
                  <input value={model.model} onChange={e => setModel(prev => ({ ...prev, model: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Temperature: {model.temperature}</label>
                  <input type="range" min="0" max="2" step="0.1" value={model.temperature}
                    onChange={e => setModel(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
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
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
