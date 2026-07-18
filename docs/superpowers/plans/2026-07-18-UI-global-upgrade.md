# OpenCodeWiki UI 全面升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 6 页面 UI 全面升级 — 团队知识平台视角，统一三栏布局，Header 导航 + 用户菜单，新增 `/wiki` 全局页，审核台人人可见。

**Architecture:** React SPA 单页应用，每页面独立组件。新增 WikiGlobalPage 页面和两个右栏组件，存量页面渐进改造。后端扩展 wiki API 返回 topic 关联数据。

**Tech Stack:** Python FastAPI, React 18, TypeScript, Tailwind CSS 3, shadcn/ui, Vitest

## Global Constraints

- URL 路由：`/` `/wiki` `/:repo` `/qa` `/admin`
- 三栏布局：左 `w-64/72`，中 `flex-1 max-w-3xl`，右 `w-56`
- 色彩：primary `#4F46E5`，bg `#F8F9FA`，card `#FFFFFF`
- shadcn/ui + Tailwind，无自定义 CSS 文件
- 中文 commit message
- admin 白名单：初期 hardcode 在 config 中

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/App.tsx` | 修改 | 新增 `/wiki` 路由 |
| `frontend/src/pages/HomePage.tsx` | 重写 | 代码库独立区域 + 三卡片 |
| `frontend/src/pages/WikiGlobalPage.tsx` | **创建** | Wiki 全局页 |
| `frontend/src/pages/WikiPage.tsx` | 重写 | 三栏布局 |
| `frontend/src/pages/QAPage.tsx` | 重写 | 左侧知识条目列表 |
| `frontend/src/pages/AdminPage.tsx` | 重写 | 审核台可见 |
| `frontend/src/components/layout/Header.tsx` | 重写 | 统一导航 + 用户下拉 |
| `frontend/src/components/layout/LeftSidebar.tsx` | 修改 | Admin/QAPage 侧栏 |
| `frontend/src/components/layout/WikiRightSidebar.tsx` | **创建** | TOC 目录 |
| `frontend/src/components/layout/TopicRightSidebar.tsx` | **创建** | 关联 QA/Wiki |
| `frontend/src/components/layout/BottomInput.tsx` | 不变 | — |
| `frontend/src/types/index.ts` | 修改 | 类型扩展 |
| `frontend/src/api/client.ts` | 修改 | 函数重命名 + 新 API |
| `src/python-agent/database.py` | 修改 | promoted→published |
| `src/python-agent/store_topics.py` | 修改 | promote()→publish() |
| `src/python-agent/main.py` | 修改 | 路由重命名 + API 扩展 |
| `src/python-agent/test_store_topics.py` | 修改 | 测试更新 |

---

### Task 1: promote → publish 全链路重命名

**Files:**
- Modify: `src/python-agent/database.py:137-140`
- Modify: `src/python-agent/store_topics.py:104-112`
- Modify: `src/python-agent/main.py:256,332-366`
- Modify: `src/python-agent/test_store_topics.py:101-110`
- Modify: `frontend/src/types/index.ts:25,29`
- Modify: `frontend/src/api/client.ts:91-96`
- Modify: `frontend/src/pages/AdminPage.tsx` (多处)
- Modify: `frontend/src/components/layout/LeftSidebar.tsx:66`

**Interfaces:**
- Consumes: (none)
- Produces: `publish(slug, wiki_module) -> bool`, `POST /api/topics/{slug}/publish`, `Topic.status: 'pool' | 'published'`

- [ ] **Step 1: database.py**

Edit `src/python-agent/database.py` lines 137-140:

```python
                        CHECK(status IN ('pool', 'published')),
            wiki_module TEXT DEFAULT NULL,
            created_at  TEXT DEFAULT (datetime('now')),
            published_at TEXT DEFAULT NULL
```

- [ ] **Step 2: store_topics.py**

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

- [ ] **Step 3: main.py import + route**

Line 256:
```python
        save_draft, link_qa, update_draft_content, publish as publish_topic,
