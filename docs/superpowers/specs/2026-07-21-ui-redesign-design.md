# OpenCodeWiki UI 重构设计文档

**日期:** 2026-07-21
**状态:** 已确认（经 grilling 审查）

---

## 1. 概述

### 1.1 目标

重构 OpenCodeWiki 前端 UI，建立独特的"代码知识平台"品牌视觉，区别于 WeKnora 等通用文档知识库产品。

### 1.2 核心原则

- **不改变布局结构** — 保持 sidebar + main + optional right panel 三栏
- **强化差异化** — 代码溯源的视觉呈现、QA→Topic→Wiki 自进化链路的 UX
- **渐进改造** — 靠 Tailwind 配置扩展和组件替换，不涉及路由和数据结构改动
- **仅桌面 Web** — 不做移动端适配

### 1.3 与 WeKnora 的核心差异

| | WeKnora | OpenCodeWiki |
|---|---|---|
| 核心 | 文档 RAG 引擎（文档进去，答案出来） | 问答驱动知识进化（问答进去，知识长出来） |
| 主色 | 绿色系（TDesign 默认） | 蓝色系（#4F46E5 indigo） |
| 侧栏 | 浅色全宽 | 深色 VS Code 式 |
| 差异化功能 | 多数据源/IM 集成/Agent | 代码溯源/QA→Topic→Wiki 闭环 |

---

## 2. 颜色系统

### 2.1 语义色板

```
主色              #4F46E5 indigo-600   品牌色、链接、按钮、选中态
主色 hover        #4338CA indigo-700   按钮悬停
主色浅底          #EEF2FF indigo-50    hover/focus 背景

侧栏背景          #1E293B slate-900
侧栏文字          #94A3B8 slate-400
侧栏激活          白字 + 主色左侧竖条

内容区背景        #F8FAFC slate-50
卡片背景          #FFFFFF
卡片边框          #E2E8F0 slate-200

正文              #1E293B slate-800
次级文字          #64748B slate-500
辅助文字          #94A3B8 slate-400

代码块背景        #0F172A slate-950    深色代码区
代码块文字        #E2E8F0 slate-200
```

### 2.2 功能色

```
成功/在线状态     #10B981 emerald-500
警告/待处理       #F59E0B amber-500
错误/离线         #EF4444 red-500
```

### 2.3 内容类型色

```
Topic 标签色      #8B5CF6 violet-500
Wiki 标签色       #3B82F6 blue-500
QA 标签色         #06B6D4 cyan-500
```

### 2.4 Tailwind 配置

```ts
// tailwind.config.ts 追加
colors: {
  sidebar: {
    bg: '#1E293B',
    text: '#94A3B8',
    active: '#FFFFFF',
  },
  code: {
    bg: '#0F172A',
    text: '#E2E8F0',
  }
}
```

---

## 3. 侧栏 — AppSidebar

### 3.1 改造方案

**背景色改为 slate-900（深色）**，收起态和展开态统一深色。

**KB 下拉框固定在侧栏顶部**（选项 A），切换 KB 同步更新 URL。WikiGlobalPage 通过 URL params 读取 KB，不做 Context 注入。

**侧栏内容按 tab 切换：**
- Wiki / Topics tab → 显示文档树
- QA tab → 显示 session 历史
- 首页 → 文档树区域空着

**侧栏切换无过渡动画**，直接切。

#### 收起态 (56px)

```
┌──────┐
│  W   │  ← logo 按钮
│      │
│  📖  │  Wiki — 蓝色高亮
│  💬  │  QA
│  📝  │  Topics
│      │
│  ⚙   │  ← 弹 SettingsModal
│  👤  │  ← 用户头像菜单
└──────┘
```

- 图标 20px，hover tooltip 显示文字
- 当前激活项用主色高亮
- ⚙ 始终弹 modal，不跳路由

#### 展开态 (240px)

