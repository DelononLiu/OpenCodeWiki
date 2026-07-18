# 数据模型（Data Model）

OpenCodeWiki 使用 **两个 SQLite 数据库** 和 **一个 JSON 注册表文件**，所有文件均存储在 `~/.opencodewiki/` 目录下。

## 数据库概览（Database Overview）

| 数据库（Database） | 文件（File） | 用途（Purpose） | 连接（Connection） |
|---|---|---|---|
| **QA 数据库** | `~/.opencodewiki/qa.db` | QA 条目与校准答案 | `database.get_qa_db()` |
| **知识数据库** | `~/.opencodewiki/knowledge.db` | 实体（Entity）、主题（Topic）、草稿（Draft） | `database.get_knowledge_db()` |
| **注册表（Registry）** | `~/.opencodewiki/registry.json` | 来源元数据（Source metadata） | 文件读写 |

两个 SQLite 数据库均使用 WAL 日志模式以支持并发。

---

## QA 数据库（`qa.db`）

### 表（Table）：`qa_entries`

存储所有问答条目的核心表。

| 列（Column） | 类型（Type） | 约束（Constraints） | 描述（Description） |
|---|---|---|---|
| `id` | TEXT (UUID) | 主键 | 唯一条目 ID |
| `qid` | INTEGER | 唯一, 自增 | 人类可读的顺序 ID |
| `session_id` | TEXT | | SSE 会话标识符 |
| `repo` | TEXT | | 来源仓库名称 |
| `module` | TEXT | | 可选的模块分类 |
| `question` | TEXT | 非空 | 用户问题 |
| `answer` | TEXT | | 生成或校准的答案 |
| `mode` | TEXT | 检查约束('lightweight','deep') | 分析深度 |
| `domain` | TEXT | | 分类标签（general, bug-analysis, build-issue 等） |
| `status` | TEXT | 检查约束('active','pending','archived') | 生命周期状态 |
| `parent_qid` | INTEGER | | 用于追问 |
| `related_qids` | TEXT (JSON) | | 相关 QID 数组 |
| `tags` | TEXT (JSON) | | 标签数组 |
| `sources` | TEXT (JSON) | | 来源引用数组 |
| `visit_count` | INTEGER | 默认 0 | 热度计数器 |
| `created_at` | TEXT (ISO 8601) | | 创建时间戳 |
| `updated_at` | TEXT (ISO 8601) | | 最后更新时间戳 |
| `answered_at` | TEXT (ISO 8601) | | 答案完成时间戳 |

### 表（Table）：`calibrated_answers`

存储人工审核的金标准答案（带版本控制）。

| 列（Column） | 类型（Type） | 约束（Constraints） | 描述（Description） |
|---|---|---|---|
| `id` | TEXT (UUID) | 主键 | 唯一答案 ID |
| `qa_entry_id` | TEXT (UUID) | 外键 → qa_entries.id | 关联的 QA 条目 |
| `answer` | TEXT | 非空 | 策展的答案内容 |
| `calibrator` | TEXT | | 审核人名称 |
| `reason` | TEXT | | 校准理由 |
| `version` | INTEGER | 默认 1 | 版本计数器 |
| `created_at` | TEXT (ISO 8601) | | 时间戳 |

### 业务规则（QA）

- **QID 生成：** `COALESCE(MAX(qid), 0) + 1`（SQL 中的存储过程）
- **校准：** 设置 `qa_entries.status = 'active'`，并将答案同时存储在两个表中
- **访问追踪：** `bump_visit(qid)` 递增 `visit_count`
- **排序：** 按 `latest`（created_at DESC）或 `popular`（visit_count DESC）
- **分页：** 每页最多 100 条，页码 >= 1
- **JSON 字段：** `tags`、`sources`、`related_qids` 以 JSON 文本存储，读取时解析

---

## 知识数据库（`knowledge.db`）

### 表（Table）：`entities`

表示被发现并记录在案的代码实体（Entity）。

| 列（Column） | 类型（Type） | 约束（Constraints） | 描述（Description） |
|---|---|---|---|
| `slug` | TEXT | 主键 | URL 安全的唯一标识符 |
| `name` | TEXT | | 人类可读的名称 |
| `definition` | TEXT | | 简短定义 |
| `status` | TEXT | 检查约束('draft','reviewed','published') | 生命周期 |
| `project` | TEXT | | 关联项目 |
| `page_type` | TEXT | | 实体类型分类 |
| `content` | TEXT | | 完整的 Markdown 内容 |
| `search_count` | INTEGER | 默认 0 | 搜索热度 |

### 表（Table）：`entity_files`

将实体（Entity）与其源文件关联。

| 列（Column） | 类型（Type） | 约束（Constraints） | 描述（Description） |
|---|---|---|---|
| `entity_slug` | TEXT | 主键（复合）, 外键 → entities.slug |
| `path` | TEXT | 主键（复合） | 相对于仓库根目录的文件路径 |
| `symbols` | TEXT (JSON) | | 该文件中定义的符号 |

### 表（Table）：`entity_qa`

将实体（Entity）与相关 QA 条目关联。

| 列（Column） | 类型（Type） | 约束（Constraints） | 描述（Description） |
|---|---|---|---|
| `entity_slug` | TEXT | 主键（复合）, 外键 → entities.slug |
| `qid` | INTEGER | 主键（复合）, 外键 → qa_entries.qid |

