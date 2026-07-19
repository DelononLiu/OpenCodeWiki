# QA 页面 UI 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 QAPage.tsx 从单栏手风琴列表改为三栏聊天布局

**Architecture:** 单一组件 QAPage.tsx 内部拆分三栏 JSX 区域。数据模型 `sessions: Record<string, Session>`，每个 session 独立消息数组 + 流状态。左右栏可折叠。纯前端，后端不改。

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + shadcn/ui + lucide-react

## Global Constraints

- 先做 UI，不做后端接口改动
- 左栏/右栏静态占位文案，后续对接 API
- Tailwind config 补 `cyber-orange: '#F59E0B'` 和 `cyber-red: '#EF4444'`
- 状态标签文字："回答已采纳" / "待验证"

---

## 数据结构

```typescript
// 消息
interface Message {
  role: 'user' | 'assistant'
  content: string
}

// 每个会话
interface Session {
  sessionId: string
  question: string            // 首问题，用作中栏顶栏标题
  messages: Message[]          // 完整消息时间线
  streamingAnswer: string      // SSE 流式累积内容
  isStreaming: boolean         // 是否正在流式回答
  feedback?: 'accepted' | 'rejected' | null
}

// 组件内状态
sessions: Record<string, Session>   // sessionId → Session
activeSessionId: string | null
input: string                       // 全局底部输入框
leftPanelOpen: boolean
rightPanelOpen: boolean
loading: boolean
```

### Task 1: tailwind.config.ts — 补充色值

**Files:**
- Modify: `frontend/tailwind.config.ts`

- [ ] **Step 1: 添加 cyber-orange 和 cyber-red**

```typescript
// 在 cyber 色板内加两行
cyber: {
  blue: '#4F46E5',
  'blue-dark': '#4338CA',
  green: '#10B981',
  orange: '#F59E0B',   // ← 新增
  red: '#EF4444',       // ← 新增
  bg: '#F8F9FA',
  card: '#FFFFFF',
},
```

- [ ] **Step 2: 验证 Vite HMR 未报错**

打开浏览器 DevTools，确认没有 Tailwind 编译错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/tailwind.config.ts
git commit -m "feat: tailwind config 补充 cyber-orange 和 cyber-red

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: QAPage.tsx — 类型定义 + 状态骨架 + 三栏 shell

**Files:**
- Modify: `frontend/src/pages/QAPage.tsx`

**Produces:**
- `Message` interface
- `Session` interface
- All useState declarations
- 三栏 JSX shell（空的占位 div）

- [ ] **Step 1: 清空旧 QAPage，写新的 import 和类型**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { fetchQaEntries } from '@/api/client'
import { useSSE } from '@/hooks/useSSE'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Loader2, Send, Sidebar, PanelRight,
  ThumbsUp, ThumbsDown, Copy, MoreHorizontal,
  Hash, HelpCircle, Clock, Check,
} from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Session {
  sessionId: string
  question: string
  messages: Message[]
  streamingAnswer: string
  isStreaming: boolean
  feedback?: 'accepted' | 'rejected' | null
}

