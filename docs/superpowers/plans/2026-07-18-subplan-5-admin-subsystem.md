# 子计划 5：Admin 子系统（审核台）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AdminPage 改为审核台，左侧栏队列导航（QA 校准 / Topic 建议），主内容 Tab 切换。Topic 详情面板复用两栏对比 + 模块选择 + 沉淀为 Wiki。

**Architecture:** 不新增组件，AdminPage 自带内联侧栏。两个队列视图：QA 校准列表 + Topic 聚合列表。点击 Topic 打开详情面板（现有布局改为已发布的新 publish 逻辑）。

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, shadcn/ui

**Depends on:** 子计划 2（Header + 首页），子计划 1（publish 重命名）

## Global Constraints

- 左侧栏 `w-56`，两个队列有 badge 计数
- QA 校准：管理员点击"校准"生效，普通成员按钮置灰
- Topic 详情：两栏对比（液态原始QA | 固态提炼编辑稿）+ 模块选择 + 沉淀按钮
- 沉淀按钮文案：沉淀为 Wiki

---

### Task 1: AdminPage 审核台

**Files:**
- Rewrite: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: 重写 AdminPage.tsx**

```typescript
import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { fetchQaEntries, calibrateQaEntry, fetchTopics, fetchTopic, fetchTopicDraft, fetchWikiModules, publishTopic, updateTopicDraft } from '@/api/client'
import type { QaEntry, Topic, TopicDraft } from '@/types'
import { Loader2, CheckCircle, Eye, ArrowUpCircle, BookOpen, Shield } from 'lucide-react'

export function AdminPage() {
  const [pendingQa, setPendingQa] = useState<QaEntry[]>([])
  const [poolTopics, setPoolTopics] = useState<Topic[]>([])
  const [pendingCounts, setPendingCounts] = useState({ qa: 0, topic: 0 })

  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null)
  const [selectedDraft, setSelectedDraft] = useState<TopicDraft | null>(null)
  const [modules, setModules] = useState<{ slug: string; name: string; type: string }[]>([])
  const [selectedModule, setSelectedModule] = useState('')

  const [currentView, setCurrentView] = useState<'qa' | 'topic'>('qa')
  const [editableContent, setEditableContent] = useState('')
  const [calAnswers, setCalAnswers] = useState<Record<number, string>>({})
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<string | null>(null)

  useEffect(() => {
    fetchQaEntries({ status: 'pending', limit: 50 }).then(d => { setPendingQa(d.entries); setPendingCounts(prev => ({ ...prev, qa: d.total })) }).catch(() => {})
    fetchTopics({ status: 'pool' }).then(d => { setPoolTopics(d); setPendingCounts(prev => ({ ...prev, topic: d.length })) }).catch(() => {})
    fetchWikiModules().then(setModules).catch(() => {})
  }, [])

  const handleCalibrate = async (qid: number) => {
    const answer = calAnswers[qid]?.trim()
    if (!answer) return
    await calibrateQaEntry(qid, answer)
    setPendingQa(prev => prev.filter(e => e.qid !== qid))
  }

  const handleViewTopic = async (slug: string) => {
    setPublishResult(null)
    try {
      const topic = await fetchTopic(slug) as any
      setSelectedTopic(topic)
      const draft = await fetchTopicDraft(slug)
      setSelectedDraft(draft)
      setEditableContent(draft?.edited_content || draft?.raw_content || '')
      if (modules.length > 0 && !selectedModule) setSelectedModule(modules[0].slug)
    } catch {}
  }

  const handlePublish = async () => {
    if (!selectedTopic || !selectedModule) return
    setPublishing(true)
    try {
      if (editableContent) await updateTopicDraft(selectedTopic.slug, editableContent)
      await publishTopic(selectedTopic.slug, selectedModule)
      setPublishResult('✅ 沉淀成功！Topic 已写入 Wiki')
      const updated = await fetchTopics()
      setPoolTopics(updated.filter(t => t.status === 'pool'))
    } catch (e: any) {
      setPublishResult(`❌ 沉淀失败: ${e.message}`)
    }
    setPublishing(false)
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" activeSection="admin" />
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧栏 */}
        <aside className="w-56 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col shrink-0">
          <div className="p-4 space-y-4 text-xs font-medium">
            <div>
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 px-2">
                <Shield className="w-3.5 h-3.5 text-amber-500" /> 审核队列
              </h3>
              <ul className="space-y-1">
                <li>
                  <button onClick={() => setCurrentView('qa')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition ${
                      currentView === 'qa' ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : 'text-gray-600 hover:bg-gray-100'
                    }`}>
                    <span>⏳ QA 校准</span>
                    {pendingCounts.qa > 0 && <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingCounts.qa}</span>}
                  </button>
                </li>
                <li>
                  <button onClick={() => setCurrentView('topic')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition ${
                      currentView === 'topic' ? 'bg-gray-200/60 text-gray-900 font-bold border-l-2 border-cyber-blue rounded-l-none' : 'text-gray-600 hover:bg-gray-100'
                    }`}>
                    <span>📝 Topic 建议</span>
                    {pendingCounts.topic > 0 && <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingCounts.topic}</span>}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </aside>

        {/* 主内容 */}
        <main className="flex-1 overflow-y-auto bg-[#FBFBFC] p-8">
          {selectedTopic ? (
            <div className="max-w-6xl mx-auto space-y-6">
              <button onClick={() => { setSelectedTopic(null); setSelectedDraft(null) }}
                className="text-xs text-gray-500 hover:text-cyber-blue">← 返回审核列表</button>
              <h2 className="text-lg font-bold text-gray-900">#{selectedTopic.slug} · {selectedTopic.name}</h2>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">💧 液态原始 — 关联问答</h3>
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {(selectedTopic as any).qa_entries?.map((qa: any) => (
                      <div key={qa.qid} className="bg-white border border-gray-200 rounded-lg p-3 text-xs">
                        <span className="font-mono text-cyber-blue font-bold text-[10px]">#Q{qa.qid}</span>
                        <span className="ml-1.5 font-medium text-gray-800">{qa.question}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="text-[10px] font-bold text-cyber-blue uppercase tracking-wider">🧊 固态提炼</h3>
                  <textarea value={editableContent} onChange={e => setEditableContent(e.target.value)}
                    rows={15} className="w-full text-sm border border-gray-200 rounded-lg p-3 font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical"
                    placeholder="编辑提炼稿..." />
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-gray-400" />
                  <span className="text-xs text-gray-600">目标模块:</span>
                  <select value={selectedModule} onChange={e => setSelectedModule(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
                    {modules.map(m => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                  </select>
                </div>
                {publishResult && (
                  <div className={`text-sm px-3 py-2 rounded-lg ${publishResult.startsWith('✅') ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-50 text-red-600'}`}>
                    {publishResult}
                  </div>
                )}
                <button onClick={handlePublish} disabled={!selectedModule || publishing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-cyber-blue text-white text-sm rounded-lg hover:bg-cyber-blue-dark transition disabled:opacity-50">
                  {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                  沉淀为 Wiki
                </button>
              </div>
            </div>
          ) : currentView === 'qa' ? (
            <div className="max-w-4xl mx-auto space-y-4">
              <h2 className="text-lg font-bold text-gray-900">⏳ QA 校准</h2>
              {pendingQa.map(e => (
                <div key={e.qid} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-cyber-blue font-bold">#Q{e.qid}</span>
                    <span className="text-sm font-medium">{e.question}</span>
                  </div>
                  <textarea value={calAnswers[e.qid] ?? ''} onChange={evt => setCalAnswers(prev => ({ ...prev, [e.qid]: evt.target.value }))}
                    placeholder="输入校准答案..." rows={3}
                    className="w-full text-sm border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 resize-vertical" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => window.open(`/qa?qid=${e.qid}`, '_blank')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                      <Eye className="w-3 h-3" /> 查看
                    </button>
                    <button onClick={() => handleCalibrate(e.qid)} disabled={!calAnswers[e.qid]?.trim()}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
                      <CheckCircle className="w-3 h-3" /> 校准
                    </button>
                  </div>
                </div>
              ))}
              {pendingQa.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">✅ 暂无待审核条目</div>}
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              <h2 className="text-lg font-bold text-gray-900">📝 Topic 聚合</h2>
              {poolTopics.map(t => (
                <button key={t.slug} onClick={() => handleViewTopic(t.slug)}
                  className="w-full bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-cyber-blue/30 transition flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-gray-800">#{t.slug}</span>
                    <span className="text-xs text-gray-500">{t.name}</span>
                    {t.qa_count != null && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{t.qa_count} QA</span>}
                  </div>
                  <span className="text-[10px] text-cyber-blue font-bold">查看详情 →</span>
                </button>
              ))}
              {poolTopics.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">暂无聚合中的 Topic</div>}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat: AdminPage 审核台 — QA校准 + Topic建议 分离队列

左侧栏审核队列导航，主内容Tab切换，Topic详情面板复用

Co-Authored-By: Claude <noreply@anthropic.com>"
```
