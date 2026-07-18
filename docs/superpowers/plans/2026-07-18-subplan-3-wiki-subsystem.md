# 子计划 3：Wiki 子系统（全局 + 仓库 + API）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增 `/wiki` 全局页 + WikiPage 三栏布局 + 两个右栏组件 + API 扩展 topic 关联数据。

**Architecture:** 新增 WikiGlobalPage 页面展示全量代码库 + Topic + 最近变动。WikiPage `/:repo` 改为三栏，右栏由 pageType 决定（wiki→TOC, topic→关联QA/Wiki）。后端 `/api/wiki/:slug` 扩展返回 topic 关联字段。

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, shadcn/ui, Python FastAPI, sqlite3

**Depends on:** 子计划 2（Header + 首页）

## Global Constraints

- 路由：`/wiki` → WikiGlobalPage, `/:repo` → WikiPage（注意 `/wiki` 必须在 `/:repo` 前注册）
- 三栏：左 `w-64`，中 `flex-1 max-w-3xl`，右 `w-56`
- 右侧栏宽度 `w-56`，隐藏于 `lg` 以下
- TOC 从 DOM 提取 h1~h3，IntersectionObserver 滚动高亮

---

### Task 1: WikiGlobalPage 全局页（新增）

**Files:**
- Create: `frontend/src/pages/WikiGlobalPage.tsx`
- Modify: `frontend/src/App.tsx` (add `/wiki` route before `/:repo`)

- [ ] **Step 1: 创建 WikiGlobalPage.tsx**

```typescript
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { fetchRepos, fetchTopics } from '@/api/client'
import type { Repo, Topic } from '@/types'
import { GitFork, Hash, Clock, Plus, ArrowRight } from 'lucide-react'

export function WikiGlobalPage() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<Repo[]>([])
  const [topics, setTopics] = useState<Topic[]>([])

  useEffect(() => {
    fetchRepos().then(setRepos).catch(() => {})
    fetchTopics().then(setTopics).catch(() => {})
  }, [])

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" activeSection="wiki" />
      <main className="flex-1 overflow-y-auto no-scrollbar">
        <div className="max-w-5xl mx-auto py-10 px-6 space-y-10">

          {/* 代码库 */}
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <GitFork className="w-4 h-4 text-gray-400" /> 代码库
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {repos.map(r => (
                <button key={r.name} onClick={() => navigate(`/${r.name}`)}
                  className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-cyber-blue/30 hover:shadow-sm transition group">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-gray-800 group-hover:text-cyber-blue transition">{r.name}</span>
                    <span className="text-[10px] text-cyber-green bg-cyber-green/10 px-2 py-0.5 rounded-full font-bold shrink-0">已接入</span>
                  </div>
                  <span className="text-[10px] text-gray-400 font-mono block mt-1 truncate">{r.path}</span>
                </button>
              ))}
              <button onClick={() => navigate('/admin')}
                className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-4 flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-cyber-blue hover:border-cyber-blue/30 transition">
                <Plus className="w-3.5 h-3.5" /> 提交代码库
              </button>
            </div>
          </section>

          {/* Topic 全景 */}
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Hash className="w-4 h-4 text-cyber-blue" /> Topic 聚合
            </h2>
            {topics.length > 0 ? (
              <div className="grid gap-2">
                {topics.map(t => (
                  <button key={t.slug} onClick={() => navigate(`/${repos[0]?.name ?? 'self'}#${t.slug}`)}
                    className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-cyber-blue/30 transition flex items-center justify-between group">
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-sm font-bold text-gray-800">#{t.slug}</span>
                      <span className="text-sm text-gray-600">{t.name}</span>
                      {t.qa_count != null && (
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{t.qa_count} 条 QA</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        t.status === 'published' ? 'bg-cyber-green/10 text-cyber-green' : 'bg-amber-50 text-amber-600'
                      }`}>
                        {t.status === 'published' ? '已沉淀' : '聚合中'}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-cyber-blue transition" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-400 py-12 text-sm">暂无 Topic，从问答积累开始</div>
            )}
          </section>

          {/* 最近变动 */}
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" /> 最近变动
            </h2>
            <div className="text-center text-gray-400 py-8 text-sm">暂无最近变动记录</div>
          </section>

        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: App.tsx 新增路由**

```typescript
import { Routes, Route } from 'react-router-dom'
import { HomePage } from '@/pages/HomePage'
import { WikiGlobalPage } from '@/pages/WikiGlobalPage'
import { WikiPage } from '@/pages/WikiPage'
import { QAPage } from '@/pages/QAPage'
import { AdminPage } from '@/pages/AdminPage'

export default function App() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/wiki" element={<WikiGlobalPage />} />
        <Route path="/:repo" element={<WikiPage />} />
        <Route path="/qa" element={<QAPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </div>
  )
}
```

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/WikiGlobalPage.tsx frontend/src/App.tsx
git commit -m "feat: 新增 WikiGlobalPage /wiki + App.tsx 路由

代码库目录 + Topic 全景 + 最近变动，/wiki 在 /:repo 前注册

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: WikiRightSidebar + TopicRightSidebar 组件

**Files:**
- Create: `frontend/src/components/layout/WikiRightSidebar.tsx`
- Create: `frontend/src/components/layout/TopicRightSidebar.tsx`

- [ ] **Step 1: WikiRightSidebar.tsx**

```typescript
import { useMemo, useEffect, useState } from 'react'
import { Hash } from 'lucide-react'

