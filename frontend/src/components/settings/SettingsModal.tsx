import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { fetchSettings, saveSettings } from '@/api/client'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

type TabKey = 'general' | 'knowledge' | 'repos' | 'api' | 'about'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'general', label: '通用' },
  { key: 'knowledge', label: '知识库' },
  { key: 'repos', label: '代码仓库' },
  { key: 'api', label: 'API 配置' },
  { key: 'about', label: '关于' },
]

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('general')
  const [settings, setSettings] = useState<any>(null)
  const [siteName, setSiteName] = useState('OpenCodeWiki')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (open) {
      fetchSettings().then(settings => {
        setSettings(settings)
        setSiteName(settings?.general?.site_name || 'OpenCodeWiki')
      }).catch(() => {})
    }
  }, [open])

  const handleSave = async (section: string, data: Record<string, unknown>) => {
    setSaving(true)
    try {
      await saveSettings(section, data)
      setToast('保存成功')
      setTimeout(() => setToast(''), 2000)
    } catch {
      setToast('保存失败')
      setTimeout(() => setToast(''), 2000)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-[720px] max-h-[560px] flex overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* Left tabs */}
        <div className="w-44 bg-slate-50 border-r border-gray-100 py-4 px-2">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 px-3">设置</div>
          {TABS.map(tab => (
            <button key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition mb-0.5 ${
                activeTab === tab.key
                  ? 'bg-white text-slate-800 font-semibold shadow-sm'
                  : 'text-slate-500 hover:bg-white/50'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-bold text-slate-800">
              ⚙ {TABS.find(t => t.key === activeTab)?.label}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'general' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">站点名称</label>
                  <input type="text" value={siteName} onChange={e => setSiteName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 focus:border-cyber-blue" />
                </div>
                <button
                  onClick={() => handleSave('general', { site_name: siteName })}
                  disabled={saving}
                  className="px-4 py-2 bg-cyber-blue text-white text-xs font-bold rounded-lg hover:bg-cyber-blue-dark transition disabled:opacity-50">
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            )}
            {activeTab !== 'general' && (
              <div className="text-sm text-gray-400 py-8 text-center">
                此设置项将在后续版本中提供
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
