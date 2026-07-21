# 知识沉淀 v2 — 半自动自进化知识管线

> 状态：待实施 | 日期：2026-07-21

---

## 1. 背景与目标

### 当前问题

知识沉淀（AdminPage `/admin`）是 QA-Wiki-自进化闭环的中转核心，但目前处于半成品状态：

- QA 校准可用但体验粗糙
- Topic 聚合只能通过 API 手动创建，UI 无触发入口
- Draft 提炼缺少 LLM 自动生成能力
- Wiki 变动视图是空壳
- 没有自进化反馈闭环

### 目标

打造半自动知识管线：**LLM 做重活（分析、总结、建议），人做决策（确认、编辑、审批）**。同时补上自进化闭环——Wiki 沉淀后反哺 QA 质量。

---

## 2. 整体管线

```
QA池 ──→ [阶段1: QA校准] ──→ [阶段2: Topic发现] ──→ [阶段3: Draft提炼] ──→ [阶段4: Wiki审核] ──→ Wiki页面
                                                                                    │
                                                                                    ▼
                                                                          [自进化: RAG增强 + 反馈修正]
                                                                                    │
                                                                                    └──→ 反哺QA回答质量
```

单向流转，每阶段有明确的输入输出。管理员逐阶段操作，也可跳转。

### AdminPage 改版：从 Tab 到管线

不再使用三个平级 tab，改为**四阶段纵向管线卡片**：

| 阶段 | 卡片 | 收缩显示 | 展开显示 |
|------|------|---------|---------|
| ① | QA 校准 | 待校准数 badge | QA 列表 + 内联编辑校准答案 |
| ② | Topic 发现 | 未归类 QA 数 badge | 「分析 QA 池」按钮 + 建议列表 |
| ③ | Draft 提炼 | 待提炼 topic 数 badge | Topic 列表 → 展开 → Draft 编辑 |
| ④ | Wiki 审核 | 待审核数 badge | 审核队列 + 预览 + 批准/驳回 |

页面顶部有**四段进度条**显示整体完成度。

---

## 3. 后端 API 设计

### 新增端点

```
POST   /api/topics/analyze          # LLM 批量分析 QA 池，建议 topic
POST   /api/topics/{slug}/generate   # LLM 按模板生成 Draft
POST   /api/topics/{slug}/submit     # 提交 Draft 到审核队列
POST   /api/topics/{slug}/approve    # 审核通过 → 写入 Wiki + 索引检索库
POST   /api/topics/{slug}/reject     # 审核驳回 → 回到 Draft 可编辑
GET    /api/wiki/review-queue        # 获取待审核队列
GET    /api/wiki/feedback            # 获取 Wiki 反馈统计
```

### 关键端点行为

#### `POST /api/topics/analyze`

无请求体。LLM 扫描全量 `active` QA，按语义聚类：

```json
// 返回
{
  "suggestions": [
    { "slug": "oom-troubleshoot", "name": "OOM 问题排查", "description": "...", "qa_ids": [1,3,5], "is_new": true }
  ],
  "matched": [
    { "slug": "build-issue", "name": "编译构建", "matched_qa_ids": [2,4] }
  ],
  "total_new": 3
}
```

- `is_new: true` → 创建新 topic + 关联 QA
- `is_new: false` → 追加 QA 到已有 topic

#### `POST /api/topics/{slug}/generate`

LLM 按固定模板总结该 topic 下所有 QA：

```markdown
## 概述
（1-2句话概括这类问题）

## 常见场景
（列举典型场景，每条一行）

## 解决方案
（汇总回答中的核心方案）

## 注意事项
（踩坑点/边界情况）
```

写入 `topic_drafts.raw_content`，返回 draft 对象。

#### `POST /api/topics/{slug}/submit`

将 draft 状态从 `pending` 改为 `submitted`，进入审核队列。前端应在此之前调用 `PUT /api/topics/{slug}/draft` 保存编辑。

#### `POST /api/topics/{slug}/approve`

1. 将 draft 内容写入 `~/.opencodewiki/pages/entities/{slug}.md`
2. 将内容分块写入 `qa.db` 的 `wiki_index` 表（FTS5）
3. 更新 topic 状态为 `published`
4. 返回 `{ published: true, slug, wiki_path }`

#### `POST /api/topics/{slug}/reject`

