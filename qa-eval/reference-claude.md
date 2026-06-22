# QA Eval: Claude 参考答案

**问题**: kcode中小助手和任务流的区别
**来源**: Claude Code (Explore agent 模式)

---

## 回答

小助手 vs 任务流：核心区别

下面从几个维度梳理它们的设计差异。

### 一句话概括

小助手 = 无状态的 对话式问答，类似 ChatGPT，一问一答，没有结构化流程
任务流 = 有状态的 结构化工作流，分阶段（目标→方案→执行→自检→评审），附带协议解析、待办、知识提取等能力

### 对比表

| 维度 | 小助手 | 任务流 |
|------|--------|--------|
| 本质 | 开放对话 | 阶段化任务执行 |
| 会话 | 只有一个虚拟 ID __assistant__，所有消息共用 | 每个任务独立 session |
| 系统提示词 | 单段固定 ASSISTANT_SYSTEM_PROMPT | 分阶段多层提示词（goal/plan/execute/self_verify/review） |
| 协议解析 | 无 | 解析 [TASK_UPDATE]、<TODO_UPDATE>、<KNOWLEDGE_ENTRY>、[TASK_DELEGATE] |
| 状态机 | 无（纯问答） | 5 阶段状态机：goal → plan → execute → self_verify → review |
| 消息存储 | 单文件 assistant_messages.json | 每个任务独立存储 |
| 消息压缩 | 有 | 无 |
| 前端渲染 | 独立 assistantPipeline.ts | 共享 V3 renderManager.ts |
| 流式处理 | AssistantStreamHandler | V2StreamHandler（协议解析+阶段触发） |
| 审批流程 | 无 | approve/reject/partial-approve + diff |
| 子任务 | 不支持 | [TASK_DELEGATE] 创建子任务 |
| 知识提取 | 不支持 | 自动提取 <KNOWLEDGE_ENTRY> |
| 进入方式 | 侧边栏、/ai 命令 | 侧边栏、/new、/feature、/debug |

### 消息流

小助手：
```
输入 → AssistantHandler.handleMessage()
  → 拼接 ASSISTANT_SYSTEM_PROMPT + 用户消息
  → 发送到 `__assistant__` session
  → AssistantStreamHandler 简单累加文本
  → 前端 assistantPipeline.ts 渲染消息列表
```

任务流：
```
输入 → TaskSessionHandler.handleSendMessage()
  → TaskFlow 根据当前 phase 构建提示词（buildInitialPrompt / buildPhaseTransitionPrompt）
  → 发送到任务的独立 session
  → V2StreamHandler:
      ├─ TaskFlow.processChunk() 解析协议
      ├─ 发送 cleanText 给前端渲染
      └─ onDone 时触发阶段检查（goal 提了没？execute 完了没？）
  → 前端 V3 stateManager → basePipeline 渲染消息 + 确认卡片
```

### 架构图

```
                   ┌─────────────────────────────┐
                   │         Panel.ts             │
                   │  (消息路由分发)               │
                   └──────┬──────────┬───────────┘
                          │          │
              ┌───────────▼──┐  ┌───▼────────────┐
              │ 小助手       │  │ 任务流          │
              │              │  │                │
              │ Assistant    │  │ TaskSession    │
              │ Handler      │  │ Handler        │
              │              │  │                │
              │ Assistant    │  │ TaskFlow       │
              │ StreamHander │  │ (状态机+协议)   │
              │              │  │                │
              │ assistant    │  │ V2StreamHandler │
              │ Pipeline     │  │ + V3render     │
              │ (独立State-  │  │ (共享State-    │
              │  Manager)    │  │  Manager)      │
              └──────────────┘  └────────────────┘
```

### 何时用哪个

- 小助手：随便问问、快速验证想法
- 任务流：有明确目标、需要方案评审、需要跟踪进度
