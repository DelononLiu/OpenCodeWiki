# Wiki 实体化 + QA 统一架构设计

## 背景

OpenCodeWiki 已具备基础实体系统（JSON 文件 CRUD）、多模式 QA 引擎（LLM/ACP/LangGraph）、Wiki 生成器和 #Q 问答沉淀体系。现有架构的问题在于：

- 实体（结构化骨架）与 wiki 页面（文档正文）未分离，二者纠缠
- QA 引擎每次走 LLM，缺乏"已校准答案直接命中"的双路机制
- 实体与 QA 条目各自独立，没有关联
- 搜索范围狭窄，实体/QA/文件互不打通
- 存储分散：实体 JSON 文件、QA SQLite（部分）、Wiki .md 各自独立

## 设计目标

1. **实体数据与 wiki 页面解耦** — 实体是结构化骨架（knowlege.db），wiki 页面是 .md 文档正文
2. **双路 QA 引擎** — 高置信命中直接返回校准答案，未命中才走 LLM
3. **以 QA 为入口** — 用户首动作是提问，搜索是 QA 引擎的内部依赖
4. **统一存储底座** — knowledge.db (SQLite) 统一实体、QA、关联关系
5. **多种 wiki 页面类型** — 实体/概览/数据模型/#Q 归档各有预设大纲，统一发布流程

## 使用场景

