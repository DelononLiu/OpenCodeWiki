# 调研 03：Agent 框架选型

## 结论

**后端使用 Python LangGraph + FastAPI，与 kcode 扩展（LangGraph.js）共享 LangGraph 生态。**

---

## 背景

当前的 LLM 模式（`qa-endpoint.ts`）是一锤子买卖：搜一次代码 → 拼 prompt → 调 LLM → 结束。  
`qa-resolver.ts` 写了 600 行手动编排每个意图类的搜索策略，但 LLM 始终没有机会自己决定"搜什么"。

---

## 为什么选 Python LangGraph

| 原因 | 说明 |
|------|------|
| **框架成熟度** | LangGraph Python 是亲儿子，功能最全、更新最快、文档最丰富 |
| **生态优势** | Python 的 LLM/ML 生态碾压 TS——LangChain/HuggingFace/vLLM 都是 Python 原生 |
| **Agent 能力** | StateGraph/Persistence/Checkpoint/Human-in-loop 全部完整 |
| **多 Agent** | Supervisor/Swarm/子图——Python 版最先出，JS 版后来跟 |
| **已有 Python 代码** | `scripts/crg-wiki.py` 已存在，引入 Python 服务门槛低 |
| **与 kcode 统一** | 都是 LangGraph，API 理念一致，方便两边同步经验 |

---

## 架构

```ascii
┌──────────────────────────────────────────────────────────┐
│            TS 层（保持现有，端口 4747）                    │
│                                                          │
│  Express API                                             │
│  ├── codegraph-bridge（9 路由） ← Agent 调工具也走这里    │
│  ├── qa-endpoint                                         │
│  │   ├── ACP 模式（保留 fallback）                        │
│  │   ├── 纯 LLM 模式（保留 fallback）                     │
│  │   └── 新增：转发 Python Agent 的 SSE 流到前端          │
│  └── /api/qa-agent → 代理到 FastAPI                       │
└─────────────────────┬────────────────────────────────────┘
                      │ HTTP + SSE
                      ▼
┌──────────────────────────────────────────────────────────┐
│         Python 层（新增 FastAPI 服务，端口 8000）          │
│                                                          │
│  POST /agent/qa                                          │
│    → LangGraph Agent                                     │
│        │                                                 │
│        ├── StateGraph 定义：                              │
│        │   analyze → search → (deeper?) → answer         │
│        │                    ↑__________↓                 │
│        │                                                 │
│        ├── 工具：通过 httpx 调 TS 的 codegraph API         │
│        │   - code_search     → POST /api/search           │
│        │   - code_context    → POST /api/context          │
│        │   - code_caller     → POST /api/callers          │
│        │   - code_callee     → POST /api/callees          │
│        │   - code_impact     → POST /api/impact           │
│        │   - code_files      → POST /api/files            │
│        │   - code_node       → POST /api/node             │
│        │   - code_explore    → POST /api/explore          │
│        │   - code_status     → GET /api/status            │
│        │                                                 │
│        └── 流式返回 → SSE → TS 层 → 前端                   │
└──────────────────────────────────────────────────────────┘
```

## 需要改的文件

| 文件 | 改动 |
|------|------|
| `src/` | 新增 `python-agent/` 目录 |
| → `python-agent/main.py` | FastAPI 应用入口 |
| → `python-agent/agent.py` | LangGraph StateGraph 定义 |
| → `python-agent/tools.py` | codegraph 工具注册（httpx 调 TS） |
| → `python-agent/requirements.txt` | langgraph, fastapi, httpx, uvicorn |
| `src/server/qa-endpoint.ts` | 新增路由 `/api/qa-agent` 转发到 Python |
| `package.json` | 无新增依赖（Python 侧管理） |

### 不需要改的

- `codegraph-bridge.ts` — 9 个 API 路由完全不变
- ACP fallback 逻辑 — 保持不动
- 前端 — SSE 格式不变，TS 层做透明代理

---

## 部署

```bash
# 现有 TS 服务
npm run dev

# 新增 Python 服务
cd src/python-agent
uvicorn main:app --port 8000

# Docker（最终形态）
# 一个容器两个进程 / docker compose 两个容器
```

---

## 分阶段实施

1. **Phase 1**：搭 Python FastAPI + 最简单的 `create_react_agent`，把 9 个工具注册进去，验证端到端
2. **Phase 2**：按问题类型分 StateGraph 路径（排错走 deep dive，查询走轻量）
3. **Phase 3**：效果稳定后，逐步减少 `qa-resolver.ts` 的手动编排
