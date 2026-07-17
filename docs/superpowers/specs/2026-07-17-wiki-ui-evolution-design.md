# Wiki UI 进化方案设计 — 基于 DocAgent-ui2 的改造

## 概述

将 `docs/DocAgent-ui2.html` 的设计理念落地到当前 OpenCodeWiki 代码库中，实现两个阶段的改造：
- **第一波（视觉改造）**：统一配色、重构页面骨架、首页重做、浮动输入框美化、搜索联想
- **第二波（增长循环）**：引入 Topic 聚合层实现 QA → Topic → Wiki 自进化闭环，Admin 审批台重做

---

## 第一部分：配色体系

### CSS 变量（优先使用，逐步替换硬编码色值）

```css
:root {
  --primary: #4F46E5;       /* cyber-blue */
  --primary-dark: #4338CA;  /* cyber-blueDark */
  --primary-soft: #EEF2FF;
  --success: #10B981;       /* cyber-green */
  --success-soft: #ECFDF5;
  --bg: #F8F9FA;
  --bg-card: #FFFFFF;
  --bg-sidebar: #FBFBFC;
  --border: #e5e7eb;
  --border-light: rgba(229, 231, 235, 0.5);
  --text: #1E293B;
  --text-muted: #64748B;
}
```

### 应用范围

| 文件 | 改动 |
|------|------|
| `page-shell.ts` | CSS 变量替换，STYLES 常量更新 |
| `src/qa/index.html` | 颜色变量统一 |
| `src/home/index.html` | 颜色变量统一 |
| `src/wiki/entity.html` | 颜色变量统一 |
| `server.ts` 中的 `sendWikiViewer` | 内联 CSS 更新 |

---

## 第二部分：页面骨架重构 (page-shell.ts)

### 现状问题

`renderSidebar()` 只有一份通用侧栏，无法按页面类型切换不同结构。左右栏固定在 HTML 结构层面。

### 改造方案

将 `renderPageShell()` 改为支持**三栏布局**，左栏按 `activeSection` 动态渲染：

```typescript
export interface ShellOpts {
  headerMode: 'light' | 'full';
  repoName?: string;
  activeSection?: string;
  title?: string;
  bottomInput?: BottomInputOpts;
  sidebar?: SidebarOptions;          // 旧字段，兼容
  leftSidebar?: LeftSidebarConfig;   // 新增：左栏配置
  rightSidebar?: boolean;            // 新增：是否启用右栏
}
```

### 左栏三种模式

**Wiki/Entity 模式** (`activeSection === 'wiki' | entity slug`)
```
┌─ 物理视角 (静态说明书) ─┐
│ 📄 01. 设计哲学与愿景    │
│ 📖 02. 系统核心模块      │
│   ├─ 双路路由算法        │
│   └─ 缓存映射矩阵        │
├─ 逻辑视角 (主题聚合) ────┤
│ #qa-engine        3 聚合  │
│ #concurrency      1 聚合  │
└──────────────────────────┘
```

**QA 模式** (`activeSection === 'qa'`)
```
┌─ 主题快捷过滤 ─┐
│ 🌐 显示全部    │
│ #qa-engine     │
│ #concurrency   │
├─ 历史排障会话 ─┤
│ 关于 LSH 卡顿  │
│ Redis 连接诊断  │
└────────────────┘
```

**Admin 模式** (`activeSection === 'admin'`)
```
┌─ 审批控制塔 ──────┐
│ ⏳ 待审草稿  (N)  │
│ 🗺️ 主题-物理映射   │
└──────────────────┘
```

### 右栏

- 默认不显示（AI 处理模式时打开，由调用方控制）
- QA 页保留已有的文件引用面板（当前实现在 `src/qa/index.html` 中已有）

---

## 第三部分：首页重做

### 布局

