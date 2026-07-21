# OpenCodeWiki UI 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构前端 UI，建立 VS Code 式深色侧栏 + 代码溯源可视化 + QA→Topic→Wiki 自进化链路

**Architecture:** 保持 sidebar + main + right panel 三栏结构。侧栏改为深色 slate-900 背景，内嵌 KB 下拉和文档树。移除 Header，移除 LayoutContext.drawerContent 文档树注入。QA 页侧栏显示 session 历史，Wiki 页侧栏显示文档树。

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Radix UI, Lucide React, react-router-dom v6

## Global Constraints

- 仅桌面 Web，不做移动端适配
- 路由结构不变
- 后端 API 不变
- 数据模型不变
- AdminPage / SourcesPage / QASharePage / SettingsPage 本期不改
- 代码溯源（Wiki 页）、关联Topic、收藏、Topic升级 API 本期仅 UI 占位
- 无侧栏内容切换动画
- KB 切换通过 URL 同步
- ⚙ 始终弹 modal，不跳路由
- HomePage 侧栏文档树区空着

---

## 文件结构

```
新建:
  frontend/src/components/layout/ContextToolbar.tsx
  frontend/src/components/content/CodeBlock.tsx
  frontend/src/components/layout/ContentRightPanel.tsx
  frontend/src/components/qa/AnswerActions.tsx
  frontend/src/components/qa/CodeTraceCard.tsx
  frontend/src/components/settings/SettingsModal.tsx

重构:
  frontend/src/App.tsx
  frontend/src/components/layout/AppSidebar.tsx
  frontend/src/contexts/LayoutContext.tsx
  frontend/src/pages/HomePage.tsx
  frontend/src/pages/WikiPage.tsx
  frontend/src/pages/WikiGlobalPage.tsx
  frontend/src/pages/QAPage.tsx
  frontend/src/components/layout/WikiRightSidebar.tsx
  frontend/src/components/layout/TopicRightSidebar.tsx
  frontend/tailwind.config.ts
  frontend/src/index.css

移除:
  frontend/src/components/layout/Header.tsx
  frontend/src/components/layout/Header.test.tsx
  frontend/src/components/layout/LeftSidebar.tsx
```

---

### Task 1: 颜色系统 + Tailwind 配置

**Files:**
- Modify: `frontend/tailwind.config.ts`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Produces: Tailwind color tokens `sidebar-*`, `code-*`, `cyber-*` 扩展

- [ ] **Step 1: 扩展 tailwind.config.ts 颜色配置**

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cyber: {
          blue: '#4F46E5',
          'blue-dark': '#4338CA',
          'blue-light': '#EEF2FF',
          green: '#10B981',
          orange: '#F59E0B',
          amber: '#F59E0B',
          red: '#EF4444',
          violet: '#8B5CF6',
          cyan: '#06B6D4',
          bg: '#F8FAFC',
          card: '#FFFFFF',
        },
        sidebar: {
          bg: '#1E293B',
          text: '#94A3B8',
          active: '#FFFFFF',
        },
        code: {
          bg: '#0F172A',
          text: '#E2E8F0',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
}

export default config
```

- [ ] **Step 2: 更新 index.css action-bar 规则**

将 `.answer-block .action-bar { opacity: 0; }` 改为始终可见。在 `index.css` 中替换为注释掉的旧规则，新增：

```css
/* Answer block action bar — always visible */
.answer-block .action-bar {
  opacity: 1;
}
```

- [ ] **Step 3: 验证** 运行 `npm run dev` 确保无编译错误

```bash
cd frontend && npm run dev
```

- [ ] **Step 4: Commit**

```bash
git add frontend/tailwind.config.ts frontend/src/index.css
git commit -m "feat: extend color system for dark sidebar and code blocks

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: AppSidebar 深色化 + KB 下拉 + 文档树内嵌

**Files:**
- Rewrite: `frontend/src/components/layout/AppSidebar.tsx`

**Interfaces:**
- Consumes: `useLayout` (activeTab, setActiveTab, sidebarOpen, toggleSidebar, drawerContent → 仍在 context 但 doc tree 不再通过 drawerContent 渲染)
- Consumes: `useNavigate`, `useLocation` from react-router-dom
- Consumes: `fetchWikiModules` from `@/api/client`, `fetchTopics` from `@/api/client`, `WikiModule` type (inline from `fetchWikiModules` return)
- Produces: AppSidebar 组件，深色背景，KB 下拉组件，文档树渲染

- [ ] **Step 1: 重写 AppSidebar.tsx**

