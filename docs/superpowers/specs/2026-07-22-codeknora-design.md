# OpenCodeWiki Phase 1 Design

> 基于 WeKnora 架构 + Python/TypeScript 技术栈重写，融合 OpenCodeWiki 的知识闭环理念。
> Phase 1 目标：极简版知识库问答（效果优先，达到或接近 WeKnora 同问题回答质量）。

## 1. 项目定位

OpenCodeWiki 是一个面向团队共用的轻量级知识库问答系统。Phase 1 聚焦核心闭环的前半段：

```
文档导入 → 切片 → 向量化 → 检索 → LLM 问答
```

Phase 2 补齐 QA → 知识库闭环进化能力（参考 OpenCodeWiki 的 QA→Topic→Wiki 管线）。

### 1.1 项目位置

存放在 OpenCodeWiki 仓库的 `codeknora` 分支（Event Pipeline 重构），复用现有 CI 基础设施与前端组件栈。

### 1.2 Phase 1 边界与取舍

以下能力 Phase 1 **不做**，确保范围受控：

| 不做 | 原因 |
|------|------|
| Pipeline 容错/降级 | 先跑通正常流程，异常直接报错 |
| 多轮对话 | 每次 `/api/qa` 请求独立问答，session 仅做记录 |
| Rerank 阶段 | 无 rerank 服务配置时直接跳过，top 5 送入 LLM |
| 异步导入恢复 | `asyncio.create_task`，服务重启丢状态可接受 |
| 跨库事务保证 | chunks(knora.db) + vectors(vectors.db) 可能不一致，接受 |
| 向量维度动态适配 | 建表固定维度，换 embedding model = 删库重建 |
| 认证/多租户 | 团队内用，不需要 |

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 后端运行时 | Python 3.11+ |
| 后端框架 | FastAPI + uvicorn |
| LLM 接入 | OpenAI SDK（兼容多 provider） |
| 数据库 | SQLite（双库：knora.db + vectors.db） |
| 向量存储 | sqlite-vec |
| 全文检索 | SQLite FTS5 |
| 前端框架 | React 18 + TypeScript + Vite |
| UI 组件 | shadcn/ui + Tailwind CSS |
| Prompt 模板 | YAML（直译 WeKnora config/prompt_templates/） |

### 核心依赖

- `fastapi` + `uvicorn` — HTTP + SSE 流式
- `sqlite-vec` — 零依赖向量存储
- `openai` — LLM/Embedding API 调用
- `PyYAML` — 配置与 Prompt 模板
- `pymupdf` / `python-docx` — 文档解析
- `langchain-text-splitters` — 文本切片（仅用 RecursiveCharacterTextSplitter，不引入 LangChain 全栈）

### 不引入的依赖

- **LangGraph / LangChain Agent** — Phase 1 不需要，Event Pipeline 直接替代
- **Redis / asynq** — 异步任务用 `asyncio.create_task`，够用
- **pgvector / PostgreSQL** — Phase 1 SQLite 起步，后续按需升级

## 3. 项目结构

```
OpenCodeWiki/
├── backend/
│   ├── main.py                 # FastAPI 入口 + API 路由
│   ├── config.py               # 配置级联 (env > config.yaml > defaults)
│   ├── database.py             # SQLite 双库初始化
│   ├── pipeline/               # Event Pipeline 核心
│   │   ├── pipeline.py         # Pipeline 引擎 (注册 → 链式执行)
│   │   ├── events.py           # PipelineEvent 上下文模型
│   │   └── plugins/
│   │       ├── base.py         # BasePlugin 抽象基类
│   │       ├── query_understand.py   # 意图识别 + 查询重写
│   │       ├── search.py       # 向量搜索 + FTS5 关键词搜索
│   │       ├── rerank.py       # 重排序 (可选)
│   │       ├── context_build.py # 上下文组装 (Prompt 模板 + 检索结果注入, 无历史)
│   │       └── chat_complete.py # LLM 调用 + SSE Stream 输出
│   ├── knowledge/              # 知识库模块
│   │   ├── importer.py         # 文档导入 (MD/TXT/PDF/DOCX)
│   │   ├── chunker.py          # 文本切片
│   │   ├── embedder.py         # 向量嵌入
│   │   └── vector_store.py     # sqlite-vec + FTS5 封装
│   ├── prompts/                # Prompt 模板 (直译 WeKnora YAML)
│   │   ├── system_prompt.yaml
│   │   ├── rewrite.yaml
│   │   ├── context_template.yaml
│   │   ├── keywords_extraction.yaml
│   │   ├── generate_session_title.yaml
│   │   └── fallback.yaml
│   └── stores/                 # 数据访问层
│       ├── kb.py               # 知识库 CRUD
│       ├── doc.py              # 文档/切片 CRUD
│       └── session.py          # 会话/消息 CRUD
├── frontend/                   # React SPA (复用 OpenCodeWiki 组件栈)
│   └── src/
│       ├── pages/              # QAPage / KBManagePage / SettingsPage
│       ├── components/         # ChatWindow / DocUpload / ... (复用 shadcn/ui)
│       └── api/                # API 客户端 + SSE 订阅
├── config.yaml                 # 主配置文件
└── data/                       # 运行时数据目录
    ├── knora.db                # 业务数据库
    ├── vectors.db              # 向量 + FTS5 数据库
    └── files/                  # 上传文档存储
```

