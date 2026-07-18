# WikiPage 三栏统一 + publish 重命名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WikiPage 统一三栏布局（左导航 + 中内容 + 右栏），wiki 模式右栏为 TOC 目录，topic 模式右栏为关联 QA/Wiki 链接；同时将 promote 术语重命名为 publish。

**Architecture:** WikiPage.tsx 内部根据 `pageType` 条件渲染不同右侧栏组件。API `/api/wiki/:slug` 扩展返回 topic 模式下的关联数据。无新路由，无新页面。

**Tech Stack:** Python FastAPI, React 18, TypeScript, Tailwind CSS 3, shadcn/ui

## Global Constraints

- URL 路由不变：`/:repo#slug`，topic 继续通过 hash 导航
- 三栏布局：左 `w-64`，中 `flex-1 max-w-3xl`，右 `w-56`
- 色彩：primary `#4F46E5`，bg `#F8F9FA`，card `#FFFFFF`，text `#1E293B`
- shadcn/ui + Tailwind，不写自定义 CSS 文件
- 中文 commit message

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/python-agent/database.py` | 修改 | `promoted` → `published`，`promoted_at` → `published_at` |
| `src/python-agent/store_topics.py` | 修改 | `promote()` → `publish()` |
| `src/python-agent/main.py` | 修改 | 路由重命名 + topic wiki 响应扩展 |
| `src/python-agent/test_store_topics.py` | 修改 | 测试用例更新 |
| `frontend/src/types/index.ts` | 修改 | `promoted` → `published` + WikiPage 响应类型扩展 |
| `frontend/src/api/client.ts` | 修改 | `promoteTopic()` → `publishTopic()` + `fetchWikiPage` 返回类型 |
| `frontend/src/pages/WikiPage.tsx` | 修改 | 三栏布局 + 条件右栏渲染 |
| `frontend/src/components/layout/WikiRightSidebar.tsx` | 创建 | wiki 模式 TOC 右栏 |
| `frontend/src/components/layout/TopicRightSidebar.tsx` | 创建 | topic 模式关联内容右栏 |
| `frontend/src/pages/AdminPage.tsx` | 修改 | 文案 + 函数名更新 |
| `frontend/src/components/layout/LeftSidebar.tsx` | 修改 | 状态标签 "已固化" → "已沉淀" |

---

### Task 1: promote → publish 重命名（Python 后端）

**Files:**
- Modify: `src/python-agent/database.py:132-141`
- Modify: `src/python-agent/store_topics.py:104-112`
- Modify: `src/python-agent/main.py:256,332-366`
- Modify: `src/python-agent/test_store_topics.py:101-110`

**Interfaces:**
- Consumes: (none, standalone rename)
- Produces: `publish(slug, wiki_module) -> bool`, `POST /api/topics/{slug}/publish`, `status='published'`, `published_at`

- [ ] **Step 1: 修改 database.py schema**

Edit `src/python-agent/database.py` lines 137-140:

```python
                        CHECK(status IN ('pool', 'published')),
            wiki_module TEXT DEFAULT NULL,
            created_at  TEXT DEFAULT (datetime('now')),
            published_at TEXT DEFAULT NULL
```

- [ ] **Step 2: 修改 store_topics.py 函数**

Edit `src/python-agent/store_topics.py` lines 104-112:

```python
def publish(topic_slug: str, wiki_module: str) -> bool:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topics SET status = 'published', wiki_module = ?, published_at = ? WHERE slug = ?",
        (wiki_module, now, topic_slug),
    )
    db.commit()
    return True
```

- [ ] **Step 3: 修改 main.py 路由**

Edit `src/python-agent/main.py` line 256, import:

```python
        save_draft, link_qa, update_draft_content, publish as publish_topic,