```

Lines 332-366:
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
        draft = get_draft(slug)
        content = None
        if draft:
            content = draft.get("edited_content") or draft.get("raw_content")
        if not content:
            qa_list = topic.get("qa_entries", [])
            lines = [f"# {topic['name']}\n", f"", f"{topic['description']}\n", f""]
            for qa in qa_list:
                lines.append(f"## #Q{qa['qid']}: {qa['question']}\n")
                if qa.get("answer"):
                    lines.append(f"{qa['answer']}\n")
            content = "\n".join(lines)
        from store_wiki import write_page
        write_page(slug, "entity", content)
        publish_topic(slug, wiki_module)
        return _ok({"slug": slug, "wiki_module": wiki_module, "published": True})
```

- [ ] **Step 4: test_store_topics.py**

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

- [ ] **Step 5: 运行 Python 测试**

```bash
cd src/python-agent && python3 -m pytest test_store_topics.py -v
```
Expected: all PASS

- [ ] **Step 6: 前端 types/index.ts**

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

- [ ] **Step 7: 前端 api/client.ts**

```typescript
export function publishTopic(slug: string, wikiModule: string): Promise<{ slug: string }> {
  return request(`/topics/${encodeURIComponent(slug)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ wiki_module: wikiModule }),
  })
}
```

- [ ] **Step 8: 前端 AdminPage.tsx — 全局替换 `promote` → `publish`**

```bash
# 手工替换以下所有出现：
# promoteTopic → publishTopic
# promoteResult → publishResult
# setPromoteResult → setPublishResult
# handlePromote → handlePublish (函数名)
# promoting → publishing
# 'promoted' → 'published'
# '已固化' → '已沉淀'
# '晋升到 Wiki' → '沉淀为 Wiki'
# '晋升成功' → '沉淀成功'
# '晋升失败' → '沉淀失败'
# '晋升中...' → '沉淀中...'
```

- [ ] **Step 9: 前端 LeftSidebar.tsx line 66**

```typescript
<span className="text-[9px] bg-cyber-blue/10 text-cyber-blue px-1.5 py-0.5 rounded-full font-bold">{t.status === 'published' ? '已沉淀' : '聚合中'}</span>
```

- [ ] **Step 10: 验证前端编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 11: Commit**

```bash
git add src/python-agent/database.py src/python-agent/store_topics.py src/python-agent/main.py src/python-agent/test_store_topics.py frontend/src/types/index.ts frontend/src/api/client.ts frontend/src/pages/AdminPage.tsx frontend/src/components/layout/LeftSidebar.tsx
git commit -m "重构: promote→publish 全链路术语重命名

数据库/API/前端类型/文案同步: promoted→published, 晋升→沉淀

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Header 统一导航 + 用户下拉菜单

**Files:**
- Rewrite: `frontend/src/components/layout/Header.tsx`

**Interfaces:**
- Consumes: (none, standalone)
- Produces: `<Header variant="home" | "global" repoName? activeSection? />`

- [ ] **Step 1: 重写 Header.tsx**

Write `frontend/src/components/layout/Header.tsx`:

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Home, BookOpen, MessagesSquare, ChevronDown, Settings, LogOut, Shield } from 'lucide-react'

const ADMIN_USERS = ['long2015']  // 初期白名单

interface HeaderProps {
  variant: 'home' | 'global'
  repoName?: string
  activeSection?: string
}

