import { useState, useEffect } from 'react'
import { fetchConfig } from '@/api/opencodewiki'
import type { Config } from '@/types/opencodewiki'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Settings, Cpu, Brain } from 'lucide-react'

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null)
  const [llmApiKey, setLlmApiKey] = useState('')
  const [embApiKey, setEmbApiKey] = useState('')

  useEffect(() => {
    fetchConfig().then(setConfig)
  }, [])

  const handleSaveLLM = async () => { /* PUT /api/config */ }
  const handleSaveEmbedding = async () => { /* PUT /api/config */ }

  if (!config) return <div className="p-6">Loading...</div>

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Settings className="w-6 h-6" /> 设置
      </h1>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5" /> LLM 配置</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium">Provider</label>
            <Input value={config.llm.provider} disabled />
          </div>
          <div>
            <label className="text-sm font-medium">Model</label>
            <Input value={config.llm.model} disabled />
          </div>
          <div>
            <label className="text-sm font-medium">Base URL</label>
            <Input value={config.llm.base_url} disabled />
          </div>
          <div>
            <label className="text-sm font-medium">API Key</label>
            <Input type="password" value={llmApiKey} onChange={e => setLlmApiKey(e.target.value)} placeholder="sk-..." />
          </div>
          <Button onClick={handleSaveLLM}>保存 LLM 配置</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="w-5 h-5" /> Embedding 配置</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium">Provider</label>
            <Input value={config.embedding.provider} disabled />
          </div>
          <div>
            <label className="text-sm font-medium">Model</label>
            <Input value={config.embedding.model} disabled />
          </div>
          <div>
            <label className="text-sm font-medium">API Key</label>
            <Input type="password" value={embApiKey} onChange={e => setEmbApiKey(e.target.value)} placeholder="sk-..." />
          </div>
          <Button onClick={handleSaveEmbedding}>保存 Embedding 配置</Button>
        </CardContent>
      </Card>
    </div>
  )
}