```

Edit `src/python-agent/main.py` lines 332-366:

```python
    @app.post("/api/topics/{slug}/publish")
    async def api_publish_topic(slug: str, body: dict):
        """沉淀 topic 为 wiki 页面"""
        wiki_module = body.get("wiki_module", "").strip()
        if not wiki_module:
            return _err("Missing wiki_module")

        topic = get_topic(slug)
        if not topic:
            raise HTTPException(404, f"Topic '{slug}' not found")

        # 获取提炼稿内容，优先用编辑过的版本
        draft = get_draft(slug)
        content = None
        if draft:
            content = draft.get("edited_content") or draft.get("raw_content")

        if not content:
            # 从关联 QA 自动生成 markdown
            qa_list = topic.get("qa_entries", [])
            lines = [f"# {topic['name']}\n", f"", f"{topic['description']}\n", f""]
            for qa in qa_list:
                lines.append(f"## #Q{qa['qid']}: {qa['question']}\n")
                if qa.get("answer"):
                    lines.append(f"{qa['answer']}\n")
            content = "\n".join(lines)

        # 写入 wiki 目录
        from store_wiki import write_page
        write_page(slug, "entity", content)

        # 更新 topic 状态
        publish_topic(slug, wiki_module)

        return _ok({"slug": slug, "wiki_module": wiki_module, "published": True})
```

- [ ] **Step 4: 修改测试文件**

Edit `src/python-agent/test_store_topics.py` lines 101-110:

```python
    def test_publish(self):
        """沉淀 topic 为 wiki"""
        self.create_topic("publish-test", "沉淀测试")

        from store_topics import publish, get_topic
        publish("publish-test", "core-module")

        topic = get_topic("publish-test")
        self.assertEqual(topic["status"], "published")
        self.assertEqual(topic["wiki_module"], "core-module")
```

- [ ] **Step 5: 运行测试验证**

```bash
cd src/python-agent && python3 -m pytest test_store_topics.py -v
```

Expected: `test_publish` PASS, all other tests PASS

- [ ] **Step 6: 验证 API 可加载**

```bash
cd src/python-agent && python3 -c "from main import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 7: 删除旧数据库文件让 schema 重建（开发环境）**

```bash
rm -f ~/.opencodewiki/knowledge.db
```

- [ ] **Step 8: Commit**