```
┌────────────────────────────────────────┐
│          OpenCodeWiki                  │
│    让项目说明书与日常问答完美联动       │
│  ┌──────────────────────────────────┐  │
│  │ 🔍 搜索物理文档、主题或问答...   │  │
│  └──────────────────────────────────┘  │
│         Ctrl+K                         │
│                                        │
│  ┌──────────┐  ┌──────────┐           │
│  │ 📁 关联仓库 │  │ 📄 最新文档 │           │
│  │ opencodewiki│  │ 双路路由算法 │           │
│  │ 已同步      │  │ 3分钟前    │           │
│  └──────────┘  └──────────┘           │
│  ┌──────────┐  ┌──────────┐           │
│  │ 💬 最新 QA  │  │ 🔥 最热 QA  │           │
│  │ LSH 卡顿... │  │ 双路路由... │           │
│  │ 待审草稿    │  │ 已持久化   │           │
│  └──────────┘  └──────────┘           │
└────────────────────────────────────────┘
```

### 数据源

| 板块 | 数据来源 |
|------|---------|
| 关联仓库 | `loadRegistry()`（已有） |
| 最新文档 | `loadModuleTree()` + 最近修改的 md 文件时间戳 |
| 最新 QA | `qaStore.listEntries({ sort: 'latest', limit: 3 })`（已有） |
| 最热 QA | `qaStore.listEntries({ sort: 'visit', limit: 3 })`（已有） |
| 搜索联想 | wiki 页面列表 + topic 列表 + QA 标题的本地过滤（前端实现） |

### 搜索行为

- 输入文字 → 前端从预加载的索引池中过滤 → 显示联想 dropdown
- 回车 → 跳转到 `/qa?q=<query>` 进行 LLM 回答
- Item 点击 → 跳转到对应页面（wiki / topic / qa）

---

## 第四部分：浮动输入框美化

### 现状

`page-shell.ts` 的 `renderBottomInput()` 输出一个带输入框、实体标签、发送按钮的基础组件。

### 改造后

```html
<div class="bottom-input-wrap">
  <div class="bottom-input">
    💻 <input placeholder="提出新疑问..." />
    <span class="context-tag">#qa-engine</span>
    <button class="send-btn">→</button>
  </div>
</div>
```

样式变更：
- `backdrop-filter: blur` 背景雾化
- `focus-within` 蓝色边框 + 光环
- `shadow-lg` 阴影层级提升
- 圆角从 `12px` 改为 `rounded-xl`
- context tag 样式：小号 font-mono，灰色底色

---

## 第五部分：Topic 数据模型（第二波新增）

### 新增表

```sql
-- Topic 聚合表
CREATE TABLE IF NOT EXISTS topics (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pool' CHECK(status IN ('pool', 'promoted')),
  wiki_module TEXT DEFAULT NULL,        -- 晋升后绑定的 wiki module slug
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  promoted_at TEXT DEFAULT NULL
);

-- Topic ↔ QA 关联
CREATE TABLE IF NOT EXISTS topic_qa (
  topic_slug  TEXT NOT NULL REFERENCES topics(slug),
  qid         INTEGER NOT NULL REFERENCES qa_entries(qid),
  PRIMARY KEY (topic_slug, qid)
);

-- Topic 提炼稿缓存
CREATE TABLE IF NOT EXISTS topic_drafts (
  topic_slug    TEXT PRIMARY KEY REFERENCES topics(slug),
  raw_content   TEXT NOT NULL,           -- LLM 原始提炼稿 (markdown)
  edited_content TEXT DEFAULT NULL,       -- 人工编辑后的版本
  status        TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewer      TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now')),
  reviewed_at   TEXT DEFAULT NULL
);
```

### Topic 生命周期

```
LLM 聚类 QA 条目
  → 生成 Topic 建议 (topic 暂未创建)
    → 人工确认 → 创建 topic (status='pool')
      → 吸纳关联 QA
        → 人工触发「提炼」→ LLM 生成 draft (topic_drafts)
          → Admin: 选择 wiki 模块、审核文稿
            → 审批通过 → 晋升 (status='promoted')
              → 写入 wiki markdown → 增长循环闭合
```