## 4. Event Pipeline 核心架构

Phase 1 的核心：事件驱动的链式处理管线，直接对应 WeKnora 的 `chat_pipeline`。

### 4.1 Pipeline 引擎

```python
class SearchResult(BaseModel):
    """检索结果"""
    chunk_id: str
    doc_id: str
    doc_title: str
    content: str
    score: float
    source: str = ""           # "vector" | "keyword"


class Source(BaseModel):
    """回答引用的来源信息"""
    doc_title: str
    chunk_id: str
    content: str
    score: float


class PipelineEvent(BaseModel):
    """管线上下文，在各插件间流转"""
    # 输入
    question: str
    kb_ids: list[str]
    session_id: str | None = None

    # QueryUnderstand 产物
    rewritten_queries: list[str] = []
    keywords: list[str] = []

    # Search 产物
    search_results: list[SearchResult] = []

    # Rerank 产物
    reranked_results: list[SearchResult] = []

    # ContextBuild 产物
    context_text: str = ""
    system_prompt: str = ""

    # ChatComplete 产物
    answer: str = ""
    sources: list[Source] = []
    token_usage: int = 0


class BasePlugin(ABC):
    @abstractmethod
    async def process(self, event: PipelineEvent) -> PipelineEvent: ...


class Pipeline:
    def __init__(self):
        self.plugins: list[BasePlugin] = []

    def register(self, plugin: BasePlugin):
        self.plugins.append(plugin)

    async def run(self, event: PipelineEvent) -> PipelineEvent:
        for plugin in self.plugins:
            event = await plugin.process(event)
        return event
```

### 4.2 管线流程

```
用户问题
  │
  ▼
┌────────────────────────────────────────────────┐
│ 1. QueryUnderstandPlugin                       │
│    · 关键词提取 (keywords_extraction.yaml)      │
│    · 查询改写 1~3 路 (rewrite.yaml)             │
│    · 输出: rewritten_queries, keywords          │
├────────────────────────────────────────────────┤
│ 2. SearchPlugin                                │
│    · 向量语义搜索 (每路 rewrite_query)          │
│    · FTS5 关键词全文搜索                        │
│    · RRF (Reciprocal Rank Fusion) 合并去重      │
│    · 输出: search_results (top 20)             │
├────────────────────────────────────────────────┤
│ 3. RerankPlugin                                │
│    · 未配置 rerank 服务时直接跳过                 │
│    · 有配置时: Cross-encoder 或 LLM-based 重排序  │
│    · 输出: reranked_results (top 5)            │
├────────────────────────────────────────────────┤
│ 4. ContextBuildPlugin                          │
│    · 加载 system_prompt.yaml                   │
│    · 检索结果 → context_template.yaml 注入      │
│    · 输出: system_prompt, context_text          │
├────────────────────────────────────────────────┤
│ 5. ChatCompletePlugin                          │
│    · 组装 messages: [system, user]             │
│    · LLM 流式调用 (stream=True)                │
│    · SSE 事件: token / sources / done / error   │
│    · 输出: answer, sources, token_usage         │
└────────────────────────────────────────────────┘
```

### 4.3 与 WeKnora 的对应

| WeKnora | OpenCodeWiki | 说明 |
|---------|-----------|------|
| EventManager + CHUNK_SEARCH | Pipeline.run() | 简化为顺序执行 |
| query_understand (search.go) | QueryUnderstandPlugin | Prompt 直译 |
| search_parallel + merge | SearchPlugin | 向量+FTS5 并行 |
| rerank | RerankPlugin | 可选，无配置时跳过 |
| PluginChatCompletion | ContextBuildPlugin + ChatCompletePlugin | 拆分为上下文组装+LLM调用 |

## 5. 知识库导入流程