```
┌──────────────────────┐
│  W   OpenCodeWiki  ←│
│──────────────────────│
│  📖  Wiki            │
│  💬  问答             │
│  📝  Topics          │
│──────────────────────│
│  [opencodewiki ▼]   │  ← KB 下拉（Wiki/Topics 模式下显示）
│──────────────────────│
│  文档           [+]  │
│  ▸ src/              │
│  ▸ router/           │
│    02-engine.md      │
│  ▸ engine/           │
│──────────────────────│
│  主题                 │
│  #routing-design     │
│──────────────────────│
│              [👤 L]  │
└──────────────────────┘
```

- 文档树使用 monospace 字体 + CSS 缩进线
- KB 下拉仅在 Wiki/Topics tab 时可见

### 3.2 实现要点

- `AppSidebar.tsx` 重写，深色背景 + 文档树内嵌 + KB 下拉
- `LayoutContext` 简化，去掉 `drawerContent` 文档树注入逻辑
- KB 选中态通过 URL 同步（`/wiki/:name`）

---

## 4. Context Toolbar — 内容区局部操作

### 4.1 位置与行为

内容区左上角，垂直排列的小图标列。图标始终可见，hover 展开文字 label。随内容区移动，侧栏展开/收起时不额外处理位移。

```
┌──────┬─────────────────────────────┐
│  📄  │  # routing-design          │
│  🏷️  │                            │
│  🔗  │  content area...           │
│  ⭐  │                            │
│  📋  │                            │
└──────┴─────────────────────────────┘
```

### 4.2 图标功能映射

| 图标 | 功能 | 适用页面 | 数据状态 |
|------|------|----------|----------|
| 📄 | 文档阅读模式 | Wiki 页面 | 即时可用 |
| 🏷️ | Topic 聚合视图 | 页面含 topic 关联时 | 即时可用 |
| 🔗 | 展开代码溯源面板 | 有 source_refs 的页面 | QA 页可用；Wiki 页先占位 |
| ⭐ | 收藏当前条目 | 所有页面 | 先 UI 占位，后端接口后续 |
| 📋 | 复制页面链接 | 所有页面 | 即时可用 |

### 4.3 实现要点

- 新建 `ContextToolbar.tsx`，接收 `availableActions` props
- hover 展开用 CSS `group-hover`

---

## 5. 内容区

### 5.1 代码块升级

代码块加文件头和来源行。元数据通过 `<code-meta>` HTML 标签嵌入 markdown（不影响其他显示）：

