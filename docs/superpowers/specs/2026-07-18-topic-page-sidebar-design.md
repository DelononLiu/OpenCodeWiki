# WikiPage 三栏统一 + Topic 右栏设计

## 概述

在 WikiPage 内部统一使用三栏布局，根据 `pageType` 切换右侧栏内容：
- **wiki** → 文章大纲目录 (TOC)
- **topic** → 关联 QA + 关联 Wiki 页面链接

不新增独立页面，不跳转路由，Topic 继续通过 `/:repo#topic-slug` 访问。

## 布局对比

### wiki 模式

```
/:repo#overview
┌─ Header ──────────────────────────────────────────────┐
├─ 左侧栏 ──┬─ 主内容区 ────────┬─ 右侧栏 ──────────────┤
│ 物理视角   │ [markdown 内容]   │ 📑 文章大纲            │
│ 📄 概览    │                   │  ## 设计哲学           │
│ 📖 双路..  │                   │  ## 核心模块           │
│            │                   │    ### 双路路由        │
│ 逻辑视角   │                   │    ### 缓存映射        │
│ #qa-engine │                   │  ## 部署配置           │
│ #concurr.. │                   │                       │
└────────────┴───────────────────┴───────────────────────┘
```

### topic 模式

```
/:repo#qa-engine
┌─ Header ──────────────────────────────────────────────┐
├─ 左侧栏 ──┬─ 主内容区 ────────┬─ 右侧栏 ──────────────┤
│ 物理视角   │ # 双路路由实践     │ 📎 关联 QA            │
│ 📄 概览    │                    │ #Q103 LSH 卡顿...     │
│ 📖 双路..  │ 提炼稿 markdown   │ #Q107 双路分流...     │
│            │                    │                       │
│ 逻辑视角   │                    │ 📖 关联页面            │
│ #qa-engine │                    │ 02-qa-engine          │
│ #concurr.. │                    │                       │
└────────────┴────────────────────┴──────────────────────┘
```

## 右侧栏规格

### wiki 模式：文章大纲目录 (TOC)

- **数据源**：从已渲染的 markdown HTML 中提取 `h1`~`h3` 标题
- **生成时机**：`renderedHtml` 变化后，解析 DOM 提取标题层级
- **交互**：
  - 点击标题 → 页面滚动到对应位置
  - 滚动页面 → 高亮当前可见标题（IntersectionObserver）
- **缩进**：h1 无缩进，h2 缩进 8px，h3 缩进 16px
- **空态**：若文章无标题，右栏显示"暂无目录"

### topic 模式：关联内容

- **关联 QA 列表**：
  - 数据源：`GET /api/wiki/:slug` 返回的 `qa_entries` 数组
  - 显示：qid + question 前 40 字符，按 created_at 倒序
  - 点击：跳转到 `/qa?qid=xxx` 打开对应 QA
  - 空态："暂无关联 QA"

- **关联 Wiki 页面**：
  - 数据源：
    - `topics.wiki_module`：如果 topic 已晋升，显示绑定的 wiki module
    - draft markdown 中引用的 wiki 链接（如 `[xxx](../02-qa-engine.md)`）
  - 显示：页面标题 + slug
  - 点击：更新 hash 导航到对应 wiki 页面
  - 空态："暂无关联页面"

## API 变更

### `GET /api/wiki/:slug`

当 slug 匹配 topic 时，返回数据扩展：

```json
{
  "type": "topic",
  "slug": "qa-engine",
  "content": "# 双路路由实践\n\n...",
  "topic": {
    "name": "双路路由实践",
    "description": "...",
    "status": "pool",
    "wiki_module": null
  },
  "qa_entries": [
    { "qid": 103, "question": "LSH 冷启动卡顿问题排障", "created_at": "..." },
    { "qid": 107, "question": "双路分流延迟排查", "created_at": "..." }
  ],
  "wiki_links": [
    { "slug": "02-qa-engine", "name": "双路路由算法系统" }
  ]
}
```

新增字段：
- `topic`：topic 元信息
- `qa_entries`：关联 QA 列表（最多 20 条）
- `wiki_links`：关联 wiki 页面（从 topics.wiki_module 和 draft 内容提取）

## 前端变更

### WikiPage.tsx

- 新增 `TopicRightSidebar` 和 `WikiRightSidebar` 子组件
- `pageType === 'wiki'` → 渲染 `<WikiRightSidebar headings={...} />`
- `pageType === 'topic'` → 渲染 `<TopicRightSidebar qaEntries={...} wikiLinks={...} />`
- 布局从 `flex` 两栏改为 `flex` 三栏
- 主内容区宽度从 `max-w-4xl` 调整为 `max-w-3xl`（给右栏腾空间）

### WikiRightSidebar（新增）

