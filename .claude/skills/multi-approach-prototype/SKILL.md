---
name: multi-approach-prototype
description: 多方案并行竞标开发模式 — 对同一需求让多个 subagent 各自在独立 worktree 中实现不同方案，最后集合并选最优
---

# 多方案并行竞标开发模式（Multi-Approach Prototype）

## 适用场景

当需求有多种可能的 UI 或交互方案，不确定哪种最好时。典型触发词：
- 「出三套方案看看」
- 「先出 UI，用假数据」
- 「几个方案竞标」
- 「A/B/C 三种方式，分别实现」

## 流程

### 阶段 1：方案设计（brainstorming）

先调用 `superpowers:brainstorming`，产出 2-3 套差异化方案，**每种方案必须有明确的交互理念差异**（不是微调配色/位置）。

与用户确认每套方案的核心理念，获得批准。

### 阶段 2：创建分支 + worktree

```bash
# 从当前 feature 分支分出三个方案分支
git branch <方案A分支名> <基分支>
git branch <方案B分支名> <基分支>
git branch <方案C分支名> <基分支>

# 创建 worktree
git worktree add .claude/worktrees/<方案A> <方案A分支名>
git worktree add .claude/worktrees/<方案B> <方案B分支名>
git worktree add .claude/worktrees/<方案C> <方案C分支名>
```

分支命名规则：`<feature>-<approach-a|b|c>`（如 `qa-feedback-inline`）

### 阶段 3：并行派发 subagent

使用 Agent 工具启动 3 个 `general-purpose` subagent，`run_in_background: true`。

每个 agent 的 prompt 必须包含：
1. **worktree 路径** — 明确 `cd` 到哪个目录工作
2. **方案核心理念** — 一句话说明交互理念
3. **端口** — 不同方案用不同端口（当前端口+1/+2/+3）
4. **组件清单** — 需要创建哪些组件，Props 签名
5. **假数据类型** — mockData.ts 的结构
6. **集成位置** — 需要修改哪个页面，怎么集成
7. **约束** — 不修改后端、不做真实 API 调用

> **关键**：每个 agent 的 prompt 要自包含，不依赖对话上下文。

### 阶段 4：评审

三个 agent 完成后，同时启动三个 dev server：

```bash
cd .claude/worktrees/<方案A>/frontend && npm run dev
cd .claude/worktrees/<方案B>/frontend && npm run dev
cd .claude/worktrees/<方案C>/frontend && npm run dev
```

让用户逐个查看，记录反馈：
- 哪些交互好
- 哪些需要改
- 用户倾向哪个方向

### 阶段 5：融合实现

根据用户反馈，在**原始 feature 分支**上合并实现最终方案：

1. 分析每个方案的实现文件，提取精华
2. 逐一创建最终组件（可复用 worktree 中的代码）
3. 修改集成页面
4. 编译验证

```bash
git checkout <原始feature分支>
# 逐一创建组件，不动 worktree
```

### 阶段 6：收尾

```bash
# 保留 worktree 供参考，或删除
git worktree remove .claude/worktrees/<方案A>
git branch -D <方案A分支名>
```

## 注意事项

- **后端共用**：所有方案连接到同一个后端，不要 each agent 各自启动后端
- **假数据优先**：UI 用 mockData.ts，不依赖真实 API
- **互不干扰**：每个 worktree 独立 git 分支，agent 之间不用 SendMessage 通信
- **编译检查**：合并后必须 `npx vite build` 验证无报错
- **主分支不动**：worktree 的分支从 feature 分支分出，不污染 main/master

## 与本项目其他 skills 的关系

- 先用 `superpowers:brainstorming` 产出方案
- 再用 `superpowers:using-git-worktrees` 创建隔离环境
- 然后本 skill 组织并行开发 + 融合

## 参考实例

见会话记录 `feat/qa-feedback` 分支开发过程：
- 方案 A：Inline Action Bar（`:5181`）
- 方案 B：Floating Feedback Hub（`:5182`）
- 方案 C：Dual Mode Toggle（`:5183`）
- 融合版本：端口 `:5184`