### 表（Table）：`topics`

聚合的主题单元，用于组织相关的 QA 条目。

| 列（Column） | 类型（Type） | 约束（Constraints） | 描述（Description） |
|---|---|---|---|
| `slug` | TEXT | 主键 | URL 安全的唯一标识符 |
| `name` | TEXT | | 显示名称 |
| `description` | TEXT | | 主题摘要 |
| `status` | TEXT | 检查约束('pool','published') | 生命周期: pool（集合） → published（已发布） |
| `wiki_module` | TEXT | | 发布目标 Wiki 模块 |
| `qa_count` | INTEGER | 默认 0 | 关联的 QA 条目数量 |
| `created_at` | TEXT (ISO 8601) | | 创建时间戳 |
| `updated_at` | TEXT (ISO 8601) | | 最后更新时间戳 |
| `published_at` | TEXT (ISO 8601) | | 发布时间戳 |

### 表（Table）：`topic_qa`

将主题（Topic）与其组成的 QA 条目关联。

| 列（Column） | 类型（Type） | 约束（Constraints） | 描述（Description） |
|---|---|---|---|
| `topic_slug` | TEXT | 主键（复合）, 外键 → topics.slug |
| `qid` | INTEGER | 主键（复合）, 外键 → qa_entries.qid |

### 表（Table）：`topic_drafts`

表示主题准备发布到 Wiki 时的草稿审核工作流。

| 列（Column） | 类型（Type） | 约束（Constraints） | 描述（Description） |
|---|---|---|---|
| `topic_slug` | TEXT | 主键, 外键 → topics.slug | 每个主题一个草稿 |
| `raw_content` | TEXT | | 从聚合的 QA 自动生成 |
| `edited_content` | TEXT | | 人工编辑的版本 |
| `status` | TEXT | 检查约束('pending','approved','rejected') | 审核状态 |
| `reviewer` | TEXT | | 审核人名称 |
| `reviewed_at` | TEXT (ISO 8601) | | 审核时间戳 |
| `created_at` | TEXT (ISO 8601) | | 创建时间戳 |
| `updated_at` | TEXT (ISO 8601) | | 最后更新时间 |

### 业务规则（主题）

- `INSERT OR IGNORE` 用于主题和链接，防止重复
- 每个主题一行 `topic_drafts`（采用 INSERT OR REPLACE 语义）
- 发布要求：草稿审核通过 → 设置 status='published' 并附带 wiki_module
- 主题的 slug 是所有关联表中的稳定键

---

## JSON 注册表（`registry.json`）

基于文件的元数据存储，用于导入的来源。

**位置：** `~/.opencodewiki/registry.json`

**格式：** JSON 数组：

```json
[
  {
    "name": "my-project",
    "type": "code",
    "url": "https://github.com/user/my-project.git",
    "created_at": "2025-07-18T10:00:00Z",
    "updated_at": "2025-07-18T10:00:00Z"
  }
]
```

**字段：**
- `name` — 唯一，创建后不可变
- `type` — `"code"` 或 `"docs"`
- `url` — 可选的 git URL
- `created_at` — 不可变
- `updated_at` — 同步时更新

**CRUD：** `backend/stores/sources.py` — 按名称线性搜索，`update_source` 保护不可变字段。

---

## Wiki 页面（基于文件）

Wiki 页面以 **Markdown (`.md`) 文件** 形式存储在 `~/.opencodewiki/pages/` 目录下。

| 类型（Type） | 目录（Directory） | 内容来源（Content Source） |
|---|---|---|
| `entity` | `entities/` | 由 wiki_builder 生成 |
| `overview` | `overviews/` | 仓库概览 |
| `qa-archive` | `qa-archives/` | 已发布的 QA 归档 |
| `uploaded` | `uploaded/` | 手动上传的文档 |
| `sources/{name}` | `sources/` | 导入的文档来源 |

页面操作：`stores/wiki.py` — `read_page`, `write_page`, `list_pages`, `page_path`。

---

## 实体关系图

```
来源（registry.json）
  │ name（主键）
  │ type: code|docs
  ▼

QA 条目（qa.db: qa_entries）
  │ qid（主键，自增）
  │ status: pending|active|archived
  │ domain: general|bug-analysis|build-issue|...
  │
  ├── 1:N → calibrated_answers（qa.db）
  │     带版本控制的金标准答案
  │
  └── N:M → 主题（knowledge.db: topic_qa）
        │
        ▼
主题（knowledge.db: topics）
  │ slug（主键）
  │ status: pool|published
  │
  └── 1:1 → topic_drafts（knowledge.db）
        │ status: pending|approved|rejected
        │ raw_content → edited_content
        │
        ▼
Wiki 页面（磁盘上的 .md 文件）
  │ slug → path 映射
  │ 关联到 wiki_module
```

## 变更指南

| 变更（Change） | 注意事项（Watch Out For） |
|---|---|
| 向 qa_entries 添加列 | 更新 `create_entry`、`list_entries`、`_parse_json` |
| 添加主题状态 | 更新 CHECK 约束 + `stores/topics.py` CRUD |
| 新 Wiki 页面类型 | 在 `stores/wiki.py` 中添加目录映射 |
| 添加来源类型 | 更新 `source_importer.py` 导入函数 |
| 模式迁移（Schema migration） | SQLite 仅支持 ALTER TABLE ADD COLUMN — 不支持 DROP |