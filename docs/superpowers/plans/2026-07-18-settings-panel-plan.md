# 设置面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增 `/settings` 独立页面，提供通用配置 + 模型配置，存储为 `config.json`。

**Architecture:** 后端 GET/PUT `/api/settings` 读写 `~/.opencodewiki/config.json`。前端 SettingsPage 左侧两段 nav + 右侧表单。

**Tech Stack:** Python 3.11+, FastAPI, React 18, TypeScript, Tailwind CSS 3, shadcn/ui

## Global Constraints

- 路由：`/settings`（在 `/:repo` 前注册）
- 配置路径：`~/.opencodewiki/config.json`
- API 格式 `{ok, data}`
- 中文 commit message

---

### Task 1: 后端 — GET/PUT /api/settings

**Files:**
- Modify: `src/python-agent/main.py`

**Interfaces:**
- Produces: `GET /api/settings`, `PUT /api/settings`

- [ ] **Step 1: 添加 settings 路由**

在 `src/python-agent/main.py` 中，`# ── Repos ──` 后添加：

```python
# ── Settings ───────────────────────────────────────────────────

CONFIG_PATH = Path.home() / ".opencodewiki" / "config.json"

DEFAULT_CONFIG = {
    "general": {"site_name": "OpenCodeWiki"},
    "model": {"provider": "openai", "api_key": "", "model": "gpt-4o", "temperature": 0.7},
}

def _load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return DEFAULT_CONFIG

def _save_config(config: dict):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2))


@app.get("/api/settings")
async def api_settings():
    return _ok(_load_config())


@app.put("/api/settings")
async def api_settings_update(body: dict):
    section = body.get("section", "")
    data = body.get("data", {})
    if section not in ("general", "model"):
        return _err("Invalid section, must be 'general' or 'model'")
    config = _load_config()
    config[section] = data
    _save_config(config)
    return _ok({"saved": True})
```

- [ ] **Step 2: 验证**

```bash
cd src/python-agent && python3 -c "from main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/python-agent/main.py
git commit -m "feat: GET/PUT /api/settings 通用+模型配置

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 前端 — SettingsPage + 路由 + API client

**Files:**
- Create: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: client.ts 新增 API 函数**

Append to `frontend/src/api/client.ts`:

```typescript
export function fetchSettings(): Promise<{ general: { site_name: string }; model: { provider: string; api_key: string; model: string; temperature: number } }> {
  return request('/settings')
}

export function saveSettings(section: string, data: Record<string, unknown>): Promise<{ saved: boolean }> {
  return request('/settings', { method: 'PUT', body: JSON.stringify({ section, data }) })
}
```

- [ ] **Step 2: 创建 SettingsPage.tsx**

Write `frontend/src/pages/SettingsPage.tsx`:

```typescript
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
```

- [ ] **Step 3: App.tsx 新增路由**

```typescript
import { SettingsPage } from '@/pages/SettingsPage'

// In Routes:
<Route path="/settings" element={<SettingsPage />} />
```

> `/settings` 必须在 `/:repo` 前注册。

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx frontend/src/App.tsx frontend/src/api/client.ts
git commit -m "feat: SettingsPage /settings 通用+模型配置

Co-Authored-By: Claude <noreply@anthropic.com>"
```
