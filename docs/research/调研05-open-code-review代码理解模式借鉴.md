# 从 open-code-review 学习代码理解模式

> 调研日期：2026-06-25
> 目标：分析 open-code-review（Go CLI 代码审查工具）的代码理解机制，提炼可借鉴到 OpenCodeWiki 的设计模式

---

## 一、两种代码理解范式的本质差异

| 维度 | OpenCodeWiki（当前） | open-code-review |
|------|---------------------|------------------|
| **理解范式** | 系统搜索 → LLM 回答（RAG 管线） | LLM 驱动搜索 → LLM 分析（Agent 式） |
| **LLM 角色** | 被投喂上下文的消费者 | 自主探索的分析师 |
| **搜索时机** | 预先确定的固定管线 | 运行时按需调用 |
| **理解深度** | 一次性，取决于检索质量 | 多轮迭代，越挖越深 |

open-code-review 最核心的设计思想是 **"工具即理解"**——LLM 不是被动接收代码片段，而是像开发者一样自己在代码库里探索，系统提供工具让 LLM 自主决定看什么、怎么看。

---

## 二、6 个最值得借鉴的模式

### 模式 1：Three-Zone 内存压缩

**文件位置**：`internal/llmloop/compression.go`

当 LLM 在深度分析一个文件时，对话很快会撑爆上下文。open-code-review 将对话历史划分为三个区域：

```
冻结区 [系统提示 + 初始问题]    → 永久保留
压缩区 [较旧的中间轮次]         → 异步压缩为摘要
活跃区 [最近 K 轮]              → 完整保留
```

两个水位线控制压缩时机：
- **60%**（`tokenSoftThreshold`）→ 后台异步压缩，不阻塞主 LLM 循环
- **80%**（`tokenWarningThreshold`）→ 同步强制压缩

压缩产物是一个结构化的 XML摘要，包含五个维度：已识别的问题、工具调用结论、已完成任务、待办事项、当前焦点。

```xml
<previous_review_summary>
  已识别的问题：...
  工具调用结论：...
  已完成任务：...
  待办事项：...
  当前焦点：...
</previous_review_summary>
```

**对我们有什么用？**
OpenCodeWiki 目前是单轮 Q&A。如果未来要做**多轮深度分析**（追问"再深入看看某某函数的调用链"），没有压缩机制的话第三轮对话就会撑爆上下文。这个压缩模式可以直接复用到 `qa-resolver.ts` 的多轮场景。

**借鉴方案**：
- `qa-endpoint.ts` 的 SSE 流式对话可以引入 MessageHistory 分区
- 超过阈值后，将历史对话中的工具调用和搜索结果压缩为摘要
- 异步压缩的设计特别适合 SSE——后台压缩的同时，前台继续接收 LLM 的流式输出

---

### 模式 2：工具定义即策略

**文件位置**：`internal/config/toolsconfig/tools.json`

open-code-review 的每个工具描述不是简单的功能说明，而是**把使用策略直接编码进接口契约**。这是最精巧的设计之一。

以 `file_read` 为例，描述中包含：

> `start_line` 和 `end_line` 用于限定行范围。它们依据 diff 的 `@@ -x,y +m,n @@` 头部来判断。被删除的行用**旧**行号，新增/未改的行用**新**行号。

以 `code_search` 为例，描述末尾：

> 如果结果过多，尝试用 `file_patterns` 缩小范围，比如只搜 `*.go` 或排除 `*_test.go`。

每个工具还有 `plan_task` / `main_task` 标志，控制在计划阶段和执行阶段是否可用。这样不同阶段给 LLM 暴露不同的工具集。

**对我们有什么用？**
OpenCodeWiki 的 `cbm-bridge.ts` 目前只是把 codebase-memory-mcp 的命令翻译成工具调用，工具描述很单薄。如果能像 open-code-review 一样给每个工具写**丰富的策略性描述**，LLM 和 ACP Agent 会更高效地使用这些工具。

**借鉴方案**：
- 在 `cbm-bridge.ts` 中，给每个映射命令增加详细描述
- 描述中写入使用技巧：比如 `search_graph` 可以用 camelCase 分词、可以指定 label 过滤
- 如果引入 ACP Agent 模式，策略描述会直接提升 Agent 自主探索效率

---

### 模式 3：多阶段流水线：计划 → 执行 → 过滤

**文件位置**：`internal/agent/agent.go`