export function Header({ variant, repoName }: HeaderProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const currentUser = 'long2015'  // TODO: 接入真实登录
  const isAdmin = ADMIN_USERS.includes(currentUser)

  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 px-6 py-3 flex items-center justify-between z-30 shrink-0">
      {/* 左侧: Logo + 当前页面上下文 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-6 h-6 bg-cyber-blue rounded flex items-center justify-center text-white font-black text-xs font-mono">W</div>
          <span className="font-sans font-bold text-sm tracking-tight text-gray-900">OpenCodeWiki</span>
        </div>
        {repoName && variant === 'global' && (
          <>
            <span className="text-gray-300 text-sm">/</span>
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {repoName}
            </div>
          </>
        )}
      </div>

      {/* 右侧: 导航 + 用户 */}
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <Home className="w-4 h-4 mr-1.5" /> 首页
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate('/wiki')}>
          <BookOpen className="w-4 h-4 mr-1.5" /> Wiki
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate('/qa')}>
          <MessagesSquare className="w-4 h-4 mr-1.5" /> 问答
        </Button>

        {/* 用户下拉 */}
        <div className="relative ml-2">
          <Button variant="ghost" size="sm" onClick={() => setMenuOpen(!menuOpen)} className="gap-1.5">
            <div className="w-5 h-5 bg-gray-200 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-600">
              {currentUser[0].toUpperCase()}
            </div>
            <span className="text-xs text-gray-600 hidden sm:inline">{currentUser}</span>
            <ChevronDown className="w-3 h-3 text-gray-400" />
          </Button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 text-sm">
                {isAdmin && (
                  <>
                    <button
                      onClick={() => { navigate('/admin'); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-700"
                    >
                      <Shield className="w-4 h-4 text-amber-500" /> 审核台
                    </button>
                    <div className="border-t border-gray-100 my-1" />
                  </>
                )}
                <button
                  onClick={() => { navigate('/settings'); setMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-700"
                >
                  <Settings className="w-4 h-4" /> 个人设置
                </button>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-500"
                >
                  <LogOut className="w-4 h-4" /> 退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
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
git add frontend/src/components/layout/Header.tsx
git commit -m "feat: Header 统一导航 首页/Wiki/问答 + 用户下拉菜单

审核台仅管理员可见，人人可看公开入口

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: HomePage 改造 — 代码库独立区域

**Files:**
- Rewrite: `frontend/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: `fetchRepos()`, `fetchQaEntries()`, `fetchTopics()`
- Produces: HomePage 组件

- [ ] **Step 1: 重写 HomePage.tsx**

Write `frontend/src/pages/HomePage.tsx`:

```typescript
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { fetchRepos, fetchQaEntries, fetchTopics } from '@/api/client'
import type { Repo, QaEntry, Topic } from '@/types'
import { Search, GitFork, FileText, MessageCircle, Flame, Plus, ArrowRight } from 'lucide-react'

interface SearchItem {
  type: 'wiki' | 'topic' | 'qa'
  label: string
  key: string
}

export function HomePage() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<Repo[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [draftQa, setDraftQa] = useState<QaEntry[]>([])
  const [hotQa, setHotQa] = useState<QaEntry[]>([])
  const [searchVal, setSearchVal] = useState('')
  const [showSuggest, setShowSuggest] = useState(false)

  useEffect(() => {
    fetchRepos().then(setRepos).catch(() => {})
    fetchTopics().then(setTopics).catch(() => {})
    fetchQaEntries({ sort: 'latest', limit: 5 }).then(d => setDraftQa(d.entries)).catch(() => {})
    fetchQaEntries({ sort: 'visit', limit: 5 }).then(d => setHotQa(d.entries)).catch(() => {})
  }, [])

  const searchPool = useMemo<SearchItem[]>(() => {
    const pool: SearchItem[] = []
    pool.push({ type: 'wiki', label: '📖 物理文档: 双路分流路由算法', key: '02-qa-engine' })
    for (const t of topics) {
      pool.push({ type: 'topic', label: `🏷️ 核心主题: #${t.slug}`, key: t.slug })
    }
    for (const qa of hotQa) {
      pool.push({ type: 'qa', label: `💬 常见问答: ${qa.question.slice(0, 40)}`, key: String(qa.qid) })
    }
    return pool
  }, [topics, hotQa])

  const filteredSuggest = searchVal.trim()
    ? searchPool.filter(i => i.label.toLowerCase().includes(searchVal.toLowerCase())).slice(0, 8)
    : []

  const handleSuggestClick = (item: SearchItem) => {
    setShowSuggest(false)
    setSearchVal('')
    if (item.type === 'qa') navigate('/qa')
    else navigate(`/${repos[0]?.name ?? 'self'}#${item.key}`)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchVal.trim()) {
      navigate(`/qa?q=${encodeURIComponent(searchVal.trim())}`)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="home" />
      <main className="flex-1 overflow-y-auto no-scrollbar">
        <div className="max-w-5xl mx-auto space-y-10 py-10 px-6">

          {/* Hero Search */}
          <div className="text-center space-y-5 py-6">
            <div className="flex items-center justify-center gap-2.5">
              <div className="w-9 h-9 bg-cyber-blue rounded-xl flex items-center justify-center text-white font-black text-lg font-mono shadow-md shadow-cyber-blue/20">W</div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">OpenCodeWiki</h1>
            </div>
            <p className="text-gray-400 text-sm max-w-md mx-auto">基于代码和问答的自进化团队知识平台</p>
            <div className="max-w-2xl mx-auto relative px-4">
              <div className="bg-white border border-gray-200/80 rounded-2xl shadow-lg p-3.5 flex items-center gap-3 transition-all duration-300 focus-within:border-cyber-blue focus-within:ring-4 focus-within:ring-cyber-blue/10">
                <Search className="w-5 h-5 text-gray-400 shrink-0 ml-1" />
                <input
                  type="text" value={searchVal}
                  onChange={e => { setSearchVal(e.target.value); setShowSuggest(true) }}
                  onFocus={() => setShowSuggest(true)} onKeyDown={handleSearchKeyDown}
                  className="w-full bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none py-1"
                  placeholder="搜索文档、主题或问答..."
                />
                <span className="text-[10px] bg-gray-100 border border-gray-200 text-gray-400 font-mono px-2 py-1 rounded-lg shrink-0">Ctrl+K</span>
              </div>
              {showSuggest && searchVal.trim() && filteredSuggest.length > 0 && (
                <div className="absolute top-full left-4 right-4 bg-white border border-gray-100 rounded-xl shadow-xl mt-1.5 p-2 text-left text-xs z-50">
                  {filteredSuggest.map(item => (
                    <button key={item.label} onClick={() => handleSuggestClick(item)}
                      className="w-full p-2.5 hover:bg-slate-100 rounded-lg flex justify-between items-center transition">
                      <span className="font-medium text-gray-700">{item.label}</span>
                      <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded uppercase font-bold">{item.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 代码库 (全宽独立区域) */}
          <section>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <GitFork className="w-4 h-4" /> 代码库
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

          {/* 内容卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* 最新文档 */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm hover:shadow-md transition group">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-cyber-blue" /> 最新文档
              </h3>
              <button onClick={() => navigate(`/${repos[0]?.name ?? 'self'}#02-qa-engine`)}
                className="w-full text-left border-l-2 border-cyber-blue pl-3 py-1 text-xs group-hover:bg-blue-50/50 rounded-r-lg transition">
                <div className="font-semibold text-gray-800 truncate">双路分流路由算法系统</div>
                <div className="text-[10px] text-gray-400 mt-0.5">opencodewiki · 3小时前</div>
              </button>
              <div className="mt-3 pt-3 border-t border-gray-50">
                <button onClick={() => navigate('/wiki')} className="text-[10px] text-gray-400 hover:text-cyber-blue flex items-center gap-1">
                  查看所有文档 <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* 最新 QA */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm hover:shadow-md transition group">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <MessageCircle className="w-4 h-4 text-amber-500" /> 最新问答
              </h3>
              {draftQa.slice(0, 3).map(qa => (
                <div key={qa.qid} onClick={() => navigate(`/qa?qid=${qa.qid}`)}
                  className="cursor-pointer border-l-2 border-amber-400 pl-3 py-1 text-xs group-hover:bg-amber-50/50 rounded-r-lg transition mb-1.5">
                  <div className="font-semibold text-gray-800 truncate">{qa.question}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{qa.created_at?.slice(0, 10)}</div>
                </div>
              ))}
              <div className="mt-3 pt-3 border-t border-gray-50">
                <button onClick={() => navigate('/qa')} className="text-[10px] text-gray-400 hover:text-cyber-blue flex items-center gap-1">
                  查看所有问答 <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* 最热 QA */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm hover:shadow-md transition group">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-red-500" /> 最热问答
              </h3>
              {hotQa.slice(0, 3).map(qa => (
                <div key={qa.qid} onClick={() => navigate(`/qa?qid=${qa.qid}`)}
                  className="cursor-pointer border-l-2 border-cyber-green pl-3 py-1 text-xs group-hover:bg-green-50/50 rounded-r-lg transition mb-1.5">
                  <div className="font-semibold text-gray-800 truncate">{qa.question}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{qa.visit_count} 次访问</div>
                </div>
              ))}
              <div className="mt-3 pt-3 border-t border-gray-50">
                <button onClick={() => navigate('/wiki')} className="text-[10px] text-gray-400 hover:text-cyber-blue flex items-center gap-1">
                  查看所有 Topic <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
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
git add frontend/src/pages/HomePage.tsx
git commit -m "feat: HomePage 改造 — 代码库独立区域 + 三内容卡片

代码库全宽独立展示，三卡片 最新文档/最新QA/最热QA，去状态标签

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: WikiGlobalPage 全局页（新增 `/wiki`）

**Files:**
- Create: `frontend/src/pages/WikiGlobalPage.tsx`
- Modify: `frontend/src/App.tsx` (add route)

**Interfaces:**
- Consumes: `fetchRepos()`, `fetchTopics()`
- Produces: WikiGlobalPage 组件
- Route: `/wiki` → `<WikiGlobalPage />`

- [ ] **Step 1: 创建 WikiGlobalPage.tsx**

Write `frontend/src/pages/WikiGlobalPage.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
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

Edit `frontend/src/App.tsx`:

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

> 注意：`/:repo` 必须在 `/wiki` 之后注册，否则 `/wiki` 会被 `/:repo` 捕获。

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/WikiGlobalPage.tsx frontend/src/App.tsx
git commit -m "feat: 新增 WikiGlobalPage /wiki 全局页面

代码库目录 + Topic 全景 + 最近变动，全局视角入口

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: WikiRightSidebar + TopicRightSidebar 组件

**Files:**
- Create: `frontend/src/components/layout/WikiRightSidebar.tsx`
- Create: `frontend/src/components/layout/TopicRightSidebar.tsx`

- [ ] **Step 1: WikiRightSidebar.tsx**

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

Write `frontend/src/components/layout/TopicRightSidebar.tsx`:

```typescript
import { useNavigate } from 'react-router-dom'
import { MessageCircle, FileText } from 'lucide-react'

interface QaBrief { qid: number; question: string; created_at: string }
interface WikiLink { slug: string; name: string }

interface TopicRightSidebarProps {
  qaEntries: QaBrief[]
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
                <button key={qa.qid} onClick={() => navigate(`/qa?qid=${qa.qid}`)}
                  className="w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 transition">
                  <span className="font-mono text-[10px] text-cyber-blue font-bold mr-1.5">#Q{qa.qid}</span>
                  <span className="text-gray-600">{qa.question.length > 40 ? qa.question.slice(0, 40) + '...' : qa.question}</span>
                </button>
              ))}
            </nav>
          ) : <div className="text-[11px] text-gray-400 py-2">暂无关联 QA</div>}
        </div>
        {/* 关联页面 */}
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
git commit -m "feat: 新增 WikiRightSidebar + TopicRightSidebar 组件

TOC文章目录 + Topic关联QA/Wiki页面

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: API 扩展 — wiki 路由返回 topic 关联数据

**Files:**
- Modify: `src/python-agent/main.py` (lines 211-223)
- Modify: `frontend/src/types/index.ts` (add WikiPageResponse)
- Modify: `frontend/src/api/client.ts` (update fetchWikiPage)

- [ ] **Step 1: main.py topic fallback 扩展**

Replace the topic fallback block in `api_wiki_page()`:

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

- [ ] **Step 2: 前端类型扩展**

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

- [ ] **Step 3: API client 更新**

Edit `frontend/src/api/client.ts`:

```typescript
import type { ApiResponse, Repo, QaEntry, Topic, TopicDraft, WikiPageResponse } from '@/types'

// ... existing code ...

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

GET /api/wiki/:slug topic 模式返回 qa_entries/wiki_links/topic 元信息

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: WikiPage 三栏布局

**Files:**
- Rewrite: `frontend/src/pages/WikiPage.tsx`

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
  const [rawContent, setRawContent] = useState('')
  const [pageType, setPageType] = useState<'wiki' | 'topic'>('wiki')
  const [currentSlug, setCurrentSlug] = useState('')
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

  const renderedHtml = useMemo(() => {
    if (!rawContent) return ''
    return marked.parse(rawContent, { async: false }) as string
  }, [rawContent])

  // Highlight.js + Mermaid
  useEffect(() => {
    if (!articleRef.current || !renderedHtml) return
    import('highlight.js').then(hljs => {
      articleRef.current?.querySelectorAll('pre code').forEach(b => hljs.default.highlightElement(b as HTMLElement))
    }).catch(() => {})
    const mmds = articleRef.current.querySelectorAll('.language-mermaid')
    if (mmds.length > 0) {
      import('mermaid').then(m => {
        mmds.forEach(block => {
          const pre = block.parentElement
          if (!pre) return
          const div = document.createElement('div')
          div.className = 'mermaid my-4'; div.textContent = block.textContent
          pre.parentElement?.replaceChild(div, pre)
        })
        m.default.run({ nodes: articleRef.current?.querySelectorAll('.mermaid') })
      }).catch(() => {})
    }
  }, [renderedHtml])

  const handleNavigate = (slug: string) => { window.location.hash = slug }

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
                  <h2 className="text-xl font-bold text-gray-800">{repo} 知识库</h2>
                  <p className="text-sm text-gray-400">从左侧选择文档开始阅读，或点击 #topic 查看关联问答聚合</p>
                  <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                    <FileText className="w-3.5 h-3.5" /> 物理文档 <span className="text-gray-300">·</span>
                    <Hash className="w-3.5 h-3.5" /> Topic 聚合 <span className="text-gray-300">·</span>
                    <Search className="w-3.5 h-3.5" /> 全文检索
                  </div>
                </div>
              )}
              {renderedHtml && (
                <div className="bg-white border border-gray-200/50 rounded-xl p-8 md:p-10 pb-32 shadow-sm">
                  {pageType === 'topic' && (
                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                      <span className="text-[10px] font-mono bg-cyber-blue/10 text-cyber-blue px-2 py-0.5 rounded font-bold">
                        <Hash className="w-3 h-3 inline mr-1" />TOPIC VIEW
                      </span>
                      <span className="text-[10px] text-gray-400">主题聚合视图</span>
                    </div>
                  )}
                  <article ref={articleRef} className="prose prose-slate max-w-none text-sm leading-relaxed font-sans [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_pre]:bg-[#1e293b] [&_pre]:text-[#e2e8f0] [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono [&_a]:text-cyber-blue [&_blockquote]:border-l-4 [&_blockquote]:border-cyber-blue [&_blockquote]:pl-4 [&_blockquote]:bg-gray-50 [&_blockquote]:rounded-r-lg [&_table]:w-full [&_th]:border [&_th]:bg-gray-50 [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:px-3 [&_td]:py-2"
                    dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                </div>
              )}
            </div>
          </div>
          <BottomInput visible placeholder="对当前文档提问..." contextTag={currentSlug} />
        </main>
        {pageType === 'topic'
          ? <TopicRightSidebar qaEntries={wikiData?.qa_entries || []} wikiLinks={wikiData?.wiki_links || []} />
          : <WikiRightSidebar renderedHtml={renderedHtml} />
        }
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/WikiPage.tsx
git commit -m "feat: WikiPage 三栏统一布局

wiki→TOC, topic→关联QA/Wiki页面, 右侧栏条件渲染

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: QAPage 左侧栏知识条目列表

**Files:**
- Rewrite: `frontend/src/pages/QAPage.tsx`
- Modify: `frontend/src/components/layout/LeftSidebar.tsx` (QA pageType)

- [ ] **Step 1: 重写 QAPage.tsx**

```typescript
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { useSSE } from '@/hooks/useSSE'
import { fetchQaEntries, fetchQaEntry } from '@/api/client'
import type { QaEntry } from '@/types'
import { Send, Loader2, Search, Plus } from 'lucide-react'

interface Message { role: 'user' | 'assistant'; content: string }

export function QAPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [qaEntries, setQaEntries] = useState<QaEntry[]>([])
  const [selectedQa, setSelectedQa] = useState<QaEntry | null>(null)
  const [viewMode, setViewMode] = useState<'ask' | 'detail'>('ask')
  const [domainFilter, setDomainFilter] = useState<string>('全部')
  const [searchQ, setSearchQ] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState(searchParams.get('q') ?? '')
  const [currentAnswer, setCurrentAnswer] = useState('')
  const { stream, isLoading } = useSSE()
  const contextSlug = searchParams.get('context_entity_slug') || ''

  useEffect(() => {
    fetchQaEntries({ limit: 100 }).then(d => setQaEntries(d.entries)).catch(() => {})
    const qidParam = searchParams.get('qid')
    if (qidParam) {
      fetchQaEntry(Number(qidParam)).then(setSelectedQa).then(() => setViewMode('detail')).catch(() => {})
    }
  }, [searchParams])

  const filtered = useMemo(() => {
    let list = qaEntries
    if (domainFilter !== '全部') list = list.filter(e => e.domain === domainFilter)
    if (searchQ.trim()) list = list.filter(e => e.question.toLowerCase().includes(searchQ.toLowerCase()))
    return list
  }, [qaEntries, domainFilter, searchQ])

  // 时间分组
  const grouped = useMemo(() => {
    const now = new Date()
    const groups: Record<string, QaEntry[]> = { '今天': [], '三天内': [], '本周': [], '本月': [], '更早': [] }
    filtered.forEach(e => {
      const d = new Date(e.created_at)
      const days = (now.getTime() - d.getTime()) / 86400000
      if (days < 1) groups['今天'].push(e)
      else if (days < 3) groups['三天内'].push(e)
      else if (days < 7) groups['本周'].push(e)
      else if (days < 30) groups['本月'].push(e)
      else groups['更早'].push(e)
    })
    return Object.entries(groups).filter(([, list]) => list.length > 0)
  }, [filtered])

  const domains = useMemo(() => {
    const set = new Set(qaEntries.map(e => e.domain).filter(Boolean))
    return ['全部', ...Array.from(set)]
  }, [qaEntries])

  const handleSend = useCallback(() => {
    const q = input.trim()
    if (!q || isLoading) return
    setMessages(prev => [...prev, { role: 'user', content: q }])
    setCurrentAnswer(''); setInput('')
    const body: Record<string, unknown> = { question: q }
    if (contextSlug) body.context_entity_slug = contextSlug
    stream('/api/qa', body, msg => {
      if (msg.type === 'token') setCurrentAnswer(prev => prev + (msg.content as string))
      else if (msg.type === 'error') setCurrentAnswer(`错误: ${msg.message}`)
      else if (msg.type === 'done') {
        setMessages(prev => [...prev, { role: 'assistant', content: currentAnswer }])
        setCurrentAnswer('')
      }
    })
  }, [input, isLoading, stream, currentAnswer])

  const handleSelectQa = async (qid: number) => {
    try {
      const qa = await fetchQaEntry(qid)
      setSelectedQa(qa)
      setViewMode('detail')
    } catch {}
  }

  const handleNewAsk = () => { setViewMode('ask'); setSelectedQa(null) }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" activeSection="qa" />
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧 QA 列表 */}
        <aside className="w-72 border-r border-gray-200/50 bg-[#FBFBFC] flex flex-col shrink-0">
          <div className="p-3 border-b border-gray-100">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                value={searchQ} onChange={e => setSearchQ(e.target.value)}
                className="bg-transparent border-none text-xs text-gray-800 placeholder-gray-400 focus:outline-none w-full"
                placeholder="搜索 QA..."
              />
            </div>
          </div>
          <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-gray-50">
            {domains.map(d => (
              <button key={d} onClick={() => setDomainFilter(d)} className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition ${
                domainFilter === d ? 'bg-cyber-blue text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>{d}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-4">
            {grouped.map(([label, list]) => (
              <div key={label}>
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{label}</h3>
                <div className="space-y-1">
                  {list.map(qa => (
                    <button key={qa.qid} onClick={() => handleSelectQa(qa.qid)}
                      className={`w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 transition flex items-center justify-between gap-2 ${
                        selectedQa?.qid === qa.qid ? 'bg-cyber-blue/5 border-l-2 border-cyber-blue' : ''
                      }`}>
                      <span className="text-gray-800 truncate flex-1">{qa.question}</span>
                      <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap">#{qa.qid}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {grouped.length === 0 && (
              <div className="text-center text-gray-400 text-xs py-8">暂无 QA 记录，从首页或 Wiki 页底部提问开始</div>
            )}
          </div>
          <div className="p-3 border-t border-gray-100">
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleNewAsk}>
              <Plus className="w-3.5 h-3.5 mr-1" /> 新建提问
            </Button>
          </div>
        </aside>

        {/* 主内容区 */}
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar bg-[#FBFBFC]">
          {viewMode === 'detail' && selectedQa ? (
            <div className="flex-1 py-8 px-6">
              <div className="max-w-3xl mx-auto">
                <h2 className="text-lg font-bold text-gray-900 mb-4">{selectedQa.question}</h2>
                {selectedQa.answer && (
                  <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm prose prose-slate max-w-none text-sm">
                    {selectedQa.answer}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 py-8 px-6">
                <div className="max-w-3xl mx-auto space-y-6">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                        m.role === 'user' ? 'bg-cyber-blue text-white' : 'bg-white border border-gray-200/50 shadow-sm text-gray-800'
                      }`}>{m.content}</div>
                    </div>
                  ))}
                  {currentAnswer && (
                    <div className="flex justify-start">
                      <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm bg-white border border-gray-200/50 shadow-sm text-gray-800">{currentAnswer}</div>
                    </div>
                  )}
                  {messages.length === 0 && !currentAnswer && (
                    <div className="text-center text-gray-400 py-20">
                      <h2 className="text-lg font-bold text-gray-700 mb-2">对代码库提问</h2>
                      <p className="text-sm">选中左侧 QA 条目查看详情，或下方输入提问</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="sticky bottom-0 bg-gradient-to-t from-[#F8F9FA] via-[#F8F9FA]/80 to-transparent py-6 px-6">
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-center gap-2 bg-white border border-gray-200/80 rounded-xl shadow-lg p-3 focus-within:border-cyber-blue focus-within:ring-2 focus-within:ring-cyber-blue/10 transition-all">
                    {contextSlug && (
                      <span className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-cyber-blue/10 text-cyber-blue text-[10px] font-mono rounded whitespace-nowrap font-bold">#{contextSlug}</span>
                    )}
                    <input type="text" value={input} onChange={e => setInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSend()}
                      placeholder={contextSlug ? `对 #${contextSlug} 提问...` : '对代码库提问...'}
                      className="flex-1 bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none py-1"
                    />
                    <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend} disabled={isLoading}>
                      {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
```

> 注：LeftSidebar 的 QA 模式已移入 QAPage 内联侧栏，不再复用 LeftSidebar 组件。LeftSidebar 的 qa pageType 逻辑后续可从 LeftSidebar.tsx 中移除。

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/QAPage.tsx
git commit -m "feat: QAPage 左侧栏知识条目列表 + 时间分组

左侧展示所有QA条目/time分组/domain过滤，右侧详情/提问

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: AdminPage 审核台

**Files:**
- Rewrite: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: 重写 AdminPage.tsx**

```typescript
import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { fetchQaEntries, calibrateQaEntry, fetchTopics, fetchTopic, fetchTopicDraft, fetchWikiModules, publishTopic, updateTopicDraft } from '@/api/client'
import type { QaEntry, Topic, TopicDraft } from '@/types'
import { Loader2, Sparkles, CheckCircle, Eye, ArrowUpCircle, BookOpen, Shield, MessageSquare, Hash } from 'lucide-react'

export function AdminPage() {
  // 队列数据
  const [pendingQa, setPendingQa] = useState<QaEntry[]>([])
  const [poolTopics, setPoolTopics] = useState<Topic[]>([])
  const [pendingCounts, setPendingCounts] = useState({ qa: 0, topic: 0 })

  // 详情
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null)
  const [selectedDraft, setSelectedDraft] = useState<TopicDraft | null>(null)
  const [modules, setModules] = useState<{ slug: string; name: string; type: string }[]>([])
  const [selectedModule, setSelectedModule] = useState('')

  // UI state
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
      const topic = await fetchTopic(slug)
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
            /* Topic 详情面板（和现有同样的2栏对比布局） */
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
            /* QA 校准队列 */
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
            /* Topic 建议列表 */
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

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat: AdminPage 审核台 — QA校准 + Topic审核 分离队列

左侧栏审核队列导航，主内容Tab切换，Topic详情面板复用

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Header 统一导航 + 用户下拉：Task 2
- ✅ HomePage 代码库独立 + 三卡片：Task 3
- ✅ WikiGlobalPage `/wiki` 新增：Task 4
- ✅ WikiPage 三栏 + 右栏组件：Task 5 + Task 7
- ✅ API 扩展 topic 关联数据：Task 6
- ✅ QAPage 左侧栏知识条目列表：Task 8
- ✅ AdminPage 审核台：Task 9
- ✅ promote → publish 重命名：Task 1

**2. Placeholder scan:** 无 TBD/TODO

**3. Type consistency:**
- `WikiPageResponse` 在 Task 6 定义，Task 7 使用 → 一致
- `publish()` 在 Task 1 定义，Task 9 使用 → 一致
- `WikiRightSidebar` props 在 Task 5，Task 7 传入 → 一致
- `TopicRightSidebar` props 在 Task 5，Task 7 传入 → 一致