```
上传文档
  → POST /api/kb/{id}/documents (multipart)
  → 存储文件到 data/files/{kb_id}/{doc_id}/{filename}
  → 创建 Document 记录 (status=processing)
  → asyncio.create_task(import_document)
       ├─ 解析: MD/TXT 直接读, PDF→pymupdf, DOCX→python-docx
       ├─ 切片: RecursiveCharacterTextSplitter (chunk_size=512, overlap=50)
       ├─ 嵌入: 批量调用 Embedding API (batch_size=32)
       ├─ 存储: chunk→knora.db, vector→vectors.db(sqlite-vec), text→FTS5
       └─ 更新 Document 状态 (status=completed|failed)
```

### 5.1 支持格式 (Phase 1)

| 格式 | 依赖 | 说明 |
|------|------|------|
| .md / .txt | 无 | 直接读取 |
| .pdf | pymupdf | 提取纯文本 |
| .docx | python-docx | 提取段落文本 |

后续按需添加：.pptx, .xlsx, .html, 图片 OCR。

### 5.2 切片策略

直接复用 WeKnora 参数：

```yaml
chunk:
  size: 512        # tokens
  overlap: 50      # tokens
  separators: ["\n\n", "\n", "。", ".", " ", ""]
```

- 不同知识库可配置独立的 chunk_size/chunk_overlap
- 保留文档标题层级作为 chunk metadata（用于检索时的上下文提示）

### 5.3 去重

- 上传时计算文件 SHA256，同知识库内同名+同 hash 拒绝上传
- 返回已有文档信息，提示用户

## 6. 数据模型

### 6.1 双 SQLite 数据库

```
knora.db (业务数据)              vectors.db (向量+全文检索)
├── knowledge_bases             ├── vector_chunks (sqlite-vec 虚拟表)
├── documents                   │   · rowid (隐式)
├── chunks                      │   · vector (BLOB)
├── sessions                    │   · chunk_id (外键)
└── messages                    └── chunk_fts (FTS5)
                                    · chunk_id
                                    · text
                                    · keywords
```

### 6.2 核心表结构

```sql
-- knora.db

CREATE TABLE knowledge_bases (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT DEFAULT '',
    embedding_model TEXT DEFAULT 'text-embedding-3-small',
    chunk_config  TEXT DEFAULT '{"size":512,"overlap":50}',  -- JSON
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE documents (
    id            TEXT PRIMARY KEY,
    kb_id         TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    file_hash     TEXT NOT NULL,           -- SHA256
    file_type     TEXT NOT NULL,           -- md/txt/pdf/docx
    status        TEXT DEFAULT 'processing',  -- processing/completed/failed
    chunks_count  INTEGER DEFAULT 0,
    error_message TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE chunks (
    id            TEXT PRIMARY KEY,
    doc_id        TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    kb_id         TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,
    chunk_index   INTEGER NOT NULL,
    metadata      TEXT DEFAULT '{}',       -- JSON: {heading, page, etc.}
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    kb_id         TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    title         TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE messages (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,           -- user / assistant
    content       TEXT NOT NULL,
    sources       TEXT DEFAULT '[]',       -- JSON: [{file, chunk, score}]
    token_count   INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
);
```

```sql
-- vectors.db

-- sqlite-vec 虚拟表
CREATE VIRTUAL TABLE vector_chunks USING vec0(
    vector FLOAT[1536],        -- 维度跟随 embedding model
    chunk_id TEXT              -- 关联 chunks.id
);

-- FTS5 全文索引 (独立表，与 chunks 写操作同步维护)
CREATE VIRTUAL TABLE chunk_fts USING fts5(
    chunk_id UNINDEXED,      -- 关联 chunks.id，不参与检索
    text,                    -- 切片原文
    keywords                 -- 预提取关键词
);
```

## 7. API 设计

### 7.1 端点列表

```
知识库
  POST   /api/kb                       创建知识库
  GET    /api/kb                       知识库列表
  GET    /api/kb/{id}                  知识库详情
  PUT    /api/kb/{id}                  更新知识库
  DELETE /api/kb/{id}                  删除知识库 (级联)

文档
  POST   /api/kb/{id}/documents        上传文档 (multipart/form-data)
  GET    /api/kb/{id}/documents        文档列表
  GET    /api/kb/{id}/documents/{did}  文档详情 + 切片预览
  DELETE /api/kb/{id}/documents/{did}  删除文档 (级联切片+向量)

问答 (独立问答，Phase 1 无多轮)
  POST   /api/qa                      提问 → SSE Stream

会话
  GET    /api/sessions?kb_id={id}     会话列表
  GET    /api/sessions/{id}           会话消息历史
  DELETE /api/sessions/{id}           删除会话

配置
  GET    /api/config                  获取当前配置
  PUT    /api/config                  更新配置
```