请求体：`{ reason: "内容不完整，请补充示例" }`

- 更新 draft 状态为 `pending`
- 记录 `reject_reason`
- 前端收到后回到 Draft 编辑界面

#### `GET /api/wiki/review-queue`

返回所有 `status = 'submitted'` 的 draft + 关联 topic 信息。

#### `GET /api/wiki/feedback`

返回已发布 Wiki 页面的反馈统计（后续迭代使用）。

### 数据库变更

`knowledge.db` 的 `topic_drafts` 表新增字段：

```sql
ALTER TABLE topic_drafts ADD COLUMN status TEXT DEFAULT 'pending';
-- 枚举: 'pending' | 'submitted' | 'approved' | 'rejected'
ALTER TABLE topic_drafts ADD COLUMN reject_reason TEXT;
ALTER TABLE topic_drafts ADD COLUMN generated_at TEXT;
```

`qa.db` 新增全文索引表：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS wiki_index USING fts5(
  slug,
  chunk_text,
  keywords,
  published_at
);
```

---

## 4. 前端设计

### 组件拆分

```
pages/
├── AdminPage.tsx              # 管线容器（~100行）
└── admin/
    ├── QaCalibrateCard.tsx    # 阶段① QA校准（~80行）
    ├── TopicDiscoverCard.tsx  # 阶段② Topic发现（~120行）
    ├── DraftRefineCard.tsx    # 阶段③ Draft提炼（~150行）
    └── WikiReviewCard.tsx     # 阶段④ Wiki审核（~130行）

