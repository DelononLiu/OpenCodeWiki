# AdminPage 知识源管理 UI — 实施计划

**Goal:** AdminPage 代码库提交标签改为知识源管理，支持查看/添加/同步/删除知识源

**Architecture:** 仅修改 `frontend/src/pages/AdminPage.tsx`，无后端改动。复用现有模态框模式

**Tech Stack:** React, TypeScript, shadcn/ui, Tailwind CSS

---

### Task 1: 添加 API 调用 + 状态管理

- [ ] **Step 1: 新增 fetchSources 导入**

在 AdminPage.tsx 顶部 import 追加：

```typescript
import { fetchSources, addSource, addSourceZip, syncSource, deleteSource } from '@/api/client'
// 需要确认这些函数是否已在 client.ts 中存在，如果没有则需要添加
```

实际上后端 API 已有但前端 client.ts 可能还没有对应的封装函数。需要先检查并添加。

- [ ] **Step 2: 检查前端 API 客户端**

```bash
grep -n "sources\|source" frontend/src/api/client.ts
```

如果缺少，添加以下函数：

```typescript
// ── Sources ──
export interface SourceItem {
  name: string
  type: 'code' | 'docs'
  url?: string
  created_at: string
  updated_at: string
}

export function fetchSources(type?: string): Promise<SourceItem[]> {
  const qs = type ? `?type=${type}` : ''
  return request(`/sources${qs}`)
}

export function addSource(name: string, url: string, type: string): Promise<SourceItem> {
  return request('/sources', {
    method: 'POST',
    body: JSON.stringify({ name, url, type }),
  })
}

export function addSourceZip(name: string, type: string, file: File): Promise<SourceItem> {
  const formData = new FormData()
  formData.append('name', name)
  formData.append('type', type)
  formData.append('file', file)
  return fetch('/api/sources/upload', { method: 'POST', body: formData }).then(r => r.json()).then(d => { if (!d.ok) throw new Error(d.error); return d.data })
}

export function syncSource(name: string): Promise<SourceItem> {
  return request(`/sources/${encodeURIComponent(name)}/sync`, { method: 'POST' })
}

export function deleteSource(name: string): Promise<{ deleted: boolean }> {
  return request(`/sources/${encodeURIComponent(name)}`, { method: 'DELETE' })
}
```

### Task 2: 改造左侧栏标签

- [ ] **Step 1: 修改 currentView 类型**

```typescript
const [currentView, setCurrentView] = useState<'qa' | 'topic' | 'wiki' | 'sources'>('qa')
```

- [ ] **Step 2: 修改左侧栏按钮**

将 `🗃️ 代码库提交` 改为 `📦 知识源管理`，value 改为 `'sources'`

```tsx
<button onClick={() => setCurrentView('sources')}
  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition ${
    currentView === 'sources' ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : 'text-gray-600 hover:bg-gray-100'
  }`}>
  <span>📦 知识源</span>