- Props：`headings: { id: string; text: string; level: number }[]`
- 固定宽度 `w-56`，sticky 定位
- 从 renderedHtml 提取标题：
  ```typescript
  const headings = useMemo(() => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(renderedHtml, 'text/html')
    return Array.from(doc.querySelectorAll('h1,h2,h3')).map(el => ({
      id: el.id,
      text: el.textContent || '',
      level: parseInt(el.tagName[1])
    }))
  }, [renderedHtml])
  ```
- 滚动高亮：使用 `IntersectionObserver` + 当前 active heading 高亮

### TopicRightSidebar（新增）

- Props：`qaEntries: QaEntry[]; wikiLinks: { slug: string; name: string }[]`
- 固定宽度 `w-56`，sticky 定位
- 两个区块：📎 关联 QA、📖 关联页面
- 纯静态展示 + 链接跳转

### LeftSidebar.tsx

- topic 状态标签区分：
  - `pool` → "聚合中"
  - `published` → "已沉淀"

### API client.ts

- `fetchWikiPage()` 返回类型扩展，增加 `topic`、`qa_entries`、`wiki_links` 字段

## 术语重命名：promote → publish

Design 阶段确定将"晋升"改为"沉淀为 Wiki"（`publish`）：

| 位置 | 旧 | 新 |
|------|-----|-----|
| 数据库 `topics.status` | `'promoted'` | `'published'` |
| 数据库 `topics.promoted_at` | `promoted_at` | `published_at` |
| 数据库 CHECK 约束 | `CHECK(status IN ('pool', 'promoted'))` | `CHECK(status IN ('pool', 'published'))` |
| Python `store_topics.promote()` | `promote()` | `publish()` |
| API 路由 | `POST /api/topics/{slug}/promote` | `POST /api/topics/{slug}/publish` |
| 前端 `api/client.ts` | `promoteTopic()` | `publishTopic()` |
| Admin 按钮文案 | "晋升到 Wiki" | "沉淀为 Wiki" |
| Admin 结果文案 | "晋升成功" | "沉淀成功" |
| 状态标签文案 | "已固化" | "已沉淀" |
| TypeScript `Topic.status` | `'pool' \| 'promoted'` | `'pool' \| 'published'` |
| TypeScript `Topic` 字段 | `promoted_at` | `published_at` |

---

## Header 统一导航 + 用户菜单

### 导航按钮（所有页面统一）

```
[W OpenCodeWiki ...]          [首页] [Wiki] [问答] [👤 long2015 ▾]
```

- 固定三入口：首页、Wiki、问答
- 当前页面的按钮不显示（避免自己跳自己）
- AdminPage 无独立的导航入口

### 用户下拉菜单

**管理员：**
```
┌──────────────┐
│ 管理后台       │  → /admin
│ ─────────    │
│ 个人设置       │  → /settings
│ 退出登录       │
└──────────────┘
```

**普通用户：**
```
┌──────────────┐
│ 个人设置       │  → /settings
│ 退出登录       │
└──────────────┘
```

- "管理后台"仅管理员可见
- 角色判定：初期 config 白名单，后续接 OAuth/SSO
- 当前无登录系统，先用硬编码管理员名单占位

## 不变更

- App.tsx 路由：无变化
- Header / BottomInput：无变化
- `topics` 表结构：无变化
- `topic_qa` 表：无变化

---

## AdminPage 左侧栏 + Tab 分离

### 问题

- Admin 左侧栏目前只有"待审草稿"一个入口，太单薄
- QA 审核和 Topic 管理混在同一主内容区，功能臃肿

### 改造后

**左侧栏：**

```
┌─ Admin 左侧栏 ──────┐
│ 📋 QA 审核           │
│   ⏳ 待审    (3)     │
│   ✅ 已审    (12)    │
│                      │
│ 🧠 Topic 管理        │
│   📝 聚合中   (2)    │
│   📖 已沉淀   (1)    │
└──────────────────────┘
```

**主内容区：** 点击左侧不同入口切换视图，不再混排。

| 左侧点击 | 主内容区 |
|---------|---------|
| ⏳ 待审 | QA 校准列表（待审条目 + 校准输入框 + 校准按钮） |
| ✅ 已审 | 已审核 QA 列表（只读，可按时间/domain 过滤） |
| 📝 聚合中 | Topic 列表（status=pool）+ 分析 QA 池按钮 |
| 📖 已沉淀 | Topic 列表（status=published），可点击查看详情 |

**Topic 详情面板**（点击单个 topic 后展开）保持不变：
- 两栏对比（液态原始 QA | 固态提炼编辑稿）
- 目标模块选择 + 预览 + 沉淀为 Wiki

### 左侧栏组件变更

`LeftSidebar` pageType='admin' 时新增子导航项：

```typescript
// 数据来源
fetchQaEntries({ status: 'pending' })  → pendingCount
fetchQaEntries({ status: 'active' })   → reviewedCount
fetchTopics({ status: 'pool' })        → poolCount
fetchTopics({ status: 'published' })   → publishedCount
```