这是代码理解的质量保障机制，分为三个阶段：

```
阶段1: 计划（diff > 50 行时触发）
  → LLM 产出 JSON 计划：变更摘要 + 风险点 + 建议工具调用
  → 计划被注入到阶段2的提示中

阶段2: 主任务（始终运行）
  → LLM 按计划探索代码库，使用工具，产出评审意见

阶段3: 审查过滤（单独 LLM 调用）
  → 原则："伪造（falsify），而非验证（verify）"
  → 只过滤掉根据 diff 就能确定是错的评论
  → 不试图验证评论是否正确——只清除明显错误的
```

**对我们有什么用？**
OpenCodeWiki 的 `qa-resolver.ts` 已有两阶段（意图分析 → 阶段1搜索 → LLM 过滤 → 阶段2搜索 → 生成），但缺少**自我纠正环节**。

借鉴方案——在生成答案后增加"事实核查"步骤：

```
当前：意图分析 → 搜索 → LLM过滤 → 深搜 → 生成答案
改进：意图分析 → 搜索 → 生成 → 事实核查 → 修正/确认
```

事实核查的内容：
- 答案中引用的代码位置（`file:line`）是否确实存在
- 引用的函数/类名是否拼写正确
- 引用的代码片段是否能支撑结论

---

### 模式 4：LLM 辅助的代码引用定位

**文件位置**：`internal/diff/relocation.go` + `internal/diff/resolver.go`

这是最务实的模式。LLM 生成的评论/回答中常包含一个代码片段（`existing_code`），系统需要把它定位到具体文件和行号。open-code-review 做了三层回退：

```
尝试 1：基于 diff hunk 匹配
  → 解析 hunk 结构，在新侧（添加+上下文行）和旧侧（删除行）中匹配

尝试 2：匹配完整文件内容
  → 逐行扫描完整文件内容寻找连续匹配

尝试 3：LLM 辅助重新定位
  → 把定位问题丢回给 LLM："以下代码片段在 diff 中哪个位置？"
  → LLM 返回精确的代码片段
  → 用新片段重试解析
```

**对我们有什么用？**
你的 Q&A 回答也会引用代码位置，目前这些引用是 LLM 直接生成的，有时不准。可以引入类似的"引用验证"机制。

**借鉴方案**：
- 在 `qa-endpoint.ts` 的后处理阶段（`sourceResolver`）增加验证步骤
- LLM 给出 `file:line` 引用后，系统尝试从磁盘读取对应行
- 如果发现该行内容与描述不符，标记为"待确认"或让 LLM 修正
- 引用验证的结果可以作为 SSE 的 `sources` 事件的补充信息推送给前端

---

### 模式 5：截断透明度

**文件位置**：`internal/tool/file_read.go`

当文件太大时，open-code-review 不是默默截断，而是**明确告知 LLM**：

```
IS_TRUNCATED: true
LINE_RANGE: 1-500
Total lines: 2341
```

这让 LLM 知道"这只是文件头部 500 行，后面还有 1841 行"，它可以主动调用 `file_read` 去读其他段落。

**对比我们当前的做法**：
搜索达到结果上限时，系统只是默默截断，LLM 不知道还有更多内容。

**借鉴方案**：
- 在搜索结果的注入格式中加入 `total_matches`、`returned_count`、`truncated` 字段
- 当结果被截断时，LLM 知道可以换更精确的关键词重新搜索
- 这实质上给了 LLM 一个"信号"，让它能自主决定是否要深化搜索

---

### 模式 6：状态感知的上下文注入

**文件位置**：`internal/agent/agent.go:584-608`

在给 LLM 的提示中，除了当前分析的代码，还注入一个带状态的周边上下文：

```
MODIFIED   src/lib/utils.go
ADDED      src/lib/constants.go
RENAMED    src/old_name.go → src/new_name.go
DELETED    src/legacy.go
```

LLM 一看就知道：
- 还有哪些文件被改动了
- 每个文件的变化类型（新增/修改/删除/重命名）
- 可以主动调用 `file_read_diff` 或 `code_search` 去交叉引用

**对我们有什么用？**
在 `qa-resolver.ts` 中，搜索结果注入时只是文件列表+代码片段。如果能给每个结果加上**关系标签**，LLM 理解上下文会快得多。