### 7.2 SSE 流协议

```
POST /api/qa
  Content-Type: application/json
  Body: {
    "kb_id": "kb-001",
    "question": "认证模块的 JWT 过期时间是多少？"
  }

  → 200 OK
  → Content-Type: text/event-stream

event: token
data: {"text": "认证", "event_id": 1}

event: token
data: {"text": "模块", "event_id": 2}

event: sources
data: [{"file": "auth/jwt.go", "chunk": "JWT expiration: 24h", "score": 0.92}]

event: token
data: {"text": "的 JWT 过期...", "event_id": 3}

event: done
data: {"session_id": "ses-001", "message_id": "msg-456", "tokens": 1234}

event: error
data: {"message": "LLM service timeout after 30s"}
```

## 8. 配置设计

### 8.1 配置级联

```
环境变量 > config.yaml > config.py 硬编码默认值
```

### 8.2 config.yaml 结构

```yaml
server:
  host: "0.0.0.0"
  port: 8765

llm:
  provider: "openai"          # openai / deepseek / anthropic
  api_key: "${LLM_API_KEY}"   # 支持环境变量引用
  base_url: "https://api.openai.com/v1"
  model: "gpt-4o-mini"
  max_tokens: 4096
  temperature: 0.1

embedding:
  provider: "openai"
  api_key: "${EMBEDDING_API_KEY}"
  base_url: "https://api.openai.com/v1"
  model: "text-embedding-3-small"
  dimensions: 1536

database:
  path: "./data"              # knora.db + vectors.db 存放目录

knowledge:
  chunk_size: 512
  chunk_overlap: 50
  max_file_size_mb: 20

retrieval:
  vector_top_k: 20            # 向量搜索候选数
  keyword_top_k: 10           # FTS5 搜索候选数
  rerank_top_k: 5             # 重排后送入 LLM 的数量
  rrf_k: 60                   # RRF 融合参数

# Prompt 模板引用路径
prompts:
  dir: "./backend/prompts"
```

## 9. Phase 2 展望

Phase 1 完成后，Phase 2 补齐闭环：

```
Phase 1: 文档导入 → 检索 → 问答
Phase 2: 问答 → Topic 聚合 → Wiki 沉淀 → 回灌检索索引
```

Phase 2 核心能力：
- QA 校准：管理员标记正确答案
- Topic 发现：LLM 批量聚类 QA → 主题
- Draft 生成：LLM 按模板生成结构化 Wiki
- 审核发布：人工审核 → 写入 FTS5 索引
- 闭环回灌：Wiki 内容在后续 QA 检索时作为上下文

这直接复用 OpenCodeWiki 的 `QA→Topic→Wiki→FTS5` 管线设计。

## 10. 关键设计决策

1. **Pipeline 插件模式** — 每个处理阶段独立为一个 Plugin，统一 `process(event) -> event` 接口。Phase 1 无容错/降级，异常直接报错。
2. **双 SQLite 数据库** — 业务数据与向量/索引分离。Phase 1 接受跨库事务不一致，不做补偿。
3. **sqlite-vec 向量存储** — 零依赖，建表固定维度。换 embedding model 需删库重建。
4. **Prompt 外置 YAML** — 所有提示词文件化。对 WeKnora 原版精剪：去掉 MCP/Skills/知识图谱/Web 搜索等工具调用指令，仅保留纯检索问答相关。
5. **SSE 流式** — 和 OpenCodeWiki 一致，前端复用现成的 SSE 订阅代码。
6. **独立问答（无多轮）** — Phase 1 每次 `/api/qa` 请求不注入历史消息，session 仅做存储记录。
7. **无认证** — 团队内用，不引入认证系统。
8. **asyncio 异步导入** — 不用 Redis 队列，`asyncio.create_task` 处理。服务重启时 `processing` 状态的文档无法自动恢复，接受。
9. **Rerank 可选** — 无 rerank 服务配置（绝大多数情况）时跳过，top 20 搜索结果直接截断 top 5 送入 LLM。
10. **RRF 融合** — 向量搜索 + FTS5 关键词搜索结果用 RRF 合并，照搬 WeKnora 策略。
11. **项目位置** — OpenCodeWiki 仓库的 `codeknora` 分支，复用 CI 和前端组件栈。
12. **前端三页面** — QAPage / KBManagePage / SettingsPage，复用 OpenCodeWiki 的 React + shadcn/ui 技术栈。