function genSessionId(): string {
  return crypto.randomUUID()
}
```

- [ ] **Step 2: 写组件函数 + 所有 state**

```typescript
export function QAPage() {
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const { stream, abort } = useSSE()
  const [searchParams, setSearchParams] = useSearchParams()
  const autoSubmitDoneRef = useRef(false)
  const streamAbortedRef = useRef(false)

  const activeSession = activeSessionId ? sessions[activeSessionId] : null
```

- [ ] **Step 3: 三栏 shell JSX**

```typescript
  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" />

      <div className="flex-1 flex overflow-hidden w-full px-4 py-3 gap-3">

        {/* Left Panel */}
        <aside
          className="bg-white border border-gray-200/60 rounded-xl flex flex-col shrink-0 shadow-sm overflow-y-auto no-scrollbar transition-all duration-300"
          style={{ width: leftPanelOpen ? '16rem' : '0px', opacity: leftPanelOpen ? 1 : 0, padding: leftPanelOpen ? '1rem' : '0', borderWidth: leftPanelOpen ? '1px' : '0' }}
        >
          {/* placeholder */}
        </aside>

        {/* Center Panel */}
        <main className="flex-1 bg-white border border-gray-200/50 shadow-sm rounded-xl flex flex-col overflow-hidden relative min-w-0">

          {/* Top bar */}
          <div className="p-3 border-b border-gray-100 bg-slate-50/30 flex items-center justify-between shrink-0">
            {/* placeholder */}
          </div>

          {/* Message area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar pb-28">
            {/* placeholder */}
          </div>

          {/* Bottom input */}
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center pointer-events-none p-3 z-10">
            {/* placeholder */}
          </div>
        </main>

        {/* Right Panel */}
        <aside
          className="bg-white border border-gray-200/60 rounded-xl flex flex-col shrink-0 shadow-sm overflow-y-auto no-scrollbar transition-all duration-300"
          style={{ width: rightPanelOpen ? '450px' : '0px', opacity: rightPanelOpen ? 1 : 0, padding: rightPanelOpen ? '1rem' : '0', borderWidth: rightPanelOpen ? '1px' : '0' }}
        >
          {/* placeholder */}
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 验证页面渲染不出错**

```bash
# 浏览器打开 localhost:5180/qa，确认三栏空壳正常显示
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/QAPage.tsx
git commit -m "feat: QAPage 三栏 shell + 类型定义

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: QAPage.tsx — 左栏内容

**Files:**
- Modify: `frontend/src/pages/QAPage.tsx`

**Interfaces:**
- Consumes: `leftPanelOpen` state, `activeSessionId` state
- Produces: placeholder content for 关联主题 / 相关问题 / 历史对话

- [ ] **Step 1: 替换 left panel placeholder**

```typescript
{/* Left Panel */}
<aside
  className="bg-white border border-gray-200/60 rounded-xl flex flex-col shrink-0 shadow-sm overflow-y-auto no-scrollbar transition-all duration-300"
  style={{ width: leftPanelOpen ? '16rem' : '0px', opacity: leftPanelOpen ? 1 : 0, padding: leftPanelOpen ? '1rem' : '0', borderWidth: leftPanelOpen ? '1px' : '0' }}
>
  {leftPanelOpen && (
    <div className="space-y-5 text-xs">
      {/* 关联主题 */}
      <div>
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
          <Hash className="w-3.5 h-3.5 text-cyber-blue" />
          关联主题
        </h3>
        <div className="px-2.5 py-1.5 rounded-lg bg-cyber-blue/5 border border-cyber-blue/20 text-cyber-blue font-mono font-bold text-[11px]">
          #qa-engine
        </div>
      </div>

      {/* 相关问题 */}
      <div className="pt-4 border-t border-gray-200/60">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 px-1 flex items-center gap-1">
          <HelpCircle className="w-3.5 h-3.5 text-cyber-blue" />
          相关问题
        </h3>
        <ul className="space-y-2 text-[11px]">
          <li>
            <button className="w-full text-left p-2 rounded-lg border border-gray-200 bg-slate-50/60 text-gray-600 hover:border-cyber-blue transition flex flex-col gap-1">
              <span className="leading-snug">异步加载后如何做预热保护避免空指针？</span>
              <span className="text-[9px] px-1 py-0.5 rounded bg-cyber-green/10 text-cyber-green self-start font-bold">回答已采纳</span>
            </button>
          </li>
          <li>
            <button className="w-full text-left p-2 rounded-lg border border-gray-200 bg-slate-50/60 text-gray-600 hover:border-cyber-blue transition flex flex-col gap-1">
              <span className="leading-snug">全量本地内存索引会引发 OOM 溢出吗？</span>
              <span className="text-[9px] px-1 py-0.5 rounded bg-cyber-red/10 text-cyber-red self-start font-bold">待验证</span>
            </button>
          </li>
        </ul>
      </div>

      {/* 历史对话 */}
      <div className="pt-4 border-t border-gray-200/60">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          历史对话
        </h3>
        <div className="bg-slate-100 text-gray-900 p-2 rounded-lg font-mono text-[11px] flex justify-between items-center">
          <span className="truncate">LSH冷启动300ms停顿</span>
        </div>
      </div>
    </div>
  )}
</aside>
```

- [ ] **Step 2: 浏览器验证左栏正常显示**

确认三个区块（关联主题、相关问题、历史对话）在左栏中正确渲染。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/QAPage.tsx
git commit -m "feat: QAPage 左栏 — 关联主题 / 相关问题 / 历史对话

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: QAPage.tsx — 中栏聊天区（消息时间线 + 回答块）

**Files:**
- Modify: `frontend/src/pages/QAPage.tsx`

**Interfaces:**
- Consumes: `activeSession`, `sessions` state
- Produces: 中栏顶栏 + 消息时间线 JSX

- [ ] **Step 1: 顶栏 JSX**

```typescript
{/* Top bar */}
<div className="p-3 border-b border-gray-100 bg-slate-50/30 flex items-center justify-between shrink-0">
  <div className="flex items-center gap-2">
    <button
      onClick={() => setLeftPanelOpen(prev => !prev)}
      className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-700 transition"
    >
      <Sidebar className="w-4 h-4" />
    </button>
    {activeSession ? (
      <>
        <span className="w-5 h-5 bg-cyber-blue/10 rounded-full flex items-center justify-center text-cyber-blue font-bold text-xs font-mono">Q</span>
        <h2 className="text-xs font-bold text-gray-900 truncate max-w-md">{activeSession.question}</h2>
      </>
    ) : (
      <span className="text-xs text-gray-400">对代码库提问</span>
    )}
  </div>
  <button
    onClick={() => setRightPanelOpen(prev => !prev)}
    className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-700 transition"
  >
    <PanelRight className="w-4 h-4" />
  </button>
</div>
```

- [ ] **Step 2: 消息时间线 JSX**

```typescript
{/* Message area */}
<div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar pb-28">
  {!activeSession && (
    <div className="text-center text-gray-400 py-20">
      <h2 className="text-lg font-bold text-gray-700 mb-2">对代码库提问</h2>
      <p className="text-sm">我可以帮你理解架构、定位代码或解释工作原理</p>
    </div>
  )}

  {activeSession && (
    <>
      {activeSession.messages.map((m, i) => (
        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          {m.role === 'user' ? (
            <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm bg-cyber-blue text-white">
              {m.content}
            </div>
          ) : (
            <div className="answer-block max-w-[85%] border border-transparent hover:border-slate-100/60 rounded-xl p-2 -mx-2 transition-all duration-200 space-y-4">
              <div className="text-sm text-gray-700 leading-relaxed bg-slate-50/40 border border-gray-200 p-4 rounded-xl">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </div>

              {/* Hover actions */}
              <div className="action-bar flex items-center gap-1 text-gray-400 select-none pl-1 h-6"
                   style={{ opacity: 0, transition: 'opacity 0.15s ease' }}>
                <button className="p-1 hover:bg-slate-100 rounded hover:text-cyber-green transition" title="回答已采纳">
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button className="p-1 hover:bg-slate-100 rounded hover:text-cyber-red transition" title="待验证">
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
                <button
                  className="p-1 hover:bg-slate-100 rounded hover:text-gray-700 transition"
                  onClick={() => navigator.clipboard.writeText(m.content)}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button className="p-1 hover:bg-slate-100 rounded hover:text-gray-700 transition">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Streaming answer (live or background) */}
      {activeSession.isStreaming && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-xl p-4 text-sm bg-white border border-gray-200/50 shadow-sm text-gray-800">
            {activeSession.streamingAnswer ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeSession.streamingAnswer}</ReactMarkdown>
            ) : (
              <div className="flex items-center gap-2 text-gray-400 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Agent 思考中...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )}
</div>
```

- [ ] **Step 3: 添加 hover 样式**

```css
/* 在同目录或全局 CSS 中添加 */
.answer-block:hover .action-bar {
  opacity: 1 !important;
}
```

由于 QAPage.tsx 是组件文件，用 inline style 不够优雅。改为在 `index.css` 或 `QAPage.tsx` 顶部添加：

```typescript
// 在组件外用 <style> 注入（React 可在文件顶部添加）
const answerBlockStyles = `
.answer-block .action-bar { opacity: 0; transition: opacity 0.2s ease; }
.answer-block:hover .action-bar { opacity: 1 !important; }
`
```

或者在 `frontend/src/index.css` 末尾加：

```css
.answer-block .action-bar {
  opacity: 0;
  transition: opacity 0.2s ease;
}
.answer-block:hover .action-bar {
  opacity: 1 !important;
}
```

- [ ] **Step 4: 浏览器验证**

确认用户消息蓝色右对齐、AI 回答块白色左对齐、hover 显示动作栏。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/QAPage.tsx frontend/src/index.css
git commit -m "feat: QAPage 中栏 — 消息时间线 + hover 动作栏

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: QAPage.tsx — 右栏（参考引用 + 关联变更）

**Files:**
- Modify: `frontend/src/pages/QAPage.tsx`

**Interfaces:**
- Consumes: `rightPanelOpen`, `activeSession` state
- Produces: 右栏 JSX（上下堆叠）

- [ ] **Step 1: 替换 right panel placeholder**

```typescript
{/* Right Panel */}
<aside
  className="bg-white border border-gray-200/60 rounded-xl flex flex-col shrink-0 shadow-sm overflow-y-auto no-scrollbar transition-all duration-300"
  style={{ width: rightPanelOpen ? '450px' : '0px', opacity: rightPanelOpen ? 1 : 0, padding: rightPanelOpen ? '1rem' : '0', borderWidth: rightPanelOpen ? '1px' : '0' }}
>
  {rightPanelOpen && (
    <div className="space-y-4">
      {/* 参考引用 */}
      <div>
        <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-2">
          <span>参考引用</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-1">
          <span>docs/02-qa-engine.md</span>
          <span>L14 - L15</span>
        </div>
        <div className="bg-[#1E1E2F] rounded-xl text-[11px] text-slate-300 font-mono p-4">
          <div className="text-white font-medium">
            系统分流引擎在冷启动阶段加载索引时，必须严格采用异步非阻塞I/O
          </div>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="border-t border-gray-100" />

      {/* 关联变更 */}
      <div>
        <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-2">
          <span>关联变更</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-1">
          <span>config/app.yml</span>
          <span>L46</span>
        </div>
        <div className="bg-[#1E1E2F] rounded-xl text-[11px] text-slate-300 font-mono p-4">
          <div className="text-cyber-orange font-medium">
            bootstrap.timeout: 500
          </div>
        </div>
      </div>
    </div>
  )}
</aside>
```

- [ ] **Step 2: 浏览器验证右栏**

确认参考引用和关联变更上下堆叠显示。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/QAPage.tsx
git commit -m "feat: QAPage 右栏 — 参考引用 + 关联变更（上下堆叠）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: QAPage.tsx — 底部输入框 + 核心逻辑（submitQuestion, session 管理, SSE, 反馈, 面板切换）

**Files:**
- Modify: `frontend/src/pages/QAPage.tsx`

**Interfaces:**
- Consumes: All state, hooks
- Produces: `submitQuestion`, `cancelStream`, `handleFeedback`, session 切换逻辑, 底部输入框 JSX

- [ ] **Step 1: 创建新 session 的辅助函数 + cancelStream**

```typescript
const createSession = useCallback((question: string): Session => {
  return {
    sessionId: genSessionId(),
    question,
    messages: [],
    streamingAnswer: '',
    isStreaming: false,
  }
}, [])

const cancelStream = useCallback(() => {
  streamAbortedRef.current = true
  abort()
}, [abort])
```

- [ ] **Step 2: submitQuestion 逻辑（多 session 支持）**

```typescript
const submitQuestion = useCallback(async (question: string, sessionId?: string) => {
  if (!question.trim()) return
  setLoading(true)

  // Determine or create session
  let sid = sessionId || activeSessionId
  let session: Session
  if (sid && sessions[sid]) {
    session = sessions[sid]
  } else {
    session = createSession(question)
    sid = session.sessionId
    setSessions(prev => ({ ...prev, [sid!]: session }))
  }

  // Add user message
  const userMsg: Message = { role: 'user', content: question }
  const updatedMessages = [...session.messages, userMsg]

  setSessions(prev => ({
    ...prev,
    [sid!]: {
      ...prev[sid!],
      messages: updatedMessages,
      isStreaming: true,
      streamingAnswer: '',
    },
  }))
  setActiveSessionId(sid!)

  let collectedAnswer = ''
  streamAbortedRef.current = false

  await stream('/api/qa', { question }, (msg) => {
    if (msg.type === 'token' && msg.content) {
      collectedAnswer += msg.content as string
      setSessions(prev => ({
        ...prev,
        [sid!]: {
          ...prev[sid!],
          streamingAnswer: collectedAnswer,
        },
      }))
    }
  })

  if (streamAbortedRef.current) {
    setSessions(prev => {
      const s = prev[sid!]
      if (!s) return prev
      return { ...prev, [sid!]: { ...s, isStreaming: false } }
    })
    setLoading(false)
    return
  }

  // Stream complete — add assistant message
  const assistantMsg: Message = {
    role: 'assistant',
    content: collectedAnswer || '(未生成回答)',
  }

  setSessions(prev => ({
    ...prev,
    [sid!]: {
      ...prev[sid!],
      messages: [...prev[sid!].messages, assistantMsg],
      streamingAnswer: '',
      isStreaming: false,
    },
  }))

  // Persist to backend
  try {
    await fetch('/api/qa/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        answer: collectedAnswer || '(未生成回答)',
        repo: '',
        session_id: sid,
      }),
    })
  } catch { /* ignore */ }

  setLoading(false)
}, [activeSessionId, sessions, stream, createSession])
```

- [ ] **Step 3: 反馈逻辑**

```typescript
const handleFeedback = useCallback((sessionId: string, msgIndex: number, type: 'accepted' | 'rejected') => {
  setSessions(prev => {
    const s = prev[sessionId]
    if (!s) return prev
    return { ...prev, [sessionId]: { ...s, feedback: type } }
  })
  if (type === 'rejected') {
    setRightPanelOpen(true)
  }
}, [])
```

更新 Task 4 中回答块的 👍 👎 按钮：

```typescript
<button
  className="p-1 hover:bg-slate-100 rounded hover:text-cyber-green transition"
  onClick={() => handleFeedback(activeSession!.sessionId, i, 'accepted')}
>
  <ThumbsUp className="w-3.5 h-3.5" />
</button>
<button
  className="p-1 hover:bg-slate-100 rounded hover:text-cyber-red transition"
  onClick={() => handleFeedback(activeSession!.sessionId, i, 'rejected')}
>
  <ThumbsDown className="w-3.5 h-3.5" />
</button>
```

反馈后隐藏操作按钮、显示状态提示：

```typescript
{/* Inside answer-block, after actions */}
{activeSession.feedback === 'accepted' && (
  <span className="text-[10px] font-medium text-cyber-green flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/50">
    <Check className="w-3 h-3" /> 已收集反馈，谢谢您帮助提升质量
  </span>
)}
```

- [ ] **Step 4: 底部输入框 JSX**

```typescript
{/* Bottom input */}
<div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center pointer-events-none p-3 z-10">
  <div className="w-full bg-white border border-gray-200 rounded-xl shadow-md p-2 flex items-center gap-2 pointer-events-auto">
    <input
      type="text"
      value={input}
      onChange={e => setInput(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && !loading) {
          submitQuestion(input)
          setInput('')
        }
      }}
      className="w-full bg-transparent border-none text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-0 py-1 px-2"
      placeholder="在此继续追问..."
      disabled={loading}
    />
    <Button
      size="sm"
      className="bg-cyber-blue text-white rounded-lg px-4 py-1.5 text-xs font-semibold shrink-0"
      onClick={() => {
        submitQuestion(input)
        setInput('')
      }}
      disabled={loading || !input.trim()}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '发送'}
    </Button>
  </div>
</div>
```

- [ ] **Step 5: 首页 ?q= 自动提交**

```typescript
useEffect(() => {
  if (autoSubmitDoneRef.current) return
  const q = searchParams.get('q')
  if (q) {
    autoSubmitDoneRef.current = true
    const clean = new URLSearchParams(searchParams)
    clean.delete('q')
    setSearchParams(clean, { replace: true })
    submitQuestion(q)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

- [ ] **Step 6: 浏览器完整流程测试**

1. 首页输入问题 → 跳转到 `/qa?q=...` → 自动创建 session 并开始 SSE 回答
2. 停留在 QA 页，底部输入框追问 → 同 session 追加消息
3. 切换左右栏折叠 → 面板显隐动画正常
4. hover 回答块 → 动作栏显示 → 点击 👍 → 显示反馈已收集
5. 点击 👎 → 右栏展开，显示关联变更

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/QAPage.tsx
git commit -m "feat: QAPage 核心逻辑 — submitQuestion + session 管理 + SSE + 反馈 + 底部输入

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: index.css — answer-block hover 样式

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: 在 index.css 末尾追加**

```css
/* QA 回答块 hover 显操作栏 */
.answer-block .action-bar {
  opacity: 0;
  transition: opacity 0.2s ease;
}
.answer-block:hover .action-bar {
  opacity: 1;
}
```

- [ ] **Step 2: 浏览器验证 hover 效果**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "style: QA 回答块 hover 显操作栏

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 文件变更汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/tailwind.config.ts` | 修改 | +2 色值 |
| `frontend/src/pages/QAPage.tsx` | 重写 | 单栏手风琴 → 三栏聊天 |
| `frontend/src/index.css` | 追加 | answer-block hover 样式 |