interface Heading { id: string; text: string; level: number }

interface WikiRightSidebarProps { renderedHtml: string }

export function WikiRightSidebar({ renderedHtml }: WikiRightSidebarProps) {
  const [activeId, setActiveId] = useState('')

  const headings: Heading[] = useMemo(() => {
    if (!renderedHtml) return []
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(renderedHtml, 'text/html')
      return Array.from(doc.querySelectorAll('h1, h2, h3')).map((el, i) => {
        const id = el.id || `heading-${i}`
        if (!el.id) el.id = id
        return { id, text: el.textContent || '', level: parseInt(el.tagName[1]) }
      })
    } catch { return [] }
  }, [renderedHtml])

  useEffect(() => {
    if (headings.length === 0) return
    const observer = new IntersectionObserver(
      entries => { for (const e of entries) if (e.isIntersecting) setActiveId(e.target.id) },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )
    headings.map(h => document.getElementById(h.id)).filter(Boolean).forEach(el => observer.observe(el!))
    return () => observer.disconnect()
  }, [headings])

  return (
    <aside className="w-56 border-l border-gray-200/50 bg-[#FBFBFC] overflow-y-auto no-scrollbar shrink-0 hidden lg:block">
      <div className="p-4 sticky top-0">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Hash className="w-3.5 h-3.5" /> 文章目录
        </h3>
        {headings.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">暂无目录</div>
        ) : (
          <nav className="space-y-0.5">
            {headings.map(h => (
              <button key={h.id}
                onClick={() => document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={`w-full text-left text-xs py-1 px-2 rounded truncate block transition ${
                  activeId === h.id ? 'text-cyber-blue font-semibold bg-cyber-blue/5 border-l-2 border-cyber-blue rounded-l-none' : 'text-gray-500 hover:text-gray-800'
                }`}
                style={{ paddingLeft: `${8 + (h.level - 1) * 12}px` }}>
                {h.text}
              </button>
            ))}
          </nav>
        )}
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: TopicRightSidebar.tsx**

```typescript
import { useNavigate } from 'react-router-dom'
import { MessageCircle, FileText } from 'lucide-react'

interface QaBrief { qid: number; question: string; created_at: string }
interface WikiLink { slug: string; name: string }

interface TopicRightSidebarProps { qaEntries: QaBrief[]; wikiLinks: WikiLink[] }

export function TopicRightSidebar({ qaEntries, wikiLinks }: TopicRightSidebarProps) {
  const navigate = useNavigate()
  return (
    <aside className="w-56 border-l border-gray-200/50 bg-[#FBFBFC] overflow-y-auto no-scrollbar shrink-0 hidden lg:block">
      <div className="p-4 space-y-6 sticky top-0">
        <div>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <MessageCircle className="w-3.5 h-3.5 text-amber-500" /> 关联 QA
          </h3>
          {qaEntries.length > 0 ? (
            <nav className="space-y-1">
              {qaEntries.map(qa => (
                <button key={qa.qid} onClick={() => navigate(`/qa?qid=${qa.qid}`)}
                  className="w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 transition">
                  <span className="font-mono text-[10px] text-cyber-blue font-bold mr-1.5">#Q{qa.qid}</span>
                  <span className="text-gray-600">{qa.question.length > 40 ? qa.question.slice(0, 40) + '...' : qa.question}</span>
                </button>
              ))}
            </nav>
          ) : <div className="text-[11px] text-gray-400 py-2">暂无关联 QA</div>}
        </div>
        <div className="pt-3 border-t border-gray-100">
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-cyber-blue" /> 关联页面
          </h3>
          {wikiLinks.length > 0 ? (
            <nav className="space-y-1">
              {wikiLinks.map(link => (
                <button key={link.slug} onClick={() => window.location.hash = link.slug}
                  className="w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 transition text-gray-600">
                  {link.name}
                </button>
              ))}
            </nav>
          ) : <div className="text-[11px] text-gray-400 py-2">暂无关联页面</div>}
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/WikiRightSidebar.tsx frontend/src/components/layout/TopicRightSidebar.tsx
git commit -m "feat: WikiRightSidebar (TOC) + TopicRightSidebar (关联QA/Wiki)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: API 扩展 — wiki 路由返回 topic 关联数据

**Files:**
- Modify: `src/python-agent/main.py` (topic fallback block)
- Modify: `frontend/src/types/index.ts` (add WikiPageResponse)
- Modify: `frontend/src/api/client.ts` (update fetchWikiPage)

- [ ] **Step 1: main.py topic fallback 扩展**

在 `api_wiki_page()` 中替换 topic fallback：

```python
    try:
        from store_topics import get_topic as get_topic_data
        topic = get_topic_data(slug)
        if topic:
            qa_list = topic.get("qa_entries", [])
            lines = [f"# {topic['name']}\n", f"", f"{topic['description']}\n", f""]
            for qa in qa_list:
                lines.append(f"## #Q{qa['qid']}: {qa['question']}\n")
                if qa.get("answer"):
                    lines.append(f"{qa['answer']}\n")
            content = "\n".join(lines)

            wiki_links = []
            wiki_module = topic.get("wiki_module")
            if wiki_module:
                wiki_links.append({"slug": wiki_module, "name": wiki_module})

            return _ok({
                "type": "topic",
                "slug": slug,
                "content": content,
                "topic": {
                    "name": topic["name"],
                    "description": topic.get("description", ""),
                    "status": topic.get("status", "pool"),
                    "wiki_module": topic.get("wiki_module"),
                },
                "qa_entries": [
                    {"qid": q["qid"], "question": q["question"], "created_at": q.get("created_at", "")}
                    for q in qa_list[:20]
                ],
                "wiki_links": wiki_links,
            })
    except ImportError:
        pass
```

- [ ] **Step 2: 前端类型**

Append to `frontend/src/types/index.ts`:

```typescript
export interface WikiPageResponse {
  type: 'wiki' | 'topic'
  slug: string
  content: string
  topic?: { name: string; description: string; status: string; wiki_module: string | null }
  qa_entries?: { qid: number; question: string; created_at: string }[]
  wiki_links?: { slug: string; name: string }[]
}
```

- [ ] **Step 3: API client**

Update `frontend/src/api/client.ts`:

```typescript
import type { ApiResponse, Repo, QaEntry, Topic, TopicDraft, WikiPageResponse } from '@/types'

export function fetchWikiPage(slug: string): Promise<WikiPageResponse> {
  return request(`/wiki/${encodeURIComponent(slug)}`)
}
```

- [ ] **Step 4: 验证**

```bash
cd src/python-agent && python3 -c "from main import app; print('OK')"
cd frontend && npx tsc --noEmit
```
Expected: both pass

- [ ] **Step 5: Commit**

```bash
git add src/python-agent/main.py frontend/src/types/index.ts frontend/src/api/client.ts
git commit -m "feat: wiki API 扩展 topic 关联数据 + 前端类型

GET /api/wiki/:slug topic模式返回 qa_entries/wiki_links

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: WikiPage 三栏布局

**Files:**
- Rewrite: `frontend/src/pages/WikiPage.tsx`

- [ ] **Step 1: 重写 WikiPage.tsx**

(见总计划 Task 7 完整代码，此处省略以节省篇幅。内容一致，请从总计划 `docs/superpowers/plans/2026-07-18-UI-global-upgrade.md` Task 7 中读取。)

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/WikiPage.tsx
git commit -m "feat: WikiPage 三栏统一布局

wiki→TOC, topic→关联QA/Wiki, 右侧栏条件渲染

Co-Authored-By: Claude <noreply@anthropic.com>"
```