### AdminPage 主内容区变更

- 新增 `adminView` state：`'pending-qa' | 'reviewed-qa' | 'pool-topics' | 'published-topics'`
- 新增 `topicDetailSlug` state：控制 topic 详情面板展开
- 默认进入 `'pending-qa'` 视图
- Topic 详情面板复用现有逻辑（handleViewTopic → 展开对比视图）

---

## QAPage 左侧栏：知识条目列表

### 设计原则

与传统 AI Chat 的本质区别：Wiki QA 是**知识挖掘工作台**，不是聊天框。每一次问答是一条结构化的知识资产，具有生命周期（提问 → 关联 topic → 沉淀为 wiki）。

### 左侧栏 QA 列表

```
┌─ QA 左侧栏 (w-72) ───────────────────────────────────┐
│ 🔍 搜索 QA...                                          │
│                                                        │
│ [全部] [bug-analysis] [log-analysis] [program]         │
│                                                        │
│ 今天                                                   │
│   Redis 连接池线程等待               #103  #concurrency │
│   系统启动初始化时序问题             #112  #qa-engine   │
│                                                        │
│ 三天内                                                  │
│   双路分流延迟排查                   #107  #qa-engine   │
│                                                        │
│ 本周                                                   │
│   LSH 冷启动卡顿问题排障             #103  #qa-engine   │
│   缓存映射矩阵设计思路              #98   #cache-design │
│                                                        │
│ 本月                                                   │
│   ...                                                  │
│                                                        │
│ 更早                                                   │
│   ...                                                  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**格式规范：**
- 每条一行：`标题` + `#qid`（小号灰色） + `#topic`（小号灰色，右对齐）
- 时间分组：今天 / 三天内 / 本周 / 本月 / 更早
- 不显示状态（`已沉淀` / `聚合中`），用户在 QA 页不是来做审核的
- 不显示 qid 编号列 — qid 做小做淡跟在标题后，作用和 #topic 标签一样，提供引用标识

**过滤标签行：**
- 按 domain 过滤：`bug-analysis`、`log-analysis`、`program-analysis`、`general`
- 默认 `全部`
- 可选：按 topic 过滤（下拉或点击列表中 #topic 标签切换到该 topic 视图）

**空态：** "暂无 QA 记录，从首页或 Wiki 页底部提问开始"

### 主内容区

点击左侧 QA 条目 → 主内容区展示完整 QA 详情：

- 答案正文（markdown 渲染）
- 来源引用（源码位置 / wiki 页面链接）
- 操作入口：关联 topic、查看相关 QA

点击 `[+ 新建提问]` → 主内容区切换到提问模式（当前已有的对话流）。

### 数据来源

- QA 列表：`GET /api/qa/entries`，已有接口
- 按时间分组在前端完成，API 不做分组逻辑

---

## HomePage 微调

### 布局：代码库独立 + 内容卡片

"代码库"是基础设施层，不应和内容卡片混在 2x2 网格中：

```
┌─ Hero Search ────────────────────────────────────┐
│ [W] OpenCodeWiki                                  │
│ [🔍 搜索框]                                       │
└───────────────────────────────────────────────────┘

┌─ 代码库 (full width) ─────────────────────────────┐
│ [opencodewiki 已接入] [docs-main 已接入]            │
│ [example-repo 已接入]  [+ 接入更多]                 │
└───────────────────────────────────────────────────┘

┌─ 最新文档 ────────────┐ ┌─ 最新 QA ──────────────┐
│                       │ │                        │
└───────────────────────┘ └────────────────────────┘
┌─ 最热 QA ────────────────────────────────────────┐
│                                                   │
└───────────────────────────────────────────────────┘
```

**要点：**
- 代码库：全宽区域，repo 卡片排列（每行 2-3 个），底部"+ 接入更多"跳转管理
- 内容卡片三个：最新文档 + 最新 QA 并排，最热 QA 单独一行（或两行网格看视觉）
- 去掉卡片内的状态标签（"待审草稿"/"已校准"），改用时间、访问量
- "关联物理仓库" → "代码库"

## Spec 自检

- **占位符**：无 TBD/TODO
- **内部一致性**：三栏布局在 wiki/topic 模式统一；Admin/QAPage 左侧栏各自独立但风格一致
- **范围控制**：WikiPage 三栏改造 + Admin 左侧栏分离 + QA 左侧栏列表 + publish 术语重命名
- **歧义检查**：
  - TOC 从 DOM 提取 → DOMParser
  - QA 列表时间分组 → 前端按 `created_at` 分组
  - qid 编号保留但做淡 → 统一为小号灰色 `#103` 格式
  - QA 页不显示状态 → 普通用户不需要看审核状态