</button>
```

### Task 3: 知识源列表视图

- [ ] **Step 1: 添加状态变量**

```typescript
const [sources, setSources] = useState<SourceItem[]>([])
const [showSourceModal, setShowSourceModal] = useState(false)
const [syncing, setSyncing] = useState<string | null>(null)
```

- [ ] **Step 2: 加载数据**

在 `useEffect` 中添加：

```typescript
fetchSources().then(setSources).catch(() => {})
```

- [ ] **Step 3: 添加 sources 视图**

在 `currentView === 'wiki'` 的条件分支之后、`currentView === 'repo'` 位置，替换为 `currentView === 'sources'`：

```tsx
) : currentView === 'sources' ? (
  <div className="max-w-4xl mx-auto space-y-4">
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-bold text-gray-900">📦 知识源管理</h2>
      <button onClick={() => setShowSourceModal(true)}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark">
        + 添加知识源
      </button>
    </div>
    
    {sources.length === 0 ? (
      <div className="text-center text-gray-400 py-8 text-sm">暂无知识源，点击上方按钮添加</div>
    ) : (
      <div className="space-y-2">
        {sources.map(s => (
          <div key={s.name} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-bold text-gray-800">{s.name}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                s.type === 'code' ? 'bg-cyber-blue/10 text-cyber-blue' : 'bg-cyber-green/10 text-cyber-green'
              }`}>{s.type}</span>
              <span className="text-xs text-gray-400 font-mono max-w-[200px] truncate">{s.url || '(zip 导入)'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400">{s.updated_at?.slice(0, 10)}</span>
              {s.url && (
                <button onClick={async () => {
                  setSyncing(s.name)
                  try { await syncSource(s.name); setSources(await fetchSources()) }
                  catch {}
                  setSyncing(null)
                }} disabled={syncing === s.name}
                  className="text-xs px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                  {syncing === s.name ? '同步中...' : '同步'}
                </button>
              )}
              <button onClick={async () => {
                if (!confirm(`确认删除知识源「${s.name}」？`)) return
                await deleteSource(s.name)
                setSources(await fetchSources())
              }}
                className="text-xs px-2 py-1 border border-red-200 text-red-500 rounded-lg hover:bg-red-50">
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
```

### Task 4: 添加知识源弹窗

- [ ] **Step 1: 新建弹窗状态变量**

```typescript
const [newSourceName, setNewSourceName] = useState('')
const [newSourceType, setNewSourceType] = useState<'code' | 'docs'>('code')
const [newSourceUrl, setNewSourceUrl] = useState('')
const [newSourceZip, setNewSourceZip] = useState<File | null>(null)
const [sourceMode, setSourceMode] = useState<'git' | 'zip'>('git')
const [addingSource, setAddingSource] = useState(false)
const [sourceError, setSourceError] = useState<string | null>(null)
```

- [ ] **Step 2: 添加弹窗 JSX**

复现现有上传弹窗的模态框模式：

```tsx
{showSourceModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowSourceModal(false)}>
    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">📦 添加知识源</h2>
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
        <div className="flex gap-3">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" checked={newSourceType === 'code'} onChange={() => setNewSourceType('code')} />
            代码仓库
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" checked={newSourceType === 'docs'} onChange={() => setNewSourceType('docs')} />
            纯文档
          </label>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">来源</label>
        <div className="flex gap-3 mb-2">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" checked={sourceMode === 'git'} onChange={() => setSourceMode('git')} />
            git URL
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" checked={sourceMode === 'zip'} onChange={() => setSourceMode('zip')} />
            上传 zip
          </label>
        </div>
        {sourceMode === 'git' ? (
          <input value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20"
            placeholder="git@github.com:user/project.git" />
        ) : (
          <input type="file" accept=".zip" onChange={e => setNewSourceZip(e.target.files?.[0] || null)}
            className="text-sm" />
        )}
      </div>

      {sourceError && <div className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{sourceError}</div>}

      <div className="flex gap-2 justify-end">
        <button onClick={() => { setShowSourceModal(false); setNewSourceName(''); setNewSourceUrl(''); setNewSourceZip(null); setSourceError(null) }}
          className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
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
        }} disabled={addingSource}
          className="px-4 py-2 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
          {addingSource ? '添加中...' : '提交'}
        </button>
      </div>
    </div>
  </div>
)}
```

### Task 5: 测试 + 验证

- [ ] **Step 1: 检查 API 客户端函数是否存在**

```bash
grep -E "fetchSources|addSource|syncSource|deleteSource" frontend/src/api/client.ts
```

如果不存在，按 Task 1 Step 2 添加。

- [ ] **Step 2: 运行前端测试**

```bash
cd frontend && npx vitest run --reporter=verbose
```

期望：33 passed

- [ ] **Step 3: 运行后端测试确认无回归**

```bash
cd backend && source .venv/bin/activate && python3 -m pytest tests/ -q
```

期望：153 passed

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat: AdminPage 知识源管理 UI

- 左侧栏代码库提交改为知识源管理
- 知识源列表：展示所有注册源，支持同步/删除
- 添加弹窗：支持类型选择(code/docs)和来源选择(git/zip)
- 新增 fetchSources/addSource/addSourceZip/syncSource/deleteSource API 客户端函数

Co-Authored-By: Claude <noreply@anthropic.com>"
```