```bash
git add src/python-agent/database.py src/python-agent/store_topics.py src/python-agent/main.py src/python-agent/test_store_topics.py
git commit -m "重构: promote→publish 术语重命名

数据库 status 值 'promoted' 改为 'published'，函数/路由/字段同步更新

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: promote → publish 重命名（前端）

**Files:**
- Modify: `frontend/src/types/index.ts:25,29`
- Modify: `frontend/src/api/client.ts:91-96`
- Modify: `frontend/src/pages/AdminPage.tsx` (多处)
- Modify: `frontend/src/components/layout/LeftSidebar.tsx:66`

- [ ] **Step 1: 更新 TypeScript 类型**

Edit `frontend/src/types/index.ts` lines 25,29:

```typescript
export interface Topic {
  slug: string
  name: string
  description: string
  status: 'pool' | 'published'
  wiki_module: string | null
  qa_count?: number
  created_at: string
  published_at: string | null
}
```

- [ ] **Step 2: 更新 API client**

Edit `frontend/src/api/client.ts` lines 91-96:

```typescript
export function publishTopic(slug: string, wikiModule: string): Promise<{ slug: string }> {
  return request(`/topics/${encodeURIComponent(slug)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ wiki_module: wikiModule }),
  })
}
```

- [ ] **Step 3: 更新 AdminPage.tsx**

Edit `frontend/src/pages/AdminPage.tsx`:

Line 7, import — `promoteTopic` → `publishTopic`:
```typescript
  fetchTopic, fetchTopicDraft, fetchWikiModules, publishTopic,
```

Line 31, state — `promoteResult` → `publishResult`:
```typescript
  const [publishResult, setPublishResult] = useState<string | null>(null)
```

Line 57, reset — `setPromoteResult` → `setPublishResult`:
```typescript
    setPublishResult(null)
```

Line 83-84, action call + result:
```typescript
      await publishTopic(selectedTopic.slug, selectedModule)
      setPublishResult('✅ 沉淀成功！Topic 已写入 Wiki')
```

Line 89, error:
```typescript
      setPublishResult(`❌ 沉淀失败: ${e.message}`)
```

Line 99, closeDetail reset:
```typescript
    setPublishResult(null)
```

Lines 118-120, status badge (topic detail panel):
```typescript
                    selectedTopic.status === 'published' ? 'bg-cyber-green/10 text-cyber-green' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {selectedTopic.status === 'published' ? '已沉淀' : '聚合中'}
```

Lines 193-195, result display:
```typescript
                {publishResult && (
                  <div className={`text-sm px-3 py-2 rounded-lg ${publishResult.startsWith('✅') ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-50 text-red-600'}`}>
                    {publishResult}
```

Lines 203-205, button:
```typescript
                  <Button size="sm" onClick={handlePromote} disabled={!selectedModule || promoting || selectedTopic.status === 'published'}>
                    {promoting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5 mr-1.5" />}
                    {promoting ? '沉淀中...' : (selectedTopic.status === 'published' ? '已沉淀' : '沉淀为 Wiki')}
```

Lines 269-271, topic list badge:
```typescript
                          t.status === 'published' ? 'bg-cyber-green/10 text-cyber-green' : 'bg-amber-50 text-amber-600'
                        }`}>
                          {t.status === 'published' ? '已沉淀' : '聚合中'}
```

- [ ] **Step 4: 更新 LeftSidebar.tsx 状态标签**

Edit `frontend/src/components/layout/LeftSidebar.tsx` line 66:

```typescript
                    <span className="text-[9px] bg-cyber-blue/10 text-cyber-blue px-1.5 py-0.5 rounded-full font-bold">{t.status === 'published' ? '已沉淀' : '聚合中'}</span>
```

- [ ] **Step 5: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/client.ts frontend/src/pages/AdminPage.tsx frontend/src/components/layout/LeftSidebar.tsx
git commit -m "重构: 前端 promote→publish 术语重命名

函数名/类型/文案同步：promote→publish，晋升→沉淀，已固化→已沉淀

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 扩展 API 返回 topic 关联数据

**Files:**
- Modify: `src/python-agent/main.py:211-223`

**Interfaces:**
- Consumes: `store_topics.get_topic()`, `store_wiki.list_pages()`
- Produces: `GET /api/wiki/{slug}` 返回扩展字段 `topic`, `qa_entries`, `wiki_links`

- [ ] **Step 1: 扩展 topic 响应**

Edit `src/python-agent/main.py` lines 211-223, replace the topic fallback block:

```python
    # Try topic
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

            # 提取 wiki 关联：从 topics.wiki_module + draft 内容提取
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

- [ ] **Step 2: 验证 API 加载**

```bash
cd src/python-agent && python3 -c "from main import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/python-agent/main.py
git commit -m "feat: wiki API 扩展返回 topic 关联数据

topic 模式下返回 qa_entries、wiki_links、topic 元信息

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 前端类型 + API client 扩展

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Consumes: `GET /api/wiki/{slug}` 扩展响应
- Produces: `WikiPageResponse` 类型, 更新 `fetchWikiPage()` 返回类型

- [ ] **Step 1: 新增 WikiPage 响应类型**

Append to `frontend/src/types/index.ts`:

```typescript
export interface WikiPageResponse {
  type: 'wiki' | 'topic'
  slug: string
  content: string
  topic?: {
    name: string
    description: string
    status: string
    wiki_module: string | null
  }
  qa_entries?: {
    qid: number
    question: string
    created_at: string
  }[]
  wiki_links?: {
    slug: string
    name: string
  }[]
}
```

- [ ] **Step 2: 更新 fetchWikiPage 返回类型**

Edit `frontend/src/api/client.ts`, update the `fetchWikiPage` function signature:

```typescript
import type { ApiResponse, Repo, QaEntry, Topic, TopicDraft, WikiPageResponse } from '@/types'
```

Replace the existing `fetchWikiPage` function:

```typescript
export function fetchWikiPage(slug: string): Promise<WikiPageResponse> {
  return request(`/wiki/${encodeURIComponent(slug)}`)
}
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/client.ts
git commit -m "feat: 前端类型 + API client 扩展 WikiPage 响应

新增 WikiPageResponse 类型，含 topic/qa_entries/wiki_links

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: WikiRightSidebar 组件（TOC 目录）

**Files:**
- Create: `frontend/src/components/layout/WikiRightSidebar.tsx`

**Interfaces:**
- Consumes: `renderedHtml: string` (已渲染的 markdown HTML)
- Produces: 右侧栏 TOC 组件，props 无外部依赖

- [ ] **Step 1: 创建 WikiRightSidebar 组件**

Write `frontend/src/components/layout/WikiRightSidebar.tsx`:

```typescript
import { useMemo, useEffect, useState } from 'react'
import { Hash } from 'lucide-react'

interface Heading {
  id: string
  text: string
  level: number
}

interface WikiRightSidebarProps {
  renderedHtml: string
}

export function WikiRightSidebar({ renderedHtml }: WikiRightSidebarProps) {
  const [activeId, setActiveId] = useState<string>('')

  const headings: Heading[] = useMemo(() => {
    if (!renderedHtml) return []
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(renderedHtml, 'text/html')
      return Array.from(doc.querySelectorAll('h1, h2, h3')).map((el, i) => {
        const id = el.id || `heading-${i}`
        if (!el.id) el.id = id
        return {
          id,
          text: el.textContent || '',
          level: parseInt(el.tagName[1]),
        }
      })
    } catch {
      return []
    }
  }, [renderedHtml])

  useEffect(() => {
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )

    const elements = headings
      .map(h => document.getElementById(h.id))
      .filter(Boolean) as HTMLElement[]

    elements.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [headings])

  const handleClick = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
    }
  }

  if (headings.length === 0) {
    return (
      <aside className="w-56 border-l border-gray-200/50 bg-[#FBFBFC] overflow-y-auto no-scrollbar shrink-0 hidden lg:block">
        <div className="p-4 flex items-center justify-center h-full text-xs text-gray-400">
          暂无目录
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-56 border-l border-gray-200/50 bg-[#FBFBFC] overflow-y-auto no-scrollbar shrink-0 hidden lg:block">
      <div className="p-4 sticky top-0">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Hash className="w-3.5 h-3.5" /> 文章目录
        </h3>
        <nav className="space-y-0.5">
          {headings.map(h => (
            <button
              key={h.id}
              onClick={() => handleClick(h.id)}
              className={`w-full text-left text-xs py-1 px-2 rounded transition truncate block ${
                activeId === h.id
                  ? 'text-cyber-blue font-semibold bg-cyber-blue/5 border-l-2 border-cyber-blue rounded-l-none'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
              style={{ paddingLeft: `${8 + (h.level - 1) * 12}px` }}
            >
              {h.text}
            </button>
          ))}
        </nav>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/WikiRightSidebar.tsx
git commit -m "feat: 新增 WikiRightSidebar 组件（TOC 文章目录）

从 markdown HTML 提取 h1-h3 标题，IntersectionObserver 滚动高亮

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: TopicRightSidebar 组件（关联内容）

**Files:**
- Create: `frontend/src/components/layout/TopicRightSidebar.tsx`

**Interfaces:**
- Consumes: `qaEntries`, `wikiLinks` (array props)
- Produces: 右侧栏组件，展示关联 QA 和关联 Wiki 页面

- [ ] **Step 1: 创建 TopicRightSidebar 组件**

Write `frontend/src/components/layout/TopicRightSidebar.tsx`:

```typescript
import { useNavigate } from 'react-router-dom'
import { MessageCircle, FileText, ExternalLink } from 'lucide-react'

interface QaEntryBrief {
  qid: number
  question: string
  created_at: string
}

interface WikiLink {
  slug: string
  name: string
}

interface TopicRightSidebarProps {
  qaEntries: QaEntryBrief[]
  wikiLinks: WikiLink[]
}

export function TopicRightSidebar({ qaEntries, wikiLinks }: TopicRightSidebarProps) {
  const navigate = useNavigate()

  return (
    <aside className="w-56 border-l border-gray-200/50 bg-[#FBFBFC] overflow-y-auto no-scrollbar shrink-0 hidden lg:block">
      <div className="p-4 space-y-6 sticky top-0">
        {/* 关联 QA */}
        <div>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <MessageCircle className="w-3.5 h-3.5 text-amber-500" /> 关联 QA
          </h3>
          {qaEntries.length > 0 ? (
            <nav className="space-y-1">
              {qaEntries.map(qa => (
                <button
                  key={qa.qid}
                  onClick={() => navigate(`/qa?qid=${qa.qid}`)}
                  className="w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 transition group"
                >
                  <span className="font-mono text-[10px] text-cyber-blue font-bold mr-1.5">#Q{qa.qid}</span>
                  <span className="text-gray-600 group-hover:text-gray-800 line-clamp-1">
                    {qa.question.length > 40 ? qa.question.slice(0, 40) + '...' : qa.question}
                  </span>
                </button>
              ))}
            </nav>
          ) : (
            <div className="text-[11px] text-gray-400 py-2">暂无关联 QA</div>
          )}
        </div>

        {/* 关联 Wiki 页面 */}
        <div className="pt-3 border-t border-gray-100">
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-cyber-blue" /> 关联页面
          </h3>
          {wikiLinks.length > 0 ? (
            <nav className="space-y-1">
              {wikiLinks.map(link => (
                <button
                  key={link.slug}
                  onClick={() => window.location.hash = link.slug}
                  className="w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 transition group flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
                  <span className="text-gray-600 group-hover:text-gray-800 line-clamp-1">{link.name}</span>
                </button>
              ))}
            </nav>
          ) : (
            <div className="text-[11px] text-gray-400 py-2">暂无关联页面</div>
          )}
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/TopicRightSidebar.tsx
git commit -m "feat: 新增 TopicRightSidebar 组件（关联 QA + Wiki 页面）

展示 topic 关联的 QA 条目和 wiki 页面链接

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: WikiPage.tsx 三栏布局改造

**Files:**
- Modify: `frontend/src/pages/WikiPage.tsx`

**Interfaces:**
- Consumes: `WikiRightSidebar`, `TopicRightSidebar`, `fetchWikiPage` (extended)
- Produces: 三栏布局 WikiPage

- [ ] **Step 1: 重写 WikiPage.tsx**

Write `frontend/src/pages/WikiPage.tsx`:

```typescript
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { WikiRightSidebar } from '@/components/layout/WikiRightSidebar'
import { TopicRightSidebar } from '@/components/layout/TopicRightSidebar'
import { BottomInput } from '@/components/layout/BottomInput'
import { fetchWikiPage } from '@/api/client'
import type { WikiPageResponse } from '@/types'
import { marked } from 'marked'
import { Hash, BookOpen, FileText, Search } from 'lucide-react'

export function WikiPage() {
  const { repo } = useParams<{ repo: string }>()
  const location = useLocation()
  const [rawContent, setRawContent] = useState<string>('')
  const [pageType, setPageType] = useState<'wiki' | 'topic'>('wiki')
  const [currentSlug, setCurrentSlug] = useState<string>('')
  const [wikiData, setWikiData] = useState<WikiPageResponse | null>(null)
  const articleRef = useRef<HTMLDivElement>(null)

  const currentHash = location.hash.replace('#', '')

  const loadContent = useCallback(async (slug: string) => {
    if (!slug) return
    setCurrentSlug(slug)
    try {
      const data = await fetchWikiPage(slug)
      setWikiData(data)
      setRawContent(data.content)
      setPageType(data.type as 'wiki' | 'topic')
    } catch {
      setWikiData(null)
      setRawContent('')
      setPageType('wiki')
    }
  }, [])

  useEffect(() => {
    if (currentHash) loadContent(currentHash)
    else loadContent('overview')
  }, [currentHash, loadContent])

  // Markdown → HTML
  const renderedHtml = useMemo(() => {
    if (!rawContent) return ''
    return marked.parse(rawContent, { async: false }) as string
  }, [rawContent])

  // Post-process: syntax highlight + mermaid
  useEffect(() => {
    if (!articleRef.current || !renderedHtml) return

    const hljsPromise = import('highlight.js')
    hljsPromise.then(hljs => {
      articleRef.current?.querySelectorAll('pre code').forEach((block) => {
        hljs.default.highlightElement(block as HTMLElement)
      })
    }).catch(() => {})

    const mermaidDiagrams = articleRef.current.querySelectorAll('.language-mermaid')
    if (mermaidDiagrams.length > 0) {
      import('mermaid').then(mermaid => {
        mermaidDiagrams.forEach(block => {
          const pre = block.parentElement
          if (!pre) return
          const div = document.createElement('div')
          div.className = 'mermaid my-4'
          div.textContent = block.textContent
          pre.parentElement?.replaceChild(div, pre)
        })
        mermaid.default.run({ nodes: articleRef.current?.querySelectorAll('.mermaid') })
      }).catch(() => {})
    }
  }, [renderedHtml])

  const handleNavigate = (slug: string) => {
    window.location.hash = slug
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" repoName={repo} activeSection="wiki" />
      <div className="flex-1 flex overflow-hidden relative">
        <LeftSidebar pageType="wiki" currentSlug={currentSlug} currentTopic={pageType === 'topic' ? currentSlug : undefined} onNavigate={handleNavigate} />
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar relative bg-[#FBFBFC]">
          <div className="flex-1 flex justify-center py-8 px-6">
            <div className="w-full max-w-3xl transition-all">
              {!currentHash && !currentSlug && (
                <div className="text-center py-16 space-y-6">
                  <div className="w-16 h-16 bg-gradient-to-br from-cyber-blue/10 to-cyber-blue/5 rounded-2xl flex items-center justify-center mx-auto">
                    <BookOpen className="w-8 h-8 text-cyber-blue" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">{repo} 知识库</h2>
                    <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">
                      从左侧选择文档开始阅读，或点击 #topic 查看关联问答聚合
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> 物理文档</span>
                    <span className="text-gray-300">·</span>
                    <span className="flex items-center gap-1"><Hash className="w-3.5 h-3.5" /> Topic 聚合</span>
                    <span className="text-gray-300">·</span>
                    <span className="flex items-center gap-1"><Search className="w-3.5 h-3.5" /> 全文检索</span>
                  </div>
                </div>
              )}
              {renderedHtml ? (
                <div className="bg-white border border-gray-200/50 rounded-xl p-8 md:p-10 pb-32 shadow-sm">
                  {pageType === 'topic' && (
                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                      <span className="text-[10px] font-mono bg-cyber-blue/10 text-cyber-blue px-2 py-0.5 rounded font-bold flex items-center gap-1">
                        <Hash className="w-3 h-3" /> TOPIC VIEW
                      </span>
                      <span className="text-[10px] text-gray-400">主题聚合视图 — 内容由关联 QA 自动生成</span>
                    </div>
                  )}
                  <article
                    ref={articleRef}
                    className="prose prose-slate max-w-none text-sm leading-relaxed font-sans [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:pb-2 [&_h1]:border-b [&_h1]:border-gray-100 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:my-3 [&_p]:text-gray-700 [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono [&_pre]:bg-[#1e293b] [&_pre]:text-[#e2e8f0] [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_blockquote]:border-l-4 [&_blockquote]:border-cyber-blue [&_blockquote]:pl-4 [&_blockquote]:py-2 [&_blockquote]:my-4 [&_blockquote]:bg-gray-50 [&_blockquote]:rounded-r-lg [&_blockquote]:text-gray-600 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-gray-200 [&_td]:px-3 [&_td]:py-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3 [&_li]:my-1 [&_a]:text-cyber-blue [&_a]:no-underline [&_a:hover]:underline [&_hr]:my-8 [&_hr]:border-gray-100 [&_img]:max-w-full [&_img]:rounded-lg"
                    dangerouslySetInnerHTML={{ __html: renderedHtml }}
                  />
                </div>
              ) : (
                <div className="text-center text-gray-400 py-20">选择左侧文档开始阅读</div>
              )}
            </div>
          </div>
          <BottomInput visible placeholder={`对当前文档提问...`} contextTag={currentSlug} />
        </main>

        {/* Right sidebar — conditional by pageType */}
        {pageType === 'topic'
          ? <TopicRightSidebar
              qaEntries={wikiData?.qa_entries || []}
              wikiLinks={wikiData?.wiki_links || []}
            />
          : <WikiRightSidebar renderedHtml={renderedHtml} />
        }
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/WikiPage.tsx
git commit -m "feat: WikiPage 统一三栏布局 + 右栏内容切换

wiki 模式右栏为 TOC 目录，topic 模式右栏为关联 QA/Wiki 页面

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ promote → publish 重命名：Task 1 (Python) + Task 2 (Frontend)
- ✅ API `/api/wiki/:slug` 扩展返回 topic/qa_entries/wiki_links：Task 3
- ✅ 前端类型 + API client 扩展：Task 4
- ✅ WikiRightSidebar (TOC + IntersectionObserver)：Task 5
- ✅ TopicRightSidebar (关联 QA + Wiki 链接)：Task 6
- ✅ WikiPage 三栏布局 + 条件右侧栏：Task 7
- ✅ LeftSidebar 状态标签更新：Task 2 Step 4
- ✅ AdminPage 文案更新：Task 2 Step 3

**2. Placeholder scan:** 无 TBD/TODO，所有步骤包含具体代码。

**3. Type consistency:**
- `WikiPageResponse` 定义在 Task 4，Task 7 使用 → 一致
- `WikiRightSidebar` props `{ renderedHtml: string }` → Task 5 定义，Task 7 传入
- `TopicRightSidebar` props `{ qaEntries, wikiLinks }` → Task 6 定义，Task 7 传入
- `publish()` 定义在 Task 1，Task 3 中 `publish_topic` import → 一致