| # | 场景 | 用户 | 系统行为 |
|---|------|------|---------|
| 1 | 遇到问题先问 QA，未解决附上下文问人 | 库使用者 | QA 返回答案 + 置信标签；低置信生成会话摘要供分享 |
| 2 | 通过 QA 深入模块分析问题 | 库维护者 | QA 带实体上下文 + 源码引用 + 关系图，支持追问 |
| 3 | 多库入门 | 新人 | Wiki 跨库实体关联 + QA 问答串联多仓库知识 |
| 4 | 代码资产管理、变更影响决策 | 管理者 | 实体热度 + 影响地图 + 实体变更看板（v2） |
| 5 | 获取 API 的完整使用示例 | 开发者 | QA 生成逻辑结构完整的示例代码（非片段） |

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│ 前端 (TypeScript)                                                │
│ 首页（QA输入+热门） · Wiki查看器 · QA页面                        │
│ QA输入框悬浮底部居中（所有页面统一）                              │
└───────────────────────────────────┬─────────────────────────────┘
                                    │ HTTP / SSE
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 后端 (Node.js Express)                                           │
│  ┌───────────────────────┐        ┌─────────────────────────┐   │
│  │ /api/search (内部)     │        │ QA引擎                   │   │
│  │ 实体+QA 二分搜索       │        │ 相似≥0.85→直接返校准答案 │   │
│  │ 不做文件/符号独立搜索  │        │ 相似0.5~0.85→推相似问题  │   │
│  │                       │        │ <0.5→纯 LLM 生成         │   │
│  └───────────┬───────────┘        └──────────────┬──────────┘  │
│              │                                    │             │
│              └───────────┬────────────────────────┘             │
│                          ▼                                      │
│           ┌──────────────────────────────┐                     │
│           │ 实体系统 (Entity CRUD)        │                     │
│           │ · LLM 骨架生成               │                     │
│           │ · 人工校准 / 完善             │                     │
│           │ · 自动关联 #Q                │                     │
│           │ · 关系推导（LLM + 使用积累）   │                     │
│           └──────────────┬───────────────┘                     │
└──────────────────────────┼─────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
┌────────────────────┐ ┌────────┐ ┌──────────────┐
│ knowledge.db       │ │.md文件 │ │ codebase-    │
│ (SQLite)           │ │ (Wiki) │ │ memory-mcp   │
│ entities           │ │        │ │ (SQLite)     │
│ entity_files       │ │实体文章 │ │ nodes/edges   │
│ entity_relations   │ │概览/   │ │ /files        │
│ entity_qa          │ │#Q归档   │ │              │
│ qa_entries         │ │        │ │ 软关联：符号名│
│ page_templates     │ │        │ │ 不做校验层   │
└────────────────────┘ └────────┘ └──────────────┘
```

## 1. 数据存储层

### 1.1 Entity 存储 — knowledge.db

实体结构化数据独立存储在 SQLite 中，与 wiki 页面正文解耦。

```sql
-- 实体表
CREATE TABLE entities (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','reviewed','published')),
  project TEXT,
  page_type TEXT DEFAULT 'entity',
  search_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 实体涉及文件/符号（软关联 codegraph，只存符号名字符串）
CREATE TABLE entity_files (
  entity_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
  path TEXT NOT NULL,
  symbols TEXT DEFAULT '[]',       -- JSON 数组 ["encode", "decode"]
  PRIMARY KEY (entity_slug, path)
);

-- 实体关系（有向/无向图）
CREATE TABLE entity_relations (
  source_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
  target_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
  relation_type TEXT CHECK(relation_type IN ('depends-on','part-of','related')),
  weight REAL DEFAULT 1.0,
  source TEXT DEFAULT 'llm',       -- 'llm' | 'manual' | 'qa-cooccur'
  PRIMARY KEY (source_slug, target_slug, relation_type)
);

-- 实体 ↔ #Q 关联
CREATE TABLE entity_qa (
  entity_slug TEXT REFERENCES entities(slug) ON DELETE CASCADE,
  qid INTEGER,
  PRIMARY KEY (entity_slug, qid)
);
```

### 1.2 Wiki 页面存储 — .md 文件

所有 wiki 正文存储为 markdown 文件，按页面类型分目录：

```
~/.opencodewiki/pages/
├── entities/          ← 实体 wiki 文章
│   ├── tokenizer.md
│   └── kv-cache.md
├── overviews/         ← 概览/架构说明
│   ├── architecture.md
│   └── data-model.md
├── qa-archives/       ← #Q 归档
│   └── q42-tokenizer-init.md
└── templates/         ← 预设大纲模板
    ├── entity.md
    ├── overview.md
    └── qa-archive.md
```

.md 文件使用 frontmatter 记录元数据：

```markdown
---
slug: tokenizer
page_type: entity
status: published
title: Tokenizer
created_by: llm
reviewed_by: admin
published_at: 2026-07-11
---

## 定义

...
```

### 1.3 与 codebase-memory-mcp 的关系

- 实体符号引用只存**符号名字符串**（如 `encode` + 文件路径 `src/tokenizer.ts`）
- 不与 codegraph 的内部节点 ID 绑定
- LLM 生成实体时，在线查询 codegraph 确认符号存在性
- **不做运行时校验层**，不引入映射表，切换 codegraph 引擎无影响

### 1.4 实体 ↔ Wiki 页面关系

```
knowledge.db（结构化骨架）              .md 文件（文档正文）
slug: tokenizer          ──── slug ──→  title: Tokenizer
name: Tokenizer                        正文内容
files: [{path, symbols}]               LLM 根据骨架 + 源码 生成
relations: [{target, type}]            人工可反复修订大纲和内容
status: draft/published                渲染时引用 entity_files/relations
search_count                           生成代码引用块和关系图
```

两者通过 slug 关联，修改一方不影响另一方。实体数据变化后，可由用户手动触发"重新生成"更新 wiki 页面。

## 2. 搜索与 QA 引擎

### 2.1 搜索定位

搜索不是前端独立功能，而是 QA 引擎的内部依赖。用户首屏看到的是 QA 输入框。搜索面向两种数据类型召回：

1. **实体** — 按 `name` + `definition` 匹配
2. **QA 条目** — 按问题文本 FTS5 相似匹配

不单独搜索文件路径或函数符号。

### 2.2 搜索与路由流程

```
用户输入问题
    │
    ▼
/api/search（内部）
    │
    ├─ ① entities 表：FTS5 匹配 name + definition
    ├─ ② qa_entries 表：FTS5 匹配 question
    │
    ▼
路由决策：
    ├─ 最高相似度 ≥ 0.85 → 直接返回校准答案（绿标"标准答案"）
    ├─ 0.5 ≤ 最高相似度 < 0.85 → LLM 生成 + 末尾推荐相似 #Q
    └─ 最高相似度 < 0.5 → 纯 LLM 生成
```

### 2.3 实体与 QA 的关联时机

每次 QA 回答完成后（不论命中与否），解析回答中涉及的实体 slug，写入 `entity_qa` 表：

- LLM 生成时 prompt 要求：涉及已知实体时在回答末尾注明 slug
- 后端解析 `#实体名` 标记，建立关联
- 随着 QA 使用，实体自动积累关联的 #Q 条目

### 2.4 双路引擎收益

| 场景 | 当前行为 | 新行为 |
|------|---------|--------|
| 用户问了个已校准的标准问题 | 走 LLM（耗时 3-10s，消耗 token） | 直接返回（<100ms，零 token 消耗） |
| 用户问了个近似的已有问题 | 走 LLM 从零生成 | LLM 生成 + 推荐相似问题 |
| 全新问题 | 走 LLM 从零生成 | 走 LLM + 上下文携带相关实体数据 |

## 3. Wiki 页面生命周期

### 3.1 页面类型与预设大纲

| page_type | 适用场景 | 大纲模板 |
|-----------|---------|---------|
| `entity` | 业务概念介绍 | 定义 → 核心职责 → 使用方式 → 关键技术细节 → 涉及文件 → 上下游关系 |
| `overview` | 系统概览、架构说明 | 一句话说明 → 架构图 → 核心模块清单 → 设计决策 |
| `qa-archive` | 常见问题沉淀 | 问题 → 标准答案 → 代码引用 → 相关实体 |
| `data-model` | 核心数据结构 | 实体列表 → ER 关系 → 关键字段说明 |

每个大纲模板是一个 `.md` 文件，存储在 `templates/` 目录。

### 3.2 发布流程

```
知识图谱中提取实体骨架
    │
    ▼
LLM 读取实体数据 + 源码(codegraph) + 选择对应大纲模板
    │
    ▼
.md 初稿（草稿态）
    │
    ▼
人工审阅 → 调整大纲/内容 → 完善？ 
    │                        │
    │ 无需再调整             │ 需要重新生成
    │                        ▼
    │                   LLM 按新大纲重写
    │                        │
    └────── 发布 ────────────┘
              │
              ▼
         搜索可发现 · #Q 关联自动展现在侧边栏
```

- **"完善"按钮**：人工调整大纲方向后点击，让 LLM 按新大纲重写 .md 内容（不修改实体数据）
- **"审阅→调整"的方式**：v1 中人工审阅和调整大纲通过直接编辑 .md 文件完成，暂不开发结构化编辑器
- **外部工具**：.md 文件可被其他工具直接写入，绕过 LLM 流程发布

### 3.3 v1 不做

- 版本历史
- 多人协作冲突
- 实时预览/草稿箱
- 机器人审批流程

## 4. 前端页面

### 4.1 页面路由

| 页面 | 路由 | 说明 |
|------|------|------|
| 首页 | `/` | QA 输入框居中 + 热门实体 + 热门 #Q |
| Wiki 查看器 | `/:repo/wiki/:slug` | 侧边栏 + wiki 正文 + 关联面板 + QA 输入框。**路由变更**：当前 wiki 查看器在 `/:repoName`，需改为 `/:repo/wiki/` 前缀 |
| QA 页面 | `/qa` | 问答对话视图 |

### 4.2 Wiki 查看器布局

```
┌──────────────────────────────────────────┬──────────────┐
├────────────┬─────────────────────────────┤  关联 #Q     │
│            │  Wiki 页面正文               │  (右上角     │
│  侧边栏     │  (按 page_type 渲染)         │   悬浮面板)  │
│  ├ 实体     │                              │             │
│  ├ 概览     │  代码引用块                   │  #Q42 初始化│
│  ├ #Q归档   │  关系图（1-2跳）              │  #Q58 区别  │
│  └ 数据模型 │                              │  #Q103 OOM  │
│            │                              │             │
└────────────┴──────────────────────────────┴─────────────┘
                    ↑ QA 输入框（悬浮底部居中）
```

### 4.3 共性

- 所有页面的 QA 输入框固定在**底部中间悬浮**，样式与 QA 页面一致
- 实体详情页是混合渲染：正文从 .md 文件渲染，代码引用/关系图/关联 #Q 面板从 knowledge.db 结构化数据动态生成
- 其他 wiki 页面（overview/qa-archive/data-model）从 .md 渲染

## 5. 与现有系统的迁移

### 5.1 现有实体（JSON 文件）

一次迁移脚本：扫描 `~/.opencodewiki/entities/*.json` 写入 knowledge.db 的 entities/entity_files/entity_relations 表。现有 .md 文件保持不动。

### 5.2 现有 #Q 条目

已有 qa_entries 表（部分 SQLite）整合到 knowledge.db 的 qa_entries 表。已校准条目自动打上"标准答案"标记。

### 5.3 目录结构变化

```
~/.opencodewiki/
├── knowledge.db          ← 新增：统一结构化数据存储
├── pages/                ← 新增：wiki 页面 .md 文件
│   ├── entities/
│   ├── overviews/
│   ├── qa-archives/
│   └── templates/
├── entities/             ← 保留向后兼容（只读，新数据写入 knowledge.db）
├── qa-sessions/          ← 保留
├── uploads/              ← 保留
├── registry.json         ← 保留
└── config.json           ← 保留
```

## 架构决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 实体数据存储 | SQLite（knowledge.db） | 结构字段多、需 JOIN 查询、高频更新，.md 不适合 |
| wiki 正文存储 | .md 文件 + frontmatter | 可人工编辑、版本可控、外部工具可读写 |
| 与 codegraph 对接 | 软关联（符号名） | 换引擎无影响，v1 不做校验层 |
| 搜索定位 | QA 引擎内部依赖 | 用户首动作是提问，不是搜实体 |
| 双路 QA 路由 | 保守（阈值 0.85） | 避免误匹配给出错误标准答案 |
| 实体关系来源 | LLM 初始生成 + 人工确认 + QA 共现积累 | 初始可用 + 越用越准 |
| QA ↔ 实体关联 | QA 回答时在线解析 | 实时建立，无需离线脚本 |
| 关系图范围 | 局部邻里图（1-2 跳） | 够用不炫酷，避免全局蜘蛛网 |
| 管理仪表盘 | v2 | 优先级最低 |
| 版本历史 | v2 | 初期不纳入 |

## 附录：用户可见的变化

| 变化 | 旧行为 | 新行为 |
|------|--------|--------|
| 搜索框 | 独立搜索实体 | 不是独立功能，QA 引擎内部用 |
| QA 回答 | 全部走 LLM | 标准问题直接返回 + 绿标 |
| 实体详情页 | 结构化信息平铺 | wiki 正文(.md) + 代码引用/关系图/#Q 面板(结构化数据) 混合渲染 |
| 实体创建 | 仅 LLM 骨架 + 人工填充 | LLM 骨架 → 人工审阅 → 发布流程 |
| 存储 | JSON 文件分散 | knowledge.db 统一 + .md 分工 |