```tsx
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useLayout, type TabType } from '@/contexts/LayoutContext'
import { fetchWikiModules, fetchTopics } from '@/api/client'
import type { Topic } from '@/types'
import {
  BookOpen, MessageSquare, FileText, Settings,
  Plus, ChevronLeft, ChevronDown, Search, GitFork,
} from 'lucide-react'

interface WikiModule {
  slug: string; name: string; type: string; title?: string
}

const KB_LIST = [
  { name: 'opencodewiki', path: '/home/long/Code/OpenCodeWiki' },
]

export function AppSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { activeTab, setActiveTab } = useLayout()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Doc tree data
  const [modules, setModules] = useState<WikiModule[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [kbDropdownOpen, setKbDropdownOpen] = useState(false)

  // Determine current KB from URL
  const wikiParams = useParams<{ name: string }>()
  const repoParams = useParams<{ repo: string }>()
  const currentKB = wikiParams.name || repoParams.repo || KB_LIST[0]?.name || ''

  useEffect(() => {
    fetchWikiModules().then(setModules).catch(() => {})
    fetchTopics().then(setTopics).catch(() => {})
  }, [])

  const toggleSidebar = () => setSidebarOpen(o => !o)

  const isActive = (path: string) => {
    if (path === '/wiki') return location.pathname.startsWith('/wiki') || !!useParams<{ repo: string }>().repo
    return location.pathname.startsWith(path)
  }

  const handleTabClick = (tab: TabType, path: string) => {
    setActiveTab(tab)
    navigate(path)
  }

  // Filter modules by current KB
  const kbModules = useMemo(() => {
    if (!currentKB) return modules
    return modules.filter(m => {
      const source = m.name.split(' / ')[0]
      return source === currentKB
    })
  }, [modules, currentKB])

  // Build doc tree
  const docTree = useMemo(() => {
    interface TreeNode { dirs: Record<string, TreeNode>; files: WikiModule[] }
    const root: TreeNode = { dirs: {}, files: [] }
    for (const m of kbModules) {
      if (m.type !== 'source') continue
      const parts = m.slug.split('/')
      let node = root
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.dirs[parts[i]]) node.dirs[parts[i]] = { dirs: {}, files: [] }
        node = node.dirs[parts[i]]
      }
      node.files.push(m)
    }

    const toggleDir = (path: string) => {
      setExpandedDirs(prev => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
    }

    const renderNode = (node: TreeNode, depth: number, path: string): React.ReactNode[] => {
      const els: React.ReactNode[] = []
      const indent = depth * 12
      for (const dirName of Object.keys(node.dirs).sort()) {
        const dirPath = path ? `${path}/${dirName}` : dirName
        const isExpanded = expandedDirs.has(dirPath)
        els.push(
          <div key={`dir-${dirPath}`}>
            <button onClick={() => toggleDir(dirPath)}
              style={{ paddingLeft: `${indent + 12}px` }}
              className="w-full flex items-center gap-0.5 text-left py-0.5 pr-2 rounded text-[11px] font-mono text-sidebar-text hover:bg-white/10 hover:text-sidebar-active transition">
              <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
              <span className="truncate">{dirName}</span>
            </button>
            {isExpanded && <div>{renderNode(node.dirs[dirName], depth + 1, dirPath)}</div>}
          </div>
        )
      }
      for (const m of node.files.sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug))) {
        els.push(
          <button key={m.slug} onClick={() => navigate(`/${currentKB}#${m.slug}`)}
            style={{ paddingLeft: `${indent + 28}px` }}
            className={`block w-full text-left py-0.5 pr-2 rounded text-[11px] leading-snug hover:bg-white/10 transition truncate font-mono ${
              location.hash === `#${m.slug}` ? 'text-sidebar-active bg-white/10' : 'text-sidebar-text'
            }`}>
            {m.title || m.slug.split('/').pop()}
          </button>
        )
      }
      return els
    }
    return renderNode(root, 0, '')
  }, [kbModules, expandedDirs, currentKB, location.hash, navigate])

  // Show doc tree area on Wiki-related tabs
  const showDocTree = location.pathname.startsWith('/wiki') || !!useParams<{ repo: string }>().repo

  return (
    <>
      <aside className={`h-screen bg-sidebar-bg flex flex-col shrink-0 z-30 transition-all duration-200 ${sidebarOpen ? 'w-60' : 'w-14'}`}>
        {/* Logo */}
        <div className={`flex items-center py-3 ${sidebarOpen ? 'px-3 justify-between' : 'justify-center'}`}>
          <button onClick={toggleSidebar}
            className="w-8 h-8 bg-cyber-blue rounded-lg flex items-center justify-center text-white font-black text-sm font-mono hover:bg-cyber-blue-dark transition shrink-0">
            W
          </button>
          {sidebarOpen && (
            <span className="text-[11px] font-bold text-sidebar-active truncate ml-2">OpenCodeWiki</span>
          )}
          {sidebarOpen && (
            <button onClick={toggleSidebar} className="p-1 rounded hover:bg-white/10 text-sidebar-text ml-auto">
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* New Question */}
        <div className={`px-2 mb-2 ${sidebarOpen ? '' : 'flex justify-center'}`}>
          <button onClick={() => { navigate('/qa'); setActiveTab('qa') }}
            title="新问题"
            className={`flex items-center gap-2 rounded-lg transition ${
              sidebarOpen
                ? 'w-full px-3 py-1.5 bg-cyber-blue/20 text-cyber-blue-light hover:bg-cyber-blue/30 justify-start'
                : 'w-8 h-8 justify-center text-sidebar-text hover:bg-white/10 hover:text-sidebar-active'
            }`}>
            <Plus className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span className="text-xs font-semibold">新问题</span>}
          </button>
        </div>

        {/* Nav tabs */}
        <nav className="flex flex-col gap-0.5 px-2 mb-2">
          {[
            { key: 'read' as TabType, icon: BookOpen, label: 'Wiki', path: '/wiki' },
            { key: 'qa' as TabType, icon: MessageSquare, label: '问答', path: '/qa' },
            { key: 'wiki' as TabType, icon: FileText, label: 'Topics', path: '/admin' },
          ].map(tab => (
            <button key={tab.key} onClick={() => handleTabClick(tab.key, tab.path)}
              title={tab.label}
              className={`flex items-center gap-2 rounded-lg transition ${
                sidebarOpen ? 'w-full px-3 py-1.5 justify-start' : 'w-8 h-8 justify-center mx-auto'
              } ${
                isActive(tab.path) ? 'bg-cyber-blue/20 text-sidebar-active' : 'text-sidebar-text hover:bg-white/10 hover:text-sidebar-active'
              }`}>
              <tab.icon className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="text-xs font-semibold">{tab.label}</span>}
            </button>
          ))}
        </nav>

        {/* KB Dropdown — Wiki pages only */}
        {sidebarOpen && showDocTree && (
          <div className="px-2 mb-2">
            <div className="relative">
              <button onClick={() => setKbDropdownOpen(o => !o)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-sidebar-text hover:bg-white/10 transition">
                <GitFork className="w-3 h-3 shrink-0" />
                <span className="truncate">{currentKB || '选择知识库'}</span>
                <ChevronDown className="w-3 h-3 ml-auto shrink-0" />
              </button>
              {kbDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg py-1 z-40"
                  onMouseLeave={() => setKbDropdownOpen(false)}>
                  {KB_LIST.map(kb => (
                    <button key={kb.name}
                      onClick={() => { navigate(`/wiki/${kb.name}`); setKbDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-white/10 transition ${
                        currentKB === kb.name ? 'text-cyber-blue-light bg-cyber-blue/10' : 'text-sidebar-text'
                      }`}>
                      {kb.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Separator */}
        {sidebarOpen && showDocTree && <div className="mx-3 border-t border-slate-700" />}

        {/* Doc Tree / Session History */}
        {sidebarOpen && (
          <div className="flex-1 overflow-y-auto no-scrollbar mt-2 px-2">
            {showDocTree ? (
              /* Doc tree */
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 px-2.5 flex items-center justify-between">
                  文档
                  <button className="text-slate-500 hover:text-sidebar-text">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                {kbModules.length > 0 ? docTree : (
                  <div className="text-[10px] text-slate-600 px-2.5 py-4 text-center">暂无文档</div>
                )}
                {/* Topics in sidebar */}
                {topics.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 px-2.5">主题</div>
                    {topics.map(t => (
                      <button key={t.slug} onClick={() => navigate(`/${currentKB}#${t.slug}`)}
                        className={`block w-full text-left px-2.5 py-1 rounded text-[11px] hover:bg-white/10 transition truncate font-mono ${
                          location.hash === `#${t.slug}` ? 'text-sidebar-active bg-white/10' : 'text-sidebar-text'
                        }`}>
                        #{t.slug}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : location.pathname === '/' ? (
              /* Homepage — empty */
              <div />
            ) : (
              /* QA page — empty for now, will get session history in Phase 3 */
              <div />
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings icon */}
        <div className={`mb-1 ${sidebarOpen ? 'px-2' : 'flex justify-center'}`}>
          <button onClick={() => setSettingsOpen(true)} title="设置"
            className={`flex items-center gap-2 rounded-lg transition ${
              sidebarOpen ? 'w-full px-3 py-1.5 justify-start text-sidebar-text hover:bg-white/10' : 'w-8 h-8 justify-center text-sidebar-text hover:bg-white/10 hover:text-sidebar-active'
            }`}>
            <Settings className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span className="text-xs font-semibold">设置</span>}
          </button>
        </div>

        {/* User */}
        <div className={`mb-3 ${sidebarOpen ? 'px-2' : 'flex justify-center'}`}>
          <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-[10px] font-bold text-sidebar-text">
            L
          </div>
        </div>
      </aside>

      {/* SettingsModal placeholder — will be replaced in Task 13 */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) setSettingsOpen(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-[720px] h-[480px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">⚙ 设置</h2>
              <button onClick={() => setSettingsOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <p className="text-sm text-gray-400">设置面板将在 Phase 4 完成</p>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: 验证** `npm run dev`，确认侧栏深色渲染、KB 下拉、文档树折叠正常

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/AppSidebar.tsx
git commit -m "feat: dark sidebar with KB dropdown and embedded doc tree

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 简化 LayoutContext

**Files:**
- Modify: `frontend/src/contexts/LayoutContext.tsx`

**Interfaces:**
- Consumes: none (internal change)
- Produces: LayoutContext (去掉 drawerContent, drawerOpen, toggleDrawer, closeDrawer — 仅保留 activeTab/setActiveTab)

- [ ] **Step 1: 精简 LayoutContext**

```tsx
import { createContext, useContext, useState, ReactNode } from 'react'

export type TabType = 'read' | 'qa' | 'wiki' | 'manage' | null

interface LayoutContextValue {
  activeTab: TabType
  setActiveTab: (tab: TabType) => void
}

const LayoutContext = createContext<LayoutContextValue>({
  activeTab: null,
  setActiveTab: () => {},
})

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabType>(null)

  return (
    <LayoutContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </LayoutContext.Provider>
  )
}

export const useLayout = () => useContext(LayoutContext)
```

- [ ] **Step 2: 清理下游引用** — 搜索所有使用 `drawerContent`, `setDrawerContent`, `drawerOpen`, `toggleDrawer`, `closeDrawer` 的文件

- WikiGlobalPage.tsx 中移除 `setDrawerContent` 等 drawer 相关调用（在 Task 4 中处理）
- QAPage.tsx 中移除 `setDrawerContent` 注入 session 历史的逻辑（在 Task 12 中处理）
- useSessionHistory.ts 移除 `setDrawerContent` 引用（在 Task 12 中处理）

- [ ] **Step 3: 验证** `npm run dev` 确认无编译错误，此时 WikiGlobalPage 和 QAPage 可能有未使用变量的 warning，后续 task 清理

- [ ] **Step 4: Commit**

```bash
git add frontend/src/contexts/LayoutContext.tsx
git commit -m "refactor: simplify LayoutContext, remove drawerContent injection

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 移除 Header + 更新 WikiGlobalPage

**Files:**
- Remove: `frontend/src/components/layout/Header.tsx`
- Remove: `frontend/src/components/layout/Header.test.tsx`
- Modify: `frontend/src/pages/WikiGlobalPage.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`
- Modify: `frontend/src/pages/QASharePage.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: LayoutContext (仅 activeTab/setActiveTab)

- [ ] **Step 1: 删除 Header 文件**

```bash
rm frontend/src/components/layout/Header.tsx frontend/src/components/layout/Header.test.tsx
```

- [ ] **Step 2: 更新 WikiGlobalPage.tsx** — 移除 Header import + drawerContent 调用，移除 KB 下拉（已在侧栏）

```tsx
import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { WikiRightSidebar } from '@/components/layout/WikiRightSidebar'
import { fetchWikiPage, fetchWikiModules } from '@/api/client'
import type { WikiPageResponse } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Loader2, BookOpen } from 'lucide-react'

export function WikiGlobalPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [wikiPages, setWikiPages] = useState<{slug: string; name: string}[]>([])
  const [currentSlug, setCurrentSlug] = useState('')
  const [rawContent, setRawContent] = useState('')
  const [pageType, setPageType] = useState<'wiki' | 'topic'>('wiki')
  const [loading, setLoading] = useState(false)

  // 折叠状态
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) { next.delete(path) } else { next.add(path) }
      return next
    })
  }

  // 构建树形 JSX（不再注入 sidebar drawer）
  const wikiTree = useMemo(() => {
    if (wikiPages.length === 0) return null
    interface TreeNode { dirs: Record<string, TreeNode>; files: {slug:string; title:string}[] }
    const root: TreeNode = { dirs: {}, files: [] }
    for (const p of wikiPages) {
      const parts = p.slug.split('/')
      let node = root
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.dirs[parts[i]]) node.dirs[parts[i]] = { dirs: {}, files: [] }
        node = node.dirs[parts[i]]
      }
      node.files.push({ slug: p.slug, title: p.name })
    }
    const renderNode = (node: TreeNode, depth: number, path: string): React.ReactNode[] => {
      const els: React.ReactNode[] = []
      const indent = depth * 12
      for (const dirName of Object.keys(node.dirs).sort()) {
        const dirPath = path ? `${path}/${dirName}` : dirName
        const isExpanded = expandedDirs.has(dirPath)
        els.push(
          <div key={`dir-${dirPath}`}>
            <button onClick={() => toggleDir(dirPath)}
              style={{ paddingLeft: `${indent + 6}px` }}
              className="w-full flex items-center gap-0.5 text-left py-1 pr-2 rounded text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition">
              <span className={`inline-block w-3 h-3 text-center text-[10px] leading-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▸</span>
              <span className="truncate">📁 {dirName}</span>
            </button>
            {isExpanded && <div>{renderNode(node.dirs[dirName], depth + 1, dirPath)}</div>}
          </div>
        )
      }
      for (const f of node.files.sort((a,b) => a.title.localeCompare(b.title))) {
        els.push(
          <button key={f.slug} onClick={() => loadContent(f.slug)}
            style={{ paddingLeft: `${indent + 22}px` }}
            className={`block w-full text-left py-1 pr-2 rounded text-xs leading-snug hover:bg-gray-50 transition truncate ${currentSlug === f.slug ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-gray-600'}`}>
            {f.title}
          </button>
        )
      }
      return els
    }
    return <>{renderNode(root, 0, '')}</>
  }, [wikiPages, expandedDirs, currentSlug])

  // 加载知识库
  const selectedKb = name || ''

  useEffect(() => {
    if (!selectedKb) return
    setCurrentSlug('')
    setRawContent('')
    setWikiPages([])
    fetchWikiModules().then(modules => {
      const pages = modules
        .filter(m => {
          if (!m.slug || m.slug.startsWith('_')) return false
          const sourceName = m.name.split(' / ')[0]
          return sourceName === selectedKb
        })
        .map(m => ({ slug: m.slug, name: (m.title || m.slug.split('/').pop() || m.slug) }))
      setWikiPages(pages)
      if (pages.length > 0) {
        loadContent(pages[0].slug, true)
      }
    }).catch(() => {})
  }, [name])

  const extractText = (children: any): string => {
    if (typeof children === 'string') return children
    if (Array.isArray(children)) return children.map(c => extractText(c)).join('')
    if (children?.props?.children) return extractText(children.props.children)
    return ''
  }

  const loadContent = async (slug: string, initial = false) => {
    if (!slug) return
    if (!initial) setLoading(true)
    try {
      const data = await fetchWikiPage(slug)
      setRawContent(data.content || '')
      setPageType(data.type as 'wiki' | 'topic')
      setCurrentSlug(slug)
    } catch {
      setRawContent('')
      setPageType('wiki')
      if (initial) setCurrentSlug('')
    } finally {
      if (!initial) setLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#F8FAFC]">
      <div className="flex-1 flex overflow-hidden">
        {/* 文档树内嵌在页面左侧（Wiki 模式下的 fallback，侧栏已处理大多数情况） */}
        <aside className="w-56 border-r border-gray-200/50 bg-white flex flex-col overflow-y-auto no-scrollbar shrink-0">
          <div className="py-3 px-2">
            {wikiTree || <div className="text-[10px] text-gray-400 px-2.5 py-4 text-center">暂无文档</div>}
          </div>
        </aside>

        {/* 主内容区 */}
        <div className="flex-1 flex flex-col relative bg-[#FBFBFC]">
          <main className="flex-1 overflow-y-auto no-scrollbar">
            <div className="flex justify-center py-6 px-6">
              <div className="w-full max-w-4xl">
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : rawContent ? (
                  <article>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ children }) => { const id = extractText(children).toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return <h1 id={id} className="text-3xl font-bold border-b border-gray-200 pb-3 mb-6">{children}</h1> },
                        h2: ({ children }) => { const id = extractText(children).toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return <h2 id={id} className="text-2xl font-semibold mt-12 mb-4">{children}</h2> },
                        h3: ({ children }) => { const id = extractText(children).toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return <h3 id={id} className="text-lg font-semibold mt-8 mb-3">{children}</h3> },
                        h4: ({ children }) => <h4 className="font-semibold mt-6 mb-2">{children}</h4>,
                        a: ({ href, children }) => <a href={href} className="text-cyber-blue no-underline hover:underline">{children}</a>,
                        img: ({ src, alt }) => <img src={src} alt={alt} className="rounded-xl my-4" />,
                        blockquote: ({ children }) => <blockquote className="border-l-4 border-gray-300 pl-5 py-1 text-gray-600 my-6">{children}</blockquote>,
                        table: ({ children }) => <table className="w-full my-6">{children}</table>,
                        th: ({ children }) => <th className="border bg-gray-50 px-3 py-2 text-sm font-semibold">{children}</th>,
                        td: ({ children }) => <td className="border px-3 py-2 text-sm">{children}</td>,
                        code: ({ className, children, ...props }) => {
                          const match = /language-(\w+)/.exec(className || '')
                          const text = String(children).replace(/\n$/, '')
                          if (match) return <SyntaxHighlighter style={vscDarkPlus} language={match[1]} PreTag="div" customStyle={{ borderRadius: 12, fontSize: 13 }}>{text}</SyntaxHighlighter>
                          return <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm text-red-500" {...props}>{children}</code>
                        },
                      }}
                    >
                      {rawContent}
                    </ReactMarkdown>
                  </article>
                ) : selectedKb ? (
                  <div className="text-center py-16 text-gray-400 text-sm">该知识库暂无内容</div>
                ) : (
                  <div className="text-center py-16 space-y-4">
                    <BookOpen className="w-12 h-12 mx-auto text-gray-300" />
                    <p className="text-gray-400 text-sm">请在侧栏选择知识库查看内容</p>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>

        {/* 右侧目录 */}
        {rawContent && <WikiRightSidebar renderedHtml={rawContent} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 更新 HomePage.tsx** — 移除 Header import，删除 `<Header variant="home" />`

```tsx
// 删除: import { Header } from '@/components/layout/Header'
// 删除: <Header variant="home" />
// 无其他改动
```

- [ ] **Step 4: 更新 QASharePage.tsx** — 移除 Header import 和用法

- [ ] **Step 5: 更新 SettingsPage.tsx** — 移除 Header import 和用法

- [ ] **Step 6: 验证** `npm run dev` 确认全页面无编译错误

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/layout/Header.tsx frontend/src/components/layout/Header.test.tsx frontend/src/pages/WikiGlobalPage.tsx frontend/src/pages/HomePage.tsx frontend/src/pages/QASharePage.tsx frontend/src/pages/SettingsPage.tsx
git commit -m "refactor: remove Header, update WikiGlobalPage for new sidebar

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 重建 WikiPage（去除 Header + LeftSidebar，接入新侧栏）

**Files:**
- Modify: `frontend/src/pages/WikiPage.tsx`
- Remove: `frontend/src/components/layout/LeftSidebar.tsx`

**Interfaces:**
- Consumes: useParams (repo), useLocation (hash)
- Consumes: fetchWikiPage, fetchWikiModules from @/api/client
- Consumes: BottomInput, WikiRightSidebar, TopicRightSidebar (for now — will merge in Phase 3)

- [ ] **Step 1: 删除 LeftSidebar**

```bash
rm frontend/src/components/layout/LeftSidebar.tsx
```

- [ ] **Step 2: 重写 WikiPage.tsx**

```tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { BottomInput } from '@/components/layout/BottomInput'
import { WikiRightSidebar } from '@/components/layout/WikiRightSidebar'
import { TopicRightSidebar } from '@/components/layout/TopicRightSidebar'
import { fetchWikiPage, fetchWikiModules } from '@/api/client'
import type { WikiPageResponse } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Hash, BookOpen, Loader2 } from 'lucide-react'

export function WikiPage() {
  const { repo } = useParams<{ repo: string }>()
  const location = useLocation()
  const [rawContent, setRawContent] = useState('')
  const [pageType, setPageType] = useState<'wiki' | 'topic'>('wiki')
  const [currentSlug, setCurrentSlug] = useState('')
  const [wikiData, setWikiData] = useState<WikiPageResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const articleRef = useRef<HTMLDivElement>(null)

  const extractH1 = (content: string): string => {
    const match = content.match(/^#\s+(.+)$/m)
    return match ? match[1].trim() : ''
  }
  const pageTitle = extractH1(rawContent) || currentSlug

  const currentHash = location.hash.replace('#', '')

  const loadContent = useCallback(async (slug: string, initial = false) => {
    if (!slug) return
    if (!initial) {
      setLoading(true)
      setCurrentSlug(slug)
    }
    try {
      const data = await fetchWikiPage(slug)
      setWikiData(data)
      setRawContent(data.content)
      setPageType(data.type as 'wiki' | 'topic')
      if (initial) setCurrentSlug(slug)
    } catch {
      setWikiData(null)
      setRawContent('')
      setPageType('wiki')
      if (initial) setCurrentSlug('')
    } finally {
      if (!initial) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (currentHash) {
      loadContent(currentHash)
      return
    }
    fetchWikiModules().then(modules => {
      const first = modules.find((m: any) => m.type === 'source') || modules[0]
      if (first) loadContent(first.slug, true)
      else loadContent('overview', true)
    }).catch(() => loadContent('overview', true))
  }, [currentHash, loadContent])

  const extractText = (children: any): string => {
    if (typeof children === 'string') return children
    if (Array.isArray(children)) return children.map(c => extractText(c)).join('')
    if (children?.props?.children) return extractText(children.props.children)
    return ''
  }

  // Mermaid
  useEffect(() => {
    if (!articleRef.current) return
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
  }, [rawContent])

  const isAsciiArt = (text: string) => /[┌└│├─┐┘┴┬┤╰╮╭╯]/.test(text)

  const handleNavigate = (slug: string) => { window.location.hash = slug }

  return (
    <div className="h-full flex flex-col bg-[#F8FAFC]">
      <div className="flex-1 flex overflow-hidden">
        {/* 主内容区 — 侧栏已包含文档树 */}
        <div className="flex-1 flex flex-col relative bg-[#FBFBFC]">
          <main className="flex-1 overflow-y-auto no-scrollbar">
            <div className="flex justify-center py-8 px-6">
              <div className="w-full max-w-4xl transition-all">
                {!currentHash && !currentSlug && (
                  <div className="text-center py-16 space-y-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-cyber-blue/10 to-cyber-blue/5 rounded-2xl flex items-center justify-center mx-auto">
                      <BookOpen className="w-8 h-8 text-cyber-blue" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-800">{repo} 知识库</h2>
                    <p className="text-sm text-gray-400">从左侧选择文档开始阅读</p>
                  </div>
                )}
                {rawContent ? (
                  <div>
                    {pageType === 'topic' && (
                      /* Topic banner */
                      <div className="flex items-center gap-3 mb-6 px-4 py-3 bg-gradient-to-r from-indigo-50 to-white rounded-xl border border-indigo-100">
                        <span className="text-[10px] font-mono bg-cyber-blue text-white px-2.5 py-1 rounded-md font-bold flex items-center gap-1">
                          <Hash className="w-3 h-3" />TOPIC
                        </span>
                        <span className="text-xs text-gray-500">
                          {wikiData?.qa_entries?.length || 0} 个 QA 条目 · {wikiData?.wiki_links?.length || 0} 个关联文档
                        </span>
                      </div>
                    )}
                    {pageType === 'wiki' && pageTitle && (
                      <h1 className="text-2xl font-bold text-gray-900 mb-6 pb-3 border-b border-gray-200">{pageTitle}</h1>
                    )}
                    <article ref={articleRef}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => { const id = extractText(children).toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return <h1 id={id} className="text-3xl font-bold border-b border-gray-200 pb-3 mb-6">{children}</h1> },
                          h2: ({ children }) => { const id = extractText(children).toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return <h2 id={id} className="text-2xl font-semibold mt-12 mb-4">{children}</h2> },
                          h3: ({ children }) => { const id = extractText(children).toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return <h3 id={id} className="text-lg font-semibold mt-8 mb-3">{children}</h3> },
                          h4: ({ children }) => <h4 className="font-semibold mt-6 mb-2">{children}</h4>,
                          a: ({ href, children }) => <a href={href} className="text-cyber-blue no-underline hover:underline">{children}</a>,
                          img: ({ src, alt }) => <img src={src} alt={alt} className="rounded-xl my-4" />,
                          blockquote: ({ children }) => <blockquote className="border-l-4 border-gray-300 pl-5 py-1 text-gray-600 my-6">{children}</blockquote>,
                          table: ({ children }) => <table className="w-full my-6">{children}</table>,
                          th: ({ children }) => <th className="border bg-gray-50 px-3 py-2 text-sm font-semibold">{children}</th>,
                          td: ({ children }) => <td className="border px-3 py-2 text-sm">{children}</td>,
                          ul: ({ children }) => <ul className="my-4 list-disc pl-6">{children}</ul>,
                          ol: ({ children }) => <ol className="my-4 list-decimal pl-6">{children}</ol>,
                          li: ({ children }) => <li className="my-1">{children}</li>,
                          hr: () => <hr className="my-8 border-gray-200" />,
                          p: ({ children }) => {
                            const text = extractText(children)
                            if (isAsciiArt(text)) {
                              return <pre className="bg-[#1e293b] text-[#e2e8f0] rounded-lg p-4 overflow-x-auto text-xs font-mono my-6">{text}</pre>
                            }
                            return <p className="my-4 leading-7 text-gray-800">{children}</p>
                          },
                          code: ({ className, children }) => {
                            const match = /language-(\w+)/.exec(className || '')
                            const isInline = !className && !String(children).includes('\n')
                            if (isInline) {
                              return <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
                            }
                            const lang = match ? match[1] : 'text'
                            if (lang === 'mermaid') {
                              return <pre className="bg-gray-50 rounded-lg p-4 my-4 text-center text-gray-400 text-sm">mermaid</pre>
                            }
                            return (
                              <SyntaxHighlighter style={vscDarkPlus} language={lang} PreTag="div" customStyle={{
                                margin: '1.5rem 0', padding: '16px', borderRadius: '8px',
                                fontSize: '13px', lineHeight: '1.6',
                              }}>
                                {String(children).replace(/\n$/, '')}
                              </SyntaxHighlighter>
                            )
                          },
                          pre: ({ children }) => <>{children}</>,
                        }}
                      >
                        {rawContent}
                      </ReactMarkdown>
                    </article>
                  </div>
                ) : loading ? (
                  <div className="text-center text-gray-400 py-20">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                    <span>加载中...</span>
                  </div>
                ) : currentSlug ? (
                  <div className="text-center text-gray-400 py-20">页面不存在</div>
                ) : null}
              </div>
            </div>
          </main>
          <BottomInput visible placeholder="对当前文档提问..." contextTag={currentSlug} />
        </div>
        {pageType === 'topic'
          ? <TopicRightSidebar qaEntries={wikiData?.qa_entries || []} wikiLinks={wikiData?.wiki_links || []} />
          : <WikiRightSidebar renderedHtml={rawContent} />
        }
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 验证** `npm run dev`，确认 `/:repo` 路由页面无编译错误、文档加载正常

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/WikiPage.tsx frontend/src/components/layout/LeftSidebar.tsx
git commit -m "refactor: rewrite WikiPage without Header and LeftSidebar, add topic banner

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: CodeBlock 组件

**Files:**
- Create: `frontend/src/components/content/CodeBlock.tsx`

**Interfaces:**
- Produces: `CodeBlock` component
- Props: `{ children: string; language?: string; filename?: string; source?: string; explanation?: string }`

- [ ] **Step 1: 创建 CodeBlock.tsx**

```tsx
import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check, ExternalLink } from 'lucide-react'

interface CodeBlockProps {
  children: string
  language?: string
  filename?: string
  source?: string
  explanation?: string
}

export function CodeBlock({ children, language = 'text', filename, source, explanation }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-6 rounded-xl overflow-hidden border border-code-bg/20 shadow-sm">
      {/* File header bar */}
      {(filename || language) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-300 text-xs font-mono">
          {filename && <span className="font-semibold text-slate-200">{filename}</span>}
          {language && (
            <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">{language}</span>
          )}
          <button onClick={handleCopy} className="ml-auto p-1 hover:bg-slate-700 rounded transition" title="复制">
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* Code area */}
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
        customStyle={{ margin: 0, padding: '16px', borderRadius: filename ? '0' : '8px', fontSize: '13px', lineHeight: '1.6' }}
      >
        {children}
      </SyntaxHighlighter>

      {/* Source trace line */}
      {source && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-900 text-[11px] text-slate-400 font-mono border-t border-slate-800">
          <ExternalLink className="w-3 h-3" />
          <span>{source}</span>
        </div>
      )}

      {/* AI explanation line */}
      {explanation && (
        <div className="px-4 py-1.5 bg-slate-900 text-[11px] text-slate-500 border-t border-slate-800 italic">
          💡 {explanation}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 在 WikiPage 和 WikiGlobalPage 中接入 CodeBlock**

在 WikiPage.tsx 的 `code` renderer 中，检测是否前面有 `<code-meta>` 标签（用 ReactMarkdown 的 children 自行处理）。先简单集成 — 当 code block 没有 inline 时使用 CodeBlock：

```tsx
// 在 WikiPage.tsx 中导入
import { CodeBlock } from '@/components/content/CodeBlock'

// 在 code renderer 中替换
code: ({ className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '')
  const isInline = !className && !String(children).includes('\n')
  if (isInline) {
    return <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>{children}</code>
  }
  const lang = match ? match[1] : 'text'
  if (lang === 'mermaid') {
    return <pre className="bg-gray-50 rounded-lg p-4 my-4 text-center text-gray-400 text-sm">mermaid</pre>
  }
  return (
    <CodeBlock language={lang}>
      {String(children).replace(/\n$/, '')}
    </CodeBlock>
  )
},
```

- [ ] **Step 3: 验证** `npm run dev`，打开 Wiki 页面查看代码块渲染效果

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/content/CodeBlock.tsx frontend/src/pages/WikiPage.tsx frontend/src/pages/WikiGlobalPage.tsx
git commit -m "feat: add CodeBlock component with file header and source trace

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: ContextToolbar 组件

**Files:**
- Create: `frontend/src/components/layout/ContextToolbar.tsx`

**Interfaces:**
- Produces: `ContextToolbar` component
- Props: `{ actions: ActionItem[]; className?: string }`
- `ActionItem = { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }`

- [ ] **Step 1: 创建 ContextToolbar**

```tsx
interface ActionItem {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
}

interface ContextToolbarProps {
  actions: ActionItem[]
  className?: string
}

export function ContextToolbar({ actions, className = '' }: ContextToolbarProps) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {actions.map((action, i) => (
        <div key={i} className="group relative flex items-center">
          <button
            onClick={action.onClick}
            title={action.label}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
              action.active
                ? 'bg-cyber-blue text-white shadow-sm'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
          >
            {action.icon}
          </button>
          <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-[10px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            {action.label}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 在 WikiPage 中接入 ContextToolbar**

```tsx
// 在 WikiPage.tsx 中添加 import
import { ContextToolbar } from '@/components/layout/ContextToolbar'
import { FileText, Hash, Link2, Star, Copy } from 'lucide-react'

// 在 main 元素内、content 上方添加
<div className="flex justify-center py-8 px-6">
  <div className="w-full max-w-4xl transition-all">
    {/* Context Toolbar */}
    <div className="mb-4">
      <ContextToolbar actions={[
        { icon: <FileText className="w-4 h-4" />, label: '文档视图', onClick: () => {}, active: pageType === 'wiki' },
        { icon: <Hash className="w-4 h-4" />, label: 'Topic 视图', onClick: () => {}, active: pageType === 'topic' },
        ...(wikiData?.qa_entries?.length ? [{ icon: <Link2 className="w-4 h-4" />, label: '代码溯源', onClick: () => {} }] : []),
        { icon: <Star className="w-4 h-4" />, label: '收藏', onClick: () => {} },
        { icon: <Copy className="w-4 h-4" />, label: '复制链接', onClick: () => { navigator.clipboard.writeText(window.location.href) } },
      ]} />
    </div>
    {/* ... rest of content ... */}
  </div>
</div>
```

- [ ] **Step 3: 验证** `npm run dev`，确认 toolbar 显示正确，hover 有 tooltip

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/ContextToolbar.tsx frontend/src/pages/WikiPage.tsx
git commit -m "feat: add ContextToolbar with page-local actions

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: ContentRightPanel 合并右边栏

**Files:**
- Create: `frontend/src/components/layout/ContentRightPanel.tsx`
- Modify: `frontend/src/components/layout/WikiRightSidebar.tsx` (保留但标记 deprecated，后续移除)
- Modify: `frontend/src/components/layout/TopicRightSidebar.tsx` (保留但标记 deprecated，后续移除)

**Interfaces:**
- Produces: `ContentRightPanel`
- Props: `{ pageType: 'wiki' | 'topic'; renderedHtml?: string; qaEntries?: QaBrief[]; wikiLinks?: WikiLink[]; sourceRefs?: SourceRef[]; onSourceClick?: (ref: SourceRef) => void }`

- [ ] **Step 1: 创建 ContentRightPanel**

```tsx
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, MessageCircle, Link2, ChevronRight, FolderTree } from 'lucide-react'

interface Heading {
  id: string; text: string; level: number
}

interface QaBrief {
  qid: number; question: string; created_at: string
}

interface WikiLink {
  slug: string; name: string
}

interface SourceRef {
  file: string; line: string; snippet: string
}

interface ContentRightPanelProps {
  pageType?: 'wiki' | 'topic'
  renderedHtml?: string
  qaEntries?: QaBrief[]
  wikiLinks?: WikiLink[]
  sourceRefs?: SourceRef[]
  onSourceClick?: (ref: SourceRef) => void
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export function ContentRightPanel({
  pageType = 'wiki',
  renderedHtml = '',
  qaEntries = [],
  wikiLinks = [],
  sourceRefs = [],
  onSourceClick,
}: ContentRightPanelProps) {
  const navigate = useNavigate()
  const [activeId, setActiveId] = useState('')
  const [expandedSource, setExpandedSource] = useState<string | null>(null)

  // Parse headings from HTML
  const headings = useMemo<Heading[]>(() => {
    const result: Heading[] = []
    const lines = renderedHtml.split('\n')
    for (const line of lines) {
      const match = line.match(/^(#{1,3})\s+(.+)$/)
      if (match) {
        result.push({
          level: match[1].length,
          text: match[2].replace(/<[^>]+>/g, ''),
          id: slugify(match[2].replace(/<[^>]+>/g, '')),
        })
      }
    }
    return result
  }, [renderedHtml])

  // Scroll spy
  useEffect(() => {
    const handleScroll = () => {
      const main = document.querySelector('main')
      const headingElements = headings
        .map(h => document.getElementById(h.id))
        .filter(Boolean) as HTMLElement[]
      let current = ''
      for (const el of headingElements) {
        if (el.getBoundingClientRect().top <= 80) {
          current = el.id
        }
      }
      if (current) setActiveId(current)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [headings])

  const scrollToHeading = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  if (pageType === 'topic' && qaEntries.length === 0 && wikiLinks.length === 0) return null
  if (pageType === 'wiki' && headings.length === 0 && sourceRefs.length === 0) return null

  return (
    <aside className="w-56 border-l border-gray-200/50 bg-white flex-shrink-0 overflow-y-auto no-scrollbar hidden lg:block">
      <div className="p-3 space-y-4 sticky top-0">
        {/* TOC — Wiki only */}
        {pageType === 'wiki' && headings.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <FolderTree className="w-3 h-3" /> 目录
            </div>
            <nav className="space-y-0.5">
              {headings.map(h => (
                <button key={h.id} onClick={() => scrollToHeading(h.id)}
                  style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
                  className={`block w-full text-left py-0.5 pr-2 rounded text-[11px] leading-snug transition border-l-2 ${
                    activeId === h.id
                      ? 'text-cyber-blue font-semibold bg-cyber-blue-light/50 border-cyber-blue'
                      : 'text-gray-500 border-transparent hover:bg-gray-50'
                  }`}>
                  {h.text}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Code trace */}
        {sourceRefs.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Link2 className="w-3 h-3" /> 代码溯源
            </div>
            <div className="space-y-0.5">
              {sourceRefs.map((ref, i) => (
                <div key={i}>
                  <button
                    onClick={() => {
                      setExpandedSource(expandedSource === `${ref.file}:${ref.line}` ? null : `${ref.file}:${ref.line}`)
                      onSourceClick?.(ref)
                    }}
                    className="w-full text-left px-2 py-1 rounded text-[10px] font-mono hover:bg-gray-50 transition text-gray-600 flex items-center gap-1"
                  >
                    <ChevronRight className={`w-2.5 h-2.5 shrink-0 transition-transform ${expandedSource === `${ref.file}:${ref.line}` ? 'rotate-90' : ''}`} />
                    <span className="text-cyber-blue">{ref.file}</span>
                    <span className="text-gray-400">{ref.line}</span>
                  </button>
                  {expandedSource === `${ref.file}:${ref.line}` && (
                    <pre className="mx-2 my-1 p-2 bg-slate-900 text-slate-300 text-[10px] font-mono rounded overflow-x-auto max-h-32">
                      {ref.snippet}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Topic stats */}
        {pageType === 'topic' && (qaEntries.length > 0 || wikiLinks.length > 0) && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              📊 Topic 统计
            </div>
            <div className="text-[11px] text-gray-500 space-y-1 px-1">
              {qaEntries.length > 0 && <div>{qaEntries.length} 个 QA 条目</div>}
              {wikiLinks.length > 0 && <div>{wikiLinks.length} 个关联文档</div>}
            </div>
          </div>
        )}

        {/* Related QA */}
        {qaEntries.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <MessageCircle className="w-3 h-3 text-amber-500" /> 关联 QA
            </div>
            <div className="space-y-0.5">
              {qaEntries.map(qa => (
                <button key={qa.qid}
                  onClick={() => navigate(`/qa?qid=${qa.qid}`)}
                  className="w-full text-left px-2 py-1 rounded text-[11px] hover:bg-gray-50 transition text-gray-600 truncate">
                  <span className="text-cyber-blue font-mono text-[10px] mr-1">Q{qa.qid}</span>
                  {qa.question.slice(0, 30)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Related wiki */}
        {wikiLinks.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <FileText className="w-3 h-3 text-cyber-blue" /> 关联页面
            </div>
            <div className="space-y-0.5">
              {wikiLinks.map(link => (
                <button key={link.slug}
                  onClick={() => { window.location.hash = link.slug }}
                  className="w-full text-left px-2 py-1 rounded text-[11px] hover:bg-gray-50 transition text-gray-600 truncate">
                  {link.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Placeholder sections for wiki pages */}
        {pageType === 'wiki' && (
          <>
            {/* Related Topics placeholder */}
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">🏷️ 关联 Topic</div>
              <div className="text-[10px] text-gray-300 px-2">暂无关联 Topic</div>
            </div>
            {/* Related Docs placeholder */}
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">📖 相关文档</div>
              <div className="text-[10px] text-gray-300 px-2">暂无相关文档</div>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: 在 WikiPage 中替换 WikiRightSidebar/TopicRightSidebar 为 ContentRightPanel**

```tsx
// 替换:
// {pageType === 'topic'
//   ? <TopicRightSidebar ... />
//   : <WikiRightSidebar renderedHtml={rawContent} />
// }

// 为:
<ContentRightPanel
  pageType={pageType}
  renderedHtml={rawContent}
  qaEntries={wikiData?.qa_entries}
  wikiLinks={wikiData?.wiki_links}
/>
```

- [ ] **Step 3: 验证** `npm run dev`，确认 TOC 滚动高亮、topic 关联内容显示

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/ContentRightPanel.tsx frontend/src/pages/WikiPage.tsx
git commit -m "feat: add ContentRightPanel merging wiki and topic sidebars

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: QA 页面改造 — 操作栏 + Topic 升级 + 代码溯源

**Files:**
- Create: `frontend/src/components/qa/AnswerActions.tsx`
- Create: `frontend/src/components/qa/CodeTraceCard.tsx`
- Modify: `frontend/src/pages/QAPage.tsx`

**Interfaces:**
- AnswerActions props: `{ accepted: boolean; onAccept: () => void; onReject: () => void; onCopy: () => void; onShare: () => void; rootQid?: number }`
- CodeTraceCard props: `{ sourceRefs: {file: string; line: string; snippet: string}[] }`

- [ ] **Step 1: 创建 CodeTraceCard.tsx**

```tsx
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

interface SourceRef {
  file: string
  line: string
  snippet: string
}

interface CodeTraceCardProps {
  sourceRefs: SourceRef[]
}

export function CodeTraceCard({ sourceRefs }: CodeTraceCardProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!sourceRefs.length) return null

  return (
    <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
        🔗 代码溯源 ({sourceRefs.length})
      </div>
      <div className="divide-y divide-slate-100">
        {sourceRefs.map((ref, i) => {
          const key = `${ref.file}:${ref.line}`
          const isExpanded = expanded.has(key)
          return (
            <div key={i}>
              <button
                onClick={() => toggle(key)}
                className="w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-slate-50 transition flex items-center gap-1.5"
              >
                <ChevronRight className={`w-2.5 h-2.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                <span className="text-cyber-blue font-semibold">{ref.file}</span>
                <span className="text-slate-400">:{ref.line}</span>
              </button>
              {isExpanded && (
                <pre className="mx-3 mb-2 p-2 bg-code-bg text-code-text text-[10px] font-mono rounded overflow-x-auto max-h-24">
                  {ref.snippet}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 AnswerActions.tsx**

```tsx
import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Copy, Share2, Check } from 'lucide-react'

interface AnswerActionsProps {
  onAccept: () => void
  onReject: () => void
  onCopy: () => void
  onShare: () => void
  accepted: boolean
  rejected: boolean
  rootQid?: number
  onPromoteTopic?: (title: string) => void
}

export function AnswerActions({
  onAccept, onReject, onCopy, onShare,
  accepted, rejected, rootQid, onPromoteTopic,
}: AnswerActionsProps) {
  const [showPromote, setShowPromote] = useState(false)
  const [topicTitle, setTopicTitle] = useState('')

  const handleAccept = () => {
    onAccept()
    setShowPromote(true)
  }

  const handlePromote = () => {
    const title = topicTitle.trim()
    if (title && onPromoteTopic) {
      onPromoteTopic(title)
      setShowPromote(false)
      setTopicTitle('')
    }
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      {/* Action bar — always visible */}
      <div className="flex items-center gap-1 text-gray-400 select-none">
        <button
          className={`p-1.5 rounded-lg transition ${
            accepted ? 'bg-emerald-50 text-emerald-500' : 'hover:bg-gray-100 hover:text-emerald-500'
          }`}
          onClick={handleAccept}
          disabled={accepted || rejected}
          title="采纳"
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          className={`p-1.5 rounded-lg transition ${
            rejected ? 'bg-red-50 text-red-500' : 'hover:bg-gray-100 hover:text-red-500'
          }`}
          onClick={onReject}
          disabled={accepted || rejected}
          title="待验证"
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
        <button className="p-1.5 hover:bg-gray-100 rounded-lg hover:text-gray-700 transition" onClick={onCopy} title="复制">
          <Copy className="w-3.5 h-3.5" />
        </button>
        {rootQid && (
          <button className="p-1.5 hover:bg-gray-100 rounded-lg hover:text-cyber-blue transition" onClick={onShare} title="复制分享链接">
            <Share2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Accepted feedback */}
      {accepted && (
        <span className="text-[10px] font-medium text-emerald-500 flex items-center gap-1 mt-1">
          <Check className="w-3 h-3" /> 已采纳
        </span>
      )}

      {/* Topic promotion — only after accept */}
      {showPromote && onPromoteTopic && (
        <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
          <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-2">
            升级为 Topic
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={topicTitle}
              onChange={e => setTopicTitle(e.target.value)}
              placeholder="输入 Topic 标题..."
              className="flex-1 px-2.5 py-1.5 text-xs border border-indigo-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300"
            />
            <button
              onClick={handlePromote}
              disabled={!topicTitle.trim()}
              className="px-3 py-1.5 text-[10px] font-bold bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-40 transition shrink-0"
            >
              确认
            </button>
            <button
              onClick={() => setShowPromote(false)}
              className="px-3 py-1.5 text-[10px] font-medium text-indigo-400 hover:text-indigo-600 transition shrink-0"
            >
              暂缓
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 在 QAPage 中接入新组件**

- 用户消息从 `<h2>` 改为用户气泡样式
- 接入 `AnswerActions` 替代当前的内联操作按钮
- 接入 `CodeTraceCard` 在最底部 assistant 消息之后
- 移除 `setDrawerContent` 调用

```tsx
// 添加 imports
import { AnswerActions } from '@/components/qa/AnswerActions'
import { CodeTraceCard } from '@/components/qa/CodeTraceCard'

// 在 assistant 消息渲染中，操作栏替换为:
<div className="answer-block prose prose-sm max-w-none">
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
  <AnswerActions
    accepted={activeSession.feedback === 'accepted'}
    rejected={activeSession.feedback === 'rejected'}
    onAccept={() => handleFeedback(activeSession!.sessionId, i, 'accepted')}
    onReject={() => handleFeedback(activeSession!.sessionId, i, 'rejected')}
    onCopy={() => navigator.clipboard.writeText(m.content)}
    onShare={() => {
      const url = `${window.location.origin}/qa/q/${activeRootQid}`
      navigator.clipboard.writeText(url)
    }}
    rootQid={activeRootQid ?? undefined}
    onPromoteTopic={(title) => {
      // UI placeholder — backend API TBD
      console.log('Promote to topic:', title, activeRootQid)
    }}
  />
</div>

// 用户消息样式从 h2 改为:
<div className="flex justify-end mb-4">
  <div className="bg-cyber-blue text-white px-4 py-2 rounded-2xl rounded-br-md max-w-[80%]">
    <p className="text-sm font-medium">{m.content}</p>
  </div>
</div>

// 在最后一条 assistant 消息的 AnswerActions 后添加:
{sourceRefs.length > 0 && <CodeTraceCard sourceRefs={sourceRefs} />}

// 删除:
// useEffect(() => { setDrawerContent({...}) }, [sessionList, activeSessionId])
```

- [ ] **Step 4: 验证** `npm run dev`，QA 页面测试提问、回答渲染、操作栏、topic 升级卡、代码溯源卡

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/qa/AnswerActions.tsx frontend/src/components/qa/CodeTraceCard.tsx frontend/src/pages/QAPage.tsx
git commit -m "feat: QA page action bar, topic promotion, code trace cards

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: HomePage 知识库卡片改版

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: fetchRepos, fetchQaEntries, fetchTopics from @/api/client
- Produces: Updated HomePage with 知识库 branding and KB stat cards

- [ ] **Step 1: 更新 HomePage.tsx**

主要改动:
1. "代码库" → "知识库"
2. Hero 副标题更新
3. Repo 卡片加 QA/Topic/Wiki 计数

```tsx
// Repo 卡片改为:
<button key={r.name} onClick={() => navigate(`/${r.name}`)}
  className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-cyber-blue/30 hover:shadow-sm transition group">
  <div className="flex items-center justify-between mb-2">
    <span className="font-mono text-sm font-bold text-gray-800 group-hover:text-cyber-blue transition">
      {r.name}
    </span>
    <span className="flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      <span className="text-[10px] text-emerald-600 font-medium">在线</span>
    </span>
  </div>
  <span className="text-[10px] text-gray-400 font-mono block truncate mb-2">{r.path}</span>
  <div className="text-[10px] text-gray-500 flex items-center gap-3">
    <span className="text-cyan-500 font-semibold">0 次问答</span>
    <span className="text-violet-500 font-semibold">0 个 Topic</span>
    <span className="text-blue-500 font-semibold">0 篇 Wiki</span>
  </div>
</button>

// Hero 副标题:
<p className="text-gray-400 text-sm max-w-xl mx-auto">
  围绕知识库提问，Agent 基于源码回答，高质量答案自动沉淀为 Wiki
</p>

// Section header:
<h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
  <GitFork className="w-4 h-4" /> 知识库
</h2>
```

- [ ] **Step 2: 验证** `npm run dev`，检查首页视觉

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/HomePage.tsx
git commit -m "feat: update HomePage with KB branding and stat cards

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: SettingsModal 完整实现

**Files:**
- Create: `frontend/src/components/settings/SettingsModal.tsx`

**Interfaces:**
- Produces: `SettingsModal` component
- Props: `{ open: boolean; onClose: () => void }`

- [ ] **Step 1: 创建 SettingsModal.tsx**

```tsx
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
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (open) {
      fetchSettings().then(setSettings).catch(() => {})
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
                  <input type="text" defaultValue={settings?.general?.site_name || 'OpenCodeWiki'}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyber-blue/20 focus:border-cyber-blue" />
                </div>
                <button
                  onClick={() => handleSave('general', { site_name: 'OpenCodeWiki' })}
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
```

- [ ] **Step 2: 更新 AppSidebar 的 SettingsModal 引用** — 替换 placeholder modal 为真正的 SettingsModal

在 AppSidebar.tsx 中:
```tsx
import { SettingsModal } from '@/components/settings/SettingsModal'
// ... 替换 placeholder div 为:
<SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

- [ ] **Step 3: 验证** `npm run dev`，点击侧栏 ⚙ 图标弹出设置 modal

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/settings/SettingsModal.tsx frontend/src/components/layout/AppSidebar.tsx
git commit -m "feat: implement SettingsModal with tabbed layout

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: 收尾 — 更新测试 + 清理 + useSessionHistory 兼容

**Files:**
- Modify: `frontend/src/pages/HomePage.test.tsx`
- Modify: `frontend/src/pages/QAPage.test.tsx`
- Modify: `frontend/src/pages/WikiPage.tsx` (确保无未使用 import)
- Modify: `frontend/src/hooks/useSessionHistory.ts` (setDrawerContent 已从 LayoutContext 移除)
- Remove: `frontend/src/components/layout/WikiRightSidebar.tsx` (已被 ContentRightPanel 替代)
- Remove: `frontend/src/components/layout/TopicRightSidebar.tsx` (已被 ContentRightPanel 替代)

- [ ] **Step 0: 修复 useSessionHistory.ts — 移除 setDrawerContent 依赖**

该 hook 仍被 AdminPage / SettingsPage / SourcesPage 使用（本期不改这些页面）。`setDrawerContent` 已从 LayoutContext 移除。

将 hook 改为不再注入 drawer，而是直接返回 session 数据供调用方自行渲染：

```tsx
import { useState, useEffect, useCallback } from 'react'

export function useSessionHistory() {
  const [sessionList, setSessionList] = useState<any[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')

  const fetchSessionList = useCallback(() => {
    fetch('/api/sessions').then(r => r.json()).then(d => {
      if (d.ok) setSessionList(d.data.sessions || [])
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchSessionList() }, [fetchSessionList])

  return { sessionList, activeSessionId, setActiveSessionId, fetchSessionList }
}
```

调用方（AdminPage / SettingsPage / SourcesPage）按需自行使用返回的 sessionList，不再通过 LayoutContext 注入。

- [ ] **Step 1: 更新 HomePage.test.tsx**

删除 Header 相关断言，更新 "代码库" → "知识库" 文本

- [ ] **Step 2: 更新 QAPage.test.tsx**

删除 drawerContent 相关断言，更新操作栏测试

- [ ] **Step 3: 删除废弃的 WikiRightSidebar 和 TopicRightSidebar**

```bash
rm frontend/src/components/layout/WikiRightSidebar.tsx frontend/src/components/layout/TopicRightSidebar.tsx
```

- [ ] **Step 4: 清理未使用 import** — grep 检查

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: 运行全量测试**

```bash
cd frontend && npm test
```

- [ ] **Step 6: 验证全流程**

```bash
npm run dev
# 手动检查:
# 1. 首页 — 知识库卡片
# 2. Wiki 页面 — 侧栏文档树 + 内容 + 右边栏
# 3. QA 页面 — session + 操作栏 + topic 升级 + 代码溯源
# 4. 设置弹窗
# 5. 侧栏深色 + KB 下拉
# 6. Header 不再出现
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/HomePage.test.tsx frontend/src/pages/QAPage.test.tsx frontend/src/components/layout/WikiRightSidebar.tsx frontend/src/components/layout/TopicRightSidebar.tsx
git commit -m "chore: cleanup tests, remove deprecated sidebars, verify full flow

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 验证清单

Phase 1 完成后:
- [ ] `npm run dev` 无编译错误
- [ ] 侧栏深色渲染（slate-900 背景）
- [ ] 收起态 56px icon strip
- [ ] 展开态 240px 完整面板
- [ ] KB 下拉显示，切换更新 URL
- [ ] 文档树折叠/展开正常
- [ ] Header 不再出现在任何页面

Phase 2 完成后:
- [ ] CodeBlock 组件渲染文件头 + 代码高亮
- [ ] Topic banner 在 topic 页面显示
- [ ] ContextToolbar 图标 hover 显示 tooltip

Phase 3 完成后:
- [ ] ContentRightPanel TOC 滚动高亮
- [ ] QA 页操作栏始终可见
- [ ] 👍 后 Topic 升级卡片出现
- [ ] 代码溯源 Card 展开 snippet

Phase 4 完成后:
- [ ] SettingsModal 弹出/关闭/保存
- [ ] 首页显示"知识库"标题 + 统计卡片
- [ ] `npm test` 全绿