```html
<code-meta file="router.go" lang="Go" source="src/router/router.go:42-48" />
```go
func NewRouter() *Router { ... }
```

渲染效果：

```
┌─────────────────────────────────────────────┐
│ ┌─ router.go ── Go ────────────────── [📋] │
│ │                                           │
│ │  func NewRouter() *Router {              │
│ │      ...                                  │
│ │  }                                        │
│ └───────────────────────────────────────────┘
│ 🔗 src/router/router.go:42-48               │
│ 💡 双路分流的核心入口（有则显示）             │
└─────────────────────────────────────────────┘
```

- ReactMarkdown `code` renderer 检测前一个兄弟节点是否为 `code-meta`，是则渲染文件头+溯源行
- 本期先用示例数据验证渲染效果

### 5.2 排版调整

- H1/H2 用更重的字重
- wiki 内部链接用 cyber-blue，外部代码引用用 monospace 蓝色

### 5.3 Topic 视图

`pageType === 'topic'` 时顶部浅蓝渐变 banner，显示 QA 条目数 + 来源文档数。

### 5.4 Header

**移除 Header 组件。** 当前作用极小，新设计中内容区顶部信息由 Context Toolbar 和页面自身标题承担。

### 5.5 BottomInput

**保留。** Wiki 页面底部继续有"对当前文档提问"入口，不放进 Context Toolbar。

---

## 6. 右边栏 — ContentRightPanel

### 6.1 动态内容切换

合并 `WikiRightSidebar` + `TopicRightSidebar` 为 `ContentRightPanel`，按 pageType 和数据自动切换。没有数据的板块不渲染。

#### Wiki 文档页（有代码源 — 后端接口待补，先占位）

```
┌─────────────────────┐
│ 📑 目录              │
│  H1 / H2 / H3       │
│─────────────────────│
│ 🔗 代码溯源          │  ← 占位
│─────────────────────│
│ 🏷️ 关联 Topic       │  ← 占位
│─────────────────────│
│ 📖 相关文档          │  ← 占位
└─────────────────────┘
```

**注意：** 当前后端 Wiki 页面只返回 `{type, slug, content}`。`source_refs`、`in_links`、关联 topic、相关文档等字段均不存在。Wiki 页的代码溯源和关联内容板块先放 UI 占位。

#### Wiki 文档页（纯文档上传）

```
┌─────────────────────┐
│ 📑 目录              │
│─────────────────────│
│ 📄 文档信息          │
│  上传者 / 更新时间   │
└─────────────────────┘
```

#### Topic 视图页（数据现成可用）

```
┌─────────────────────┐
│ 📊 Topic 统计        │
│  N 个 QA 条目       │
│─────────────────────│
│ 💬 关联 QA           │  ← `qa_entries`，后端已返回
│─────────────────────│
│ 📖 关联 wiki 页      │  ← `wiki_links`，后端已返回
└─────────────────────┘
```

### 6.2 数据现状汇总

| 板块 | 数据字段 | 后端是否返回 | 处理方式 |
|------|---------|-------------|---------|
| 目录 TOC | 前端从 content 提取 | N/A | 即时可用 |
| 代码溯源（QA） | `source_refs: {file, line, snippet}` | 是 | 即时可用 |
| 代码溯源（Wiki） | 无 | 否 | 先占位 |
| 关联 Topic | 无 | Wiki 页不返回 | 先占位 |
| 关联 QA | `qa_entries` | Topic 页返回 | 即时可用 |
| 相关文档 | `wiki_links` | Topic 页返回 | 即时可用 |
| 收藏 | 无 | 否 | 先占位 |
| Topic 升级 | 无 | 否 | 先 UI |

---

## 7. 首页

### 7.1 概念调整

- "代码库" → "知识库"
- Hero 副标题强调问答驱动："围绕知识库提问，Agent 基于源码回答，高质量答案自动沉淀为 Wiki"

### 7.2 知识库卡片

```
┌──────────────────────────────────────┐
│  opencodewiki              ✓ 在线    │
│  /home/long/Code/OpenCodeWiki        │
│  23 次问答 · 5 个 Topic · 2 篇 Wiki  │
└──────────────────────────────────────┘
```

- 在线状态绿色圆点
- 三数字用内容类型色标注
- 空知识库显示 "暂无内容 · 去提问"

---

## 8. QA 页面

### 8.1 布局

- **侧栏（QA 模式下）** = session 历史
- **右侧面板** = 代码溯源 + 关联内容
- 各司其职，不重复

### 8.2 改造

1. 用户消息不用 `<h2>`，改为独立气泡样式
2. 操作栏始终可见，小号灰色图标
3. 代码溯源用 `source_refs` 数据渲染 compact card（数据现成：`{file, line, snippet}`）

### 8.3 Topic 升级入口

仅用户点击 👍 采纳后出现：

```
用户点 👍 前：                  用户点 👍 后：
┌──────────────────┐           ┌──────────────────────────────┐
│  (回答内容...)    │           │  (回答内容...)               │
│  👍  👎  📋  🔗  │           │  👍✓  👎  📋  🔗            │
└──────────────────┘           │                              │
                               │  ┌ 升级为 Topic ──────────┐  │
                               │  │ 标题: [____________]   │  │
                               │  │           [确认] [暂缓] │  │
                               │  └────────────────────────┘  │
                               └──────────────────────────────┘
