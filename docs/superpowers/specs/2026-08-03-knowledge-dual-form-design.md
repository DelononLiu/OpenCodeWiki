# 知识库双形态闭环设计（3 输入 × 2 输出 + 个人/团队分层）

> 日期：2026-08-03
> 状态：设计定稿，待评审
> 关联记忆：[[ultimate-goal]]（代码即源头、问答即编辑、Wiki 即知识）

---

## 1. 背景与洞见

现有系统是"代码库接入 → QA 问答 → Topic 聚合 → Wiki 沉淀"的单向窄管道：

- QA 沉淀只有一条路：QA 校准 → Topic 聚合 → 草稿审核 → **md 文章**
- 没有"碎片知识"输入（个人笔记无法进入系统）
- 没有"卡片"概念（knowledge.db 只有 entities/topics/drafts）
- 没有用户概念（无认证，"个人/团队"无从谈起）

**新洞见**：知识库系统是 **QA ↔ 知识库 两极闭环**，输入和输出各有两个：

```
输入(3)                       输出(2)
──────                       ──────
代码库（系统，自动）  ──▶  卡片（原子知识单元）
QA 问答（个人）       ──▶  文章（结构化沉淀）
碎片知识（个人）
```

- 输入与输出**可交叉映射**：QA 大多沉淀为文章，也可以沉淀为卡片；碎片大多沉淀为卡片，也可以聚合为文章；代码库自动生成实体文章。
- 归属分层：**QA 记录、碎片知识是个人**的原始素材；**卡片、文章是团队**的公共资产。个人也可以直接新增团队卡片。
- 核心理念延续"审核缓冲区隔离质量"：**卡片低门槛直发团队，文章走审核流**。

价值判断：该模型把单向窄管道升级为通用知识闭环，补齐碎片输入与卡片形态两个真实空缺，个人/团队分层与远期权限体系路线兼容。

## 2. 目标架构总览

**统一知识项模型（单域）**：知识库里只有一种实体 `KnowledgeItem`，由三个正交维度描述：

| 维度 | 取值 | 含义 |
|---|---|---|
| `form` | `card` \| `article` | 形态：卡片（原子） / 文章（结构化） |
| `scope` | `personal` \| `team` | 归属：个人私有 / 团队公开 |
| `status` | `draft` \| `pending` \| `published` | 状态：草稿 / 待审 / 已发布 |

**碎片 = 个人卡片**（技术上统一）：捕获一段碎片即创建 `form=card, scope=personal` 的知识项（收件箱）；"沉淀为团队卡片" = `publish` 动作把 scope 翻转为 team，免审直发。碎片不再有独立表。

**弱化"空间"概念**：scope 是权限元数据，不是 UI 导航范式。UI 不出现"个人空间/团队空间"，所有内容混排于统一视图，靠轻量标识（「仅自己可见」/「团队」）区分。

**架构选择**：方案 1（统一知识项模型）—— 单一 SQLite 数据库承载全部实体；方案 2（输入输出分域双库）与方案 3（文档型存储）因跨域引用复杂、关系完整性弱被否决。

## 3. 数据模型

单一 SQLite 数据库（WAL 模式）：

### users

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT (UUID) | 主键 |
| username | TEXT | 唯一 |
| password_hash | TEXT | 加盐哈希（bcrypt） |
| role | TEXT | `admin` \| `user` |
| created_at | TEXT | 创建时间 |

### qa_records（原料：个人对话记录）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT (UUID) | 主键 |
| owner_id | TEXT (FK → users) | 归属用户 |
| session_id | TEXT | SSE 会话标识 |
| question | TEXT | 用户问题 |
| answer | TEXT | 生成或校准的答案 |
| status | TEXT | `active` \| `archived` |
| tags / sources | TEXT (JSON) | 标签 / 来源引用 |
| created_at / updated_at | TEXT | 时间戳 |

### knowledge_items（唯一输出实体）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT (UUID) | 主键 |
| title | TEXT | 标题 |
| content_md | TEXT | Markdown 内容 |
| form | TEXT | `card` \| `article` |
| scope | TEXT | `personal` \| `team` |
| status | TEXT | `draft` \| `pending` \| `published` |
| owner_id | TEXT (FK → users) | 作者 |
| created_at / updated_at / published_at | TEXT | 时间戳 |

### item_links（引用图 / backlink）

| 列 | 类型 | 说明 |
|---|---|---|
| source_id | TEXT (FK → knowledge_items) | 复合主键 |
| target_id | TEXT (FK → knowledge_items) | 复合主键 |
| type | TEXT | `references`（引用） \| `derived_from`（沉淀来源） |

QA 记录、碎片、代码实体对知识项的沉淀痕迹也用 `derived_from` 表达。碎片与代码实体本身即知识项（`references` 即可）；**QA 记录不是知识项**，需要在 `item_links` 上记录来源类型（`source_type: qa_record` + 来源 id）以区分，或独立 `item_derivations` 映射表记录"QA 记录 → 知识项"。

### review_tasks（审核队列）

| 列 | 类型 | 说明 |
|---|---|---|
| item_id | TEXT (FK → knowledge_items) | 主键 |
| reviewer_id | TEXT (FK → users) | 审核人（admin） |
| action | TEXT | `approved` \| `rejected` |
| reason | TEXT | 审核理由 |
| created_at / reviewed_at | TEXT | 时间戳 |

## 4. 生命周期与沉淀动作