**借鉴方案**：
- 搜索结果的注入格式增加 `relationship` 字段
- 标签示例：`DEFINITION`（定义）、`CALLER`（调用者）、`IMPLEMENTS`（实现）、`REFERENCES`（引用）、`TYPE`（类型声明）
- 这相当于在文本层面为 LLM 建立了一个轻量的调用关系图

---

## 三、现有 RAG 管线可组合使用的小模式

除了上述六大模式，还有几个小巧但实用的机制可以直接嵌入到 OpenCodeWiki 现有的 RAG 管线中：

### 异步结果处理

open-code-review 的 `code_comment` 工具执行是异步的——LLM 提交评论后立即收到"成功"响应，后台线程异步解析行号、收集结果。所有文件都审查完后才 `Await()` 等待全部完成。

**对我们的启发**：当 LLM 生成答案过程中需要同时查询多个代码片段时，可以并行发出搜索请求，异步归并结果，减少 LLM 的等待时间。

### 基于阈值的尺寸保护

open-code-review 在审查前会计算提示的总 token 数，如果超过 `maxTokens * 80%`，跳过该文件而不是截断提示。

**对我们的启发**：在 `qa-resolver.ts` 中，如果搜索结果太多，不要全部塞给 LLM。设定硬性阈值，超过的提前过滤掉，并告知 LLM 被过滤的数量。

### 异步后台压缩

open-code-review 在 `compression.go` 中用了两个阶段的设计：
- 第一次达 60% 阈值时启动后台 goroutine 压缩
- 在下一次 LLM 调用前检查后台压缩是否完成
- 如果中间又有新消息（LLM 调用期间），追加到已压缩结果后面

**对我们的启发**：SSE 场景很适合这个模式——用户在看流式输出的同时，后台可以压缩历史对话，对用户无感。

---

## 四、学习优先级建议

| 优先级 | 模式 | 改动量 | 收益 | 涉及文件 |
|--------|------|--------|------|----------|
| ⭐⭐⭐ | **工具定义即策略** | 小 | 高 | `cbm-bridge.ts`（工具描述增强） |
| ⭐⭐⭐ | **截断透明度** | 小 | 高 | `qa-resolver.ts`（搜索注入格式） |
| ⭐⭐⭐ | **引用验证**（LLM 引用后做事实核查） | 中 | 高 | `qa-endpoint.ts`（后处理阶段） |
| ⭐⭐ | **Three-Zone 压缩** | 大 | 中 | `qa-endpoint.ts`（多轮支持） |
| ⭐⭐ | **多阶段自我纠正** | 中 | 中 | `qa-resolver.ts`（增加事实核查步骤） |
| ⭐⭐ | **状态感知上下文注入** | 中 | 中 | `qa-resolver.ts`（搜索结果格式） |
| ⭐ | **LLM 自主探索**（给 LLM tool-use 能力） | 大 | 看场景 | ACP Agent 模式扩展 |

---

## 五、总结

open-code-review 最值得我们学习的不是具体技术栈（Go vs TypeScript），而是**代码理解层面的设计哲学**：

1. **让 LLM 从"被动接收上下文"变成"主动探索代码库"**——工具即是理解的延伸
2. **策略编码到接口**——工具描述不仅仅是签名，而是使用指南和最佳实践
3. **多层纠错机制**——定位不准就重试、评论有误就过滤、内容太多就告知
4. **异步不阻塞**——后台压缩、后台定位、后台收集，主 LLM 循环畅通无阻

这些是代码理解能力的"元能力"——不管用什么检索技术（grep 也好、AST 索引也好、向量搜索也好），这些模式都能提升 LLM 理解代码的深度和可靠性。

---

## 附录：参考文件路径（open-code-review 仓库）

| 模式 | 关键文件 |
|------|----------|
| Three-Zone 压缩 | `internal/llmloop/compression.go` |
| 工具定义系统 | `internal/config/toolsconfig/tools.json` |
| 多阶段流水线 | `internal/agent/agent.go` |
| 代码定位重试 | `internal/diff/relocation.go`、`resolver.go` |
| 文件读取 | `internal/tool/file_read.go`、`internal/tool/filereader.go` |
| 代码搜索 | `internal/tool/code_search.go` |
| 文件查找 | `internal/tool/file_find.go` |
| 差异读取 | `internal/tool/file_read_diff.go` |
| 异步评论处理 | `internal/llmloop/loop.go`（第 268-333 行） |
| 差异解析 | `internal/diff/parser.go`、`internal/diff/hunk.go` |
| 模板系统 | `internal/config/template/prompts/` |
