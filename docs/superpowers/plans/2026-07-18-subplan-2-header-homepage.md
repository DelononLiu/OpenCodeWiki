# 子计划 2：Header 统一导航 + HomePage 改造

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Header 统一三入口导航（首页/Wiki/问答）+ 用户下拉菜单（审核台/个人设置/退出）+ HomePage 代码库独立区域 + 三内容卡片。

**Architecture:** Header 组件重写，支持管理员/普通成员下拉区分。HomePage 代码库全宽独立 section，三卡片（最新文档/最新 QA/最热 QA）用 grid 布局。

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, shadcn/ui

**Depends on:** 子计划 1（promote→publish 重命名）

## Global Constraints

- 导航三入口：首页、Wiki、问答，所有页面统一显示
- 用户下拉：管理员可见"审核台"
- 颜色：primary `#4F46E5`, bg `#F8F9FA`, card `#FFFFFF`
- 代码库区域全宽独立，不在 2x2 网格中
- 去状态标签（"待审草稿"/"已校准"）
- admin 白名单初期硬编码

---

### Task 1: Header 统一导航 + 用户下拉菜单

**Files:**
- Rewrite: `frontend/src/components/layout/Header.tsx`

- [ ] **Step 1: 重写 Header.tsx**

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Home, BookOpen, MessagesSquare, ChevronDown, Settings, LogOut, Shield } from 'lucide-react'

const ADMIN_USERS = ['long2015']

interface HeaderProps {
  variant: 'home' | 'global'
  repoName?: string
  activeSection?: string
}

export function Header({ variant, repoName }: HeaderProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const currentUser = 'long2015'
  const isAdmin = ADMIN_USERS.includes(currentUser)

  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 px-6 py-3 flex items-center justify-between z-30 shrink-0">
      {/* 左侧 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-6 h-6 bg-cyber-blue rounded flex items-center justify-center text-white font-black text-xs font-mono">W</div>
          <span className="font-sans font-bold text-sm tracking-tight text-gray-900">OpenCodeWiki</span>
        </div>
        {repoName && variant === 'global' && (
          <>
            <span className="text-gray-300 text-sm">/</span>
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{repoName}</div>
          </>
        )}
      </div>

      {/* 右侧 */}
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
                    <button onClick={() => { navigate('/admin'); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-700">
                      <Shield className="w-4 h-4 text-amber-500" /> 审核台
                    </button>
                    <div className="border-t border-gray-100 my-1" />
                  </>
                )}
                <button onClick={() => { navigate('/settings'); setMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-700">
                  <Settings className="w-4 h-4" /> 个人设置
                </button>
                <button onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-500">
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

审核台仅管理员可见，用户下拉含个人设置/退出

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: HomePage 改造 — 代码库独立区域 + 三内容卡片

**Files:**
- Rewrite: `frontend/src/pages/HomePage.tsx`

- [ ] **Step 1: 重写 HomePage.tsx**

```typescript
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
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
    setShowSuggest(false); setSearchVal('')
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
                <input type="text" value={searchVal}
                  onChange={e => { setSearchVal(e.target.value); setShowSuggest(true) }}
                  onFocus={() => setShowSuggest(true)} onKeyDown={handleSearchKeyDown}
                  className="w-full bg-transparent border-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none py-1"
                  placeholder="搜索文档、主题或问答..." />
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

          {/* 三内容卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* 最新文档 */}
            <div className="bg-white border border-gray-200/50 rounded-xl p-5 shadow-sm hover:shadow-md transition group">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-cyber-blue" /> 最新文档
              </h3>
              <button onClick={() => navigate(`/${repos[0]?.name ?? 'self'}#02-qa-engine`)}
                className="w-full text-left border-l-2 border-cyber-blue pl-3 py-1 text-xs hover:bg-blue-50/50 rounded-r-lg transition">
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
                  className="cursor-pointer border-l-2 border-amber-400 pl-3 py-1 text-xs hover:bg-amber-50/50 rounded-r-lg transition mb-1.5">
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
                  className="cursor-pointer border-l-2 border-cyber-green pl-3 py-1 text-xs hover:bg-green-50/50 rounded-r-lg transition mb-1.5">
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
git commit -m "feat: HomePage 代码库独立区域 + 三内容卡片

代码库全宽独立展示，最新文档/最新QA/最热QA，去状态标签

Co-Authored-By: Claude <noreply@anthropic.com>"
```