```
输入（原料）                    沉淀动作                        输出（知识项）
─────────                    ─────────                       ──────────
QA 记录（个人对话）  ─「沉淀为卡片」─▶ AI 提炼 → 个人卡片 → 发布 → 团队卡片
                    ─「沉淀为文章」─▶ AI 起草 → 文章草稿 → 提交审核 → 团队文章
碎片（文本捕获）    ─「发布」───────▶ 个人卡片 → 团队卡片（免审直发）
                    ─「聚合为文章」─▶ 选多张卡片 → AI 起草 → 审核 → 团队文章
代码库（系统）      ─「自动生成」───▶ 实体文章 → 待审 → 审核 → 团队文章
```

| 动作 | 输入 | 输出 | 审核 |
|---|---|---|---|
| 发布卡片 | 个人卡片 / 碎片 | 团队卡片 | 免审（低门槛） |
| 沉淀为卡片 | QA 记录 | 个人卡片 | 免审（AI 提炼，用户确认） |
| 起草文章 | 卡片组 / QA 记录 | 文章草稿（引用源） | 提交后走审核 |
| 自动生成 | 代码实体 | 实体文章 | 待审（管理员可批量通过） |

- 文章草稿 = `scope=personal, status=draft`；提交 → `pending` 进审核队列；admin 批准 → `status=published, scope=team`。**审核通过的瞬间就是个人→团队的边界**。
- 每次沉淀记 `derived_from` 链接，知识可回溯到原料；文章引用卡片记 `references`，可反查（backlink）。
- **Topic 概念被取代**：聚合职责由"选卡片组 → 起草文章"承担，`topics`/`topic_drafts` 状态机（pool→published）不再需要。

## 5. 认证与权限

| 项 | 设计 |
|---|---|
| 认证 | 用户名+密码（本地 bcrypt 哈希）；登录返回会话（JWT 或 HttpOnly Cookie）；所有 `/api/*` 请求鉴权 |
| 注册 | 开放注册（内网自托管，注册即登录）；**首个注册用户自动成为 admin**；管理员可停用用户 |
| 读 | `scope=team` 全员可读；`scope=personal` 仅 owner 可读（含 QA 记录、碎片、草稿） |
| 写 | 自己的私有内容任意编辑；团队内容**发布后只读**，修改需 admin 或作者重新走审核 |
| 审核 | `pending → approved/rejected` 仅 admin 可操作；卡片免审 |

**边界规则一句话：读 = 团队公开 + 自己的私有；写 = 自己的私有任意，团队的发布后锁。**

## 6. 检索 / RAG

- 问答检索（RAG）**只检索 `scope=team`** 的内容 —— 个人碎片/草稿不污染他人的回答。
- 检索结果可为卡片或文章（两者都进向量库），回答时优先引用已发布文章，卡片作为补充来源。
- 引用图（item_links）作为检索重排的辅助信号（远期：backlink 加权）。

## 7. 前端页面结构

### 侧边栏导航（定稿顺序）

```
新问题      /qa           ← 问答（个人 QA 记录 + SSE 对话）
我的碎片    /fragments    ← 捕获入口（个人卡片收件箱，沉淀动作发起处）
Wiki        /wiki         ← 文章：实体文章 + 沉淀文章 + 文档
知识沉淀    /admin        ← 审核台（管理员）：待审文章/草稿
知识卡片    /cards        ← 卡片流：团队公开 + 自己私有，带可见性标识
知识库      /sources      ← 知识库/来源管理
```

- 侧边栏底部当前写死的用户信息（`Long / long@example.com`）替换为真实登录态 + 退出登录。
- 不出现"空间"导航；scope 差异只以可见性标识（「仅自己可见」/「团队」）呈现。

### 页面

| 页面 | 路由 | 内容 |
|---|---|---|
| 登录 / 注册 | /login, /register | 用户名+密码 |
| 问答 | /qa | 现有对话 + 沉淀按钮（沉淀为卡片 / 沉淀为文章） |
| 我的碎片 | /fragments | 碎片列表（文本捕获输入框 + 卡片视图）、发布/聚合为文章动作 |
| Wiki | /wiki | 文章浏览（现有文档树保留） |
| 审核台 | /admin | 待审文章列表、批准/驳回、实体文章批量审核 |
| 卡片 | /cards | 卡片流（团队 + 自己，可按形态/可见性过滤）、新增卡片、卡片详情（含 backlink） |
| 知识库 | /sources | 来源管理（现有） |

## 8. 分期

- **第一期（核心闭环）**：用户体系（注册/登录/首用户 admin）+ knowledge_items 单域模型 + 碎片文本捕获 + 沉淀动作（QA→卡片、碎片→卡片、卡片组→文章草稿）+ 审核台 + RAG 团队层过滤。链接剪藏、文件导入不做。
- **第二期（输入增强）**：链接剪藏、文件导入；卡片聚合的 AI 起草增强；backlink 检索加权。
- **远期**：角色矩阵（viewer/editor/admin）、离职数据迁移、权限体系深化。

## 9. 对现有系统的替代关系

| 现有概念 | 目标态 |
|---|---|
| `qa_entries`（全局共享） | `qa_records`（按 owner 隔离） |
| `entities` + wiki_builder | 代码输入 → 实体文章（knowledge_items, form=article） |
| `topics` / `topic_drafts` 状态机 | 被"文章草稿（引用卡片组）+ review_tasks"取代 |
| Wiki 页面（磁盘 .md） | knowledge_items.content_md（DB 存储，可导出 md） |
| 无认证 | users + 会话鉴权 |
