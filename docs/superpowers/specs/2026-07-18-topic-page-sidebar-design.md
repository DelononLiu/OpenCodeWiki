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

## 不变更

- App.tsx 路由：无变化
- HomePage / QAPage / AdminPage：无变化
- Header / BottomInput：无变化
- `topics` 表结构：无变化
- `topic_qa` 表：无变化

## Spec 自检

- **占位符**：无 TBD/TODO
- **内部一致性**：布局、API、数据流在三栏模式下一致；wiki 和 topic 各自有明确的右栏内容定义
- **范围控制**：只涉及 WikiPage.tsx + 两个右栏子组件 + API 扩展，不动路由和其他页面
- **歧义检查**：
  - TOC 从 DOM 提取而非正则 → 明确使用 DOMParser
  - topic wiki_links 来源 → 明确为 wiki_module + draft 内容中的 wiki 链接
  - 右栏固定宽度 → 明确为 w-56