### API 接口（第二波新增）

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/topics/analyze` | 分析 QA 池，LLM 聚类生成 topic 建议 |
| GET | `/api/topics/suggestions` | 获取待确认的 topic 建议列表 |
| POST | `/api/topics/confirm` | 确认创建 topic |
| GET | `/api/topics` | 列出所有 topic（pool + promoted） |
| GET | `/api/topics/:slug` | 获取单个 topic 详情 + 关联 QA |
| POST | `/api/topics/:slug/refine` | LLM 提炼 topic → 生成 draft |
| GET | `/api/topics/:slug/draft` | 获取提炼稿 |
| PUT | `/api/topics/:slug/draft` | 人工编辑提炼稿 |
| POST | `/api/topics/:slug/promote` | 晋升：选 module + 审核通过 → 写入 wiki |

---

## 第六部分：Admin 审批台重做（第二波）

### 布局

```
┌─ 左侧栏 ────────────┬─ 中栏 ──────────────────────────────────────┐
│ ⏳ 待审草稿    (N)  │  ┌─ Topic 建议 (分析 QA 池后产生) ──────┐  │
│ 🗺️ 主题-物理映射    │  │  #qa-engine: 双路路由实践 (3条QA)      │  │
│                      │  │  [#concurrency: 连接池优化 (2条QA)     │  │
│                      │  │  [确认] [忽略]                         │  │
│                      │  └────────────────────────────────────────┘  │
│                      │                                              │
│                      │  ┌─ 提炼与审核 ─────────────────────────┐  │
│                      │  │  #qa-engine · 目标模块: [选择...]     │  │
│                      │  │                                        │  │
│                      │  │  ┌─ 液态原始 ───┐ ┌─ 固态提炼 ────┐  │  │
│                      │  │  │ "高并发200时  │ │ ### 高并发冷启 │  │  │
│                      │  │  │  主线程卡死"  │ │ 动主线程卡顿   │  │  │
│                      │  │  └─────────────┘ └───────────────┘  │  │
│                      │  │                                        │  │
│                      │  │  [编辑提炼稿] [预览wiki效果] [晋升]   │  │
│                      │  └────────────────────────────────────────┘  │
└──────────────────────┴──────────────────────────────────────────────┘
```

### 晋升流程细节

1. Admin 在左侧栏看到所有 `topic_drafts` 计数
2. 点击一个 topic → 中栏展示：
   - 关联 QA 列表（液态原始对话）
   - LLM 提炼稿（固态 markdown）
   - 模块树选择器（展示 wiki 现有模块层级）
3. Admin 可编辑提炼稿
4. 点击「预览」→ 展示插入目标模块后的效果（markdown 预览）
5. 点击「晋升」→ 系统执行：
   a. 更新 `topics.status = 'promoted'`
   b. 写入目标 wiki markdown 文件（追加到模块对应位置）
   c. 更新 `module_tree.json`（如需要新增导航节点）
   d. 触发 wiki 页面重新生成

---

## 第七部分：搜索联想

### 实现方式

- 首页加载时，将 wiki 页面列表、topic 列表、热门 QA 标题预加载到前端 JS 数组
- 用户输入时，前端过滤 + 即时展示 dropdown
- 不需要额外 API 调用（减少延迟）

### 联想池数据结构

```javascript
const searchPool = [
  { type: 'wiki',  label: '📖 双路分流路由算法系统',        slug: '02-qa-engine' },
  { type: 'topic', label: '🏷️ 核心主题: #concurrency',      slug: 'concurrency' },
  { type: 'topic', label: '🏷️ 核心主题: #qa-engine',        slug: 'qa-engine' },
  { type: 'qa',    label: '💬 LSH 冷启动卡顿问题排障',      qid: 103 },
];
```

### 伪代码

```javascript
function handleSearchInput(val) {
  const filtered = searchPool.filter(item =>
    item.label.toLowerCase().includes(val.toLowerCase())
  );
  // 渲染 dropdown
  // 回车 → /qa?q=<val>
  // 点击联想项 → 跳转对应页面
}
```

---

## Spec 自检

- **占位符**：无 TBD/TODO，所有实现细节已明确
- **内部一致性**：配色、布局、数据流在各部分一致；Topic 表设计与 API 路由对应
- **范围控制**：两波交付界限清晰，第一波不引入新数据模型，第二波不涉及视觉改造
- **歧义检查**：
  - Topic 是 QA 聚合的中间态，不独立于 wiki 框架——已明确为"池"概念
  - 模块选择在审批时由人工操作——已明确
  - LLM 提炼稿结构也需审核——已明确