components/knowledge/
├── PipelineProgress.tsx       # 四段进度条（纯展示）
└── DraftEditor.tsx            # 左右分栏编辑器（复用）
```

### 各组件职责

| 组件 | 职责 | 关键交互 |
|------|------|---------|
| **AdminPage** | 管线容器，管理全局 PipelineState，顶部进度条 | 协调四卡片数据刷新 |
| **QaCalibrateCard** | 折叠显示计数；展开显示 pending QA 列表 + 内联编辑校准答案 | 校准后刷新计数 |
| **TopicDiscoverCard** | 「分析 QA 池」按钮 + 结果列表（区分"新建议"和"已匹配"）；确认/拒绝建议 | 确认后自动触发 Draft 生成 |
| **DraftRefineCard** | Topic 列表 → 展开 → 左右对比编辑（左：QA 原文，右：Draft 编辑）→ 提交审核 | 生成/编辑/提交 |
| **WikiReviewCard** | 待审核队列 → 预览 → 选择目标模块 → 批准/驳回 | 批准写 Wiki+索引 |

### AdminPage 状态流

```ts
interface PipelineState {
  qaPendingCount: number
  unclassifiedQaCount: number
  topicDraftCount: number
  reviewQueueCount: number
  expandedStage: number | null  // 1-4
}
```

每个卡片通过 `onUpdate` 回调通知 AdminPage 刷新计数。

### API 调用封装

`frontend/src/api/client.ts` 新增：

```ts
export function analyzeTopics(): Promise<{ suggestions: TopicSuggestion[], matched: TopicSuggestion[], total_new: number }>
export function generateDraft(slug: string): Promise<TopicDraft>
export function submitDraft(slug: string): Promise<{ submitted: boolean }>
export function approveDraft(slug: string, wikiModule: string): Promise<{ published: boolean }>
export function rejectDraft(slug: string, reason: string): Promise<{ rejected: boolean }>
export function fetchReviewQueue(): Promise<ReviewItem[]>
```

---

## 5. 自进化闭环

### 5.1 RAG 增强（正向进化）

Wiki 发布后自动纳入 QA 检索：

1. `approve` 时将 Wiki .md 分块写入 `wiki_index` FTS5 表
2. QA 回答时 Agent 先搜索 `wiki_index`，匹配内容作为上下文注入 system prompt
3. 效果：后续提问优先参考已有知识沉淀，减少重复问答

### 5.2 反馈修正（反向进化）

Wiki 被发现问题 → 修正建议 → 重新审核：

1. 触发：管理员手动标记某 Wiki 页面"需修正"
2. LLM 对比原始 Wiki + 关联 QA 数据 → 生成 Diff 建议
3. 在阶段④以"🔄 待修正"标签出现
4. 管理员审核 Diff → 批准后更新 Wiki 页面

> 自动检测逻辑（QA 追问未覆盖、低评分）留到后续迭代。

### 5.3 WikiReviewCard 审核类型

| 类型 | 标签 | 来源 |
|------|------|------|
| 新发布 | 🆕 新 Draft | Draft 提交 |
| 修正建议 | 🔄 待修正 | 手动标记触发 |

---

## 6. 错误处理 & 边界情况

### LLM 调用失败

| 场景 | 处理 |
|------|------|
| `analyze` 超时/报错 | 返回部分结果 + 错误提示，已分析的不回滚 |
| `generate` 超时/报错 | 前端显示"生成失败，点击重试"，保留旧的 draft 内容 |
| 连续失败 3 次 | 前端提示"服务异常，请检查 LLM 配置" |

### 空数据 & 边界

| 场景 | 处理 |
|------|------|
| QA 池为空时点击"分析" | 返回 `{ suggestions: [], message: "无可分析的 QA" }` |
| Topic 下 QA 不足 2 条时生成 Draft | 提示"数据较少，提炼可能不完整"，仍可生成 |
| 目标 Wiki 模块被删除 | approve 时后端校验模块存在，不存在则拒绝 |
| QA 被删除但 topic_qa 关联残留 | 后端 JOIN 查询自动过滤，UI 不展示 |

### 状态一致性

| 场景 | 处理 |
|------|------|
| 重复提交同一 Draft | 后端检查 `status != 'pending'` 时拒绝 |
| 已发布 topic 的 QA 新增 | topic 状态已变为 `published`，不出现在 Draft 卡片 |
| 并发审核同一 Draft | SQLite 写锁串行化，先到先得 |

### 前端容错

- 每阶段卡片独立加载，一个失败不影响其他
- 操作按钮点击后立即 disabled
- API 调用通过统一 `request()` 封装，异常由卡片组件 catch 展示

---

## 7. 涉及文件清单

### 后端

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `backend/main.py` | 修改 | 新增 6 个 API 端点 |
| `backend/stores/topics.py` | 修改 | 新增 analyze、generate_draft、submit/approve/reject |
| `backend/stores/wiki.py` | 修改 | 新增 review_queue、wiki_index 写入 |
| `backend/database.py` | 修改 | FTS5 wiki_index 表初始化 |

### 前端

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/pages/AdminPage.tsx` | 重写 | 从 tab 改为管线容器 |
| `frontend/src/pages/admin/QaCalibrateCard.tsx` | 新建 | 阶段① |
| `frontend/src/pages/admin/TopicDiscoverCard.tsx` | 新建 | 阶段② |
| `frontend/src/pages/admin/DraftRefineCard.tsx` | 新建 | 阶段③ |
| `frontend/src/pages/admin/WikiReviewCard.tsx` | 新建 | 阶段④ |
| `frontend/src/components/knowledge/PipelineProgress.tsx` | 新建 | 进度条 |
| `frontend/src/components/knowledge/DraftEditor.tsx` | 新建 | 左右分栏编辑器 |
| `frontend/src/api/client.ts` | 修改 | 新增 API 调用封装 |

### 数据库

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `knowledge.db` (topic_drafts) | Schema 扩展 | 新增 status, reject_reason, generated_at |
| `qa.db` (wiki_index) | 新建表 | FTS5 全文索引 |

---

## 8. 测试要点

- [ ] `POST /api/topics/analyze` — 空 QA 池、正常聚类、LLM 超时
- [ ] `POST /api/topics/{slug}/generate` — 正常生成、QA 不足 2 条、LLM 超时
- [ ] `POST /api/topics/{slug}/submit` — 正常提交、重复提交拒绝
- [ ] `POST /api/topics/{slug}/approve` — 正常发布、模块不存在、Wiki 文件写入
- [ ] `POST /api/topics/{slug}/reject` — 正常驳回、状态恢复
- [ ] 前端四阶段卡片独立渲染、展开/收缩、进度条联动
- [ ] Draft 编辑器左右分栏内容正确显示

---

## 9. 不做的事（本次迭代）

- 自动反馈检测（QA 追问 → 自动标记 Wiki 需修正）：留到下一迭代
- 向量数据库 / Embedding：继续用 FTS5
- Wiki 页面 Diff 对比 / 回滚：下一迭代
- 管线自动化（定时触发）：保持手动触发