```

- 本期先 UI，后端接口后续
- 默认标题预填为原始问题
- 点「暂缓」入口消失；旧 session 不显示

---

## 9. 设置弹窗

### 9.1 触发

侧栏底部 ⚙ 点击（收起态和展开态都可见），始终弹 modal，不跳路由。

### 9.2 方案

居中 modal，720-800px 宽，左侧 tab + 右侧内容。点空白处关闭，保存用 toast。

```
┌──────────────────────────────────────────────┐
│  ⚙ 设置                              [✕]    │
│──────────────────────────────────────────────│
│  ┌─ 左侧 tab ─┐  ┌─ 右侧内容 ────────────┐  │
│  │  通用       │  │  语言 / 默认知识库 ... │  │
│  │  知识库     │  │                        │  │
│  │  代码仓库   │  │                        │  │
│  │  API 配置   │  │                        │  │
│  │  关于       │  │                        │  │
│  └─────────────┘  └───────────────────────┘  │
└──────────────────────────────────────────────┘
```

---

## 10. 组件清单

### 10.1 新建

| 组件 | 路径 | 用途 |
|------|------|------|
| `ContextToolbar` | `components/layout/ContextToolbar.tsx` | 内容区左上角页面操作图标列 |
| `CodeBlock` | `components/content/CodeBlock.tsx` | 带文件头 + 溯源行的代码块 |
| `ContentRightPanel` | `components/layout/ContentRightPanel.tsx` | 合并 Wiki/Topic 右边栏 |
| `AnswerActions` | `components/qa/AnswerActions.tsx` | QA 操作栏 + topic 升级卡 |
| `CodeTraceCard` | `components/qa/CodeTraceCard.tsx` | 代码溯源 compact card |
| `SettingsModal` | `components/settings/SettingsModal.tsx` | 设置弹窗 |

### 10.2 重构

| 组件 | 改动 |
|------|------|
| `AppSidebar.tsx` | 深色背景 + 文档树内嵌 + KB 下拉 |
| `WikiRightSidebar.tsx` | 合并进 ContentRightPanel |
| `TopicRightSidebar.tsx` | 合并进 ContentRightPanel |
| `QAPage.tsx` | 消息气泡 + 操作栏 + topic 升级 |
| `HomePage.tsx` | 知识库卡片改版 + 视觉升级 |
| `WikiGlobalPage.tsx` | 移除 drawerContent 注入 + KB 下拉移到侧栏 |
| `WikiPage.tsx` | 代码块组件 + topic banner + 右边栏 |

### 10.3 移除

| 文件 | 原因 |
|------|------|
| `LayoutContext.drawerContent` 文档树注入逻辑 | 改为侧栏内嵌 |
| `Header.tsx` | 作用极小，新设计中无需 |

### 10.4 保留

| 文件 | 说明 |
|------|------|
| `BottomInput.tsx` | Wiki 页面底部"对当前文档提问"，保留 |

---

## 11. 实现阶段

### Phase 1: 基础骨架
- 深色侧栏 + KB 下拉 + 文档树内嵌
- 颜色系统 + Tailwind 配置
- 去掉 drawerContent 注入逻辑
- 移除 Header

### Phase 2: 内容区升级
- CodeBlock 组件（文件头+溯源行，示例数据）
- Topic banner
- Context Toolbar

### Phase 3: 右侧栏 + QA 改造
- ContentRightPanel 合并
- QA 操作栏 + Topic 升级入口
- QA 页代码溯源 Card

### Phase 4: 收尾
- SettingsModal
- 首页知识库卡片
- 占位 UI 收尾

---

## 12. 不涉及

- 路由结构：不变
- 后端 API：不变（新增接口后续迭代）
- 数据模型：不变
- AdminPage / SourcesPage / QASharePage：本期不改
- Dark mode 全局支持：仅侧栏深色
- 移动端适配：不做

---

## 13. 未决项

- SettingsModal 具体 tab 内容（需确认后端已有配置项）
- 代码溯源跳转到源码在浏览器中可行性
- Wiki 页面 source_refs / in_links / 关联 topic / 相关文档后端接口
- Topic 升级后端 API
- 收藏后端 API
- `code-meta` 标签的 Agent prompt 改造

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-21 | 初始版本 |
| 2026-07-21 | Grilling 审查：修正 KB 下拉位置、数据现状确认、BottomInput 保留、Header 移除、侧栏切换规则、实现分阶段、多项先 UI 占位 |
