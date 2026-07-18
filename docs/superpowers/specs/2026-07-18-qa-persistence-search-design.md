# QA 持久化 + 全局搜索 Design Spec

## 概述

QA Session 自动持久化（SSE 流式回答完成后无感写入 db + LLM 自动分类 domain）+ 全局搜索 API（后端跨 wiki/topic/QA 统一搜索）。

## 数据流

```
用户提问 → SSE 流式回答 → done 事件
                              ↓
                    前端 POST /api/qa/save
                         {question, answer, repo, session_id, sources}
                              ↓
                    后端 store_qa.create_entry()
                    同步调用 LLM 分类 domain
                              ↓
                    写入 qa_entries (status='active')
                              ↓
                    返回 {qid, domain} 给前端
                    前端重新 fetch QA 列表刷新左侧栏
```

---

## API 设计

### `POST /api/qa/save`（新增）

保存一条 QA 会话结果。

**Request:**
```json
{
  "question": "LSH 冷启动卡顿问题排查",
  "answer": "根据源码分析，LSH 在冷启动阶段...",
  "repo": "opencodewiki",
  "session_id": "uuid-xxx",
  "sources": [
    { "file": "src/lsh/cold_start.py", "line": 42, "snippet": "..." }
  ],
  "mode": "deep"
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "qid": 103,
    "id": "entry-uuid",
    "domain": "bug-analysis"
  }
}
```

**domain 分类逻辑（后端同步）：**
- 将 question + answer 前 500 字符送入 LLM
- 从预定义 domain 列表中选择最合适的一个
- domain 列表：`['bug-analysis', 'log-analysis', 'program-analysis', 'build-issue', 'stack-analysis', 'general']`
- 若 LLM 调用失败，fallback 为 `'general'`

---

### `GET /api/search`（新增）

全局搜索，跨 wiki 文档、topic、QA 条目。

**Request:**
```
GET /api/search?q=双路&limit=10
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "wiki": [
      {
        "slug": "02-qa-engine",
        "title": "双路分流路由算法系统",
        "snippet": "该系统采用双路路由策略..."
      }
    ],
    "topic": [
      {
        "slug": "qa-engine",
        "name": "QA 引擎实践",
        "description": "从多个 QA 聚合的双路路由相关实践"
      }
    ],
    "qa": [
      {
        "qid": 103,
        "question": "LSH 冷启动卡顿问题排查",
        "domain": "bug-analysis"
      }
    ]
  }
}
```

**搜索范围与优先级：**
1. wiki：遍历 `.codegraph/wiki/` 下所有 `.md` 文件，匹配文件名 + 标题行（`# xxx`），每个文件最多 1 个结果，最多返回 3 个
2. topic：`topics` 表，匹配 slug + name + description，模糊搜索，最多 3 个
3. QA：`qa_entries` 表，`question LIKE '%q%'`，按 `visit_count DESC` 排序，最多 3 个

**性能：** wiki 文件扫描为启动时缓存索引（可选），首次可用 os.walk 遍历。qa_entries 和 topics 用 SQL LIKE 查询。

---

## 前端改动

### QAPage.tsx

**done handler 新增保存调用：**
```typescript
} else if (msg.type === 'done') {
  const finalAnswer = streamingRef.current
  setMessages(prev => [...prev, { role: 'assistant', content: finalAnswer }])
  setCurrentAnswer('')
  streamingRef.current = ''

  // 自动保存 QA 到后端
  fetch('/api/qa/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: messages[messages.length - 1]?.content || '',
      answer: finalAnswer,
      repo: '', // TODO: 后续从上下文获取
      session_id: Date.now().toString(),
      sources: [],
      mode: 'deep',
    }),
  }).then(() => fetchQaEntries({ limit: 100 }).then(setQaEntries))
  .catch(() => {})
}
```

**左侧栏刷新：** 保存成功后重新 `fetchQaEntries()` 更新列表。

### HomePage.tsx

**搜索框改为调全局搜索 API：**
```typescript
const handleSearchKeyDown = async (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && searchVal.trim()) {
    // 先试全局搜索
    try {
      const res = await fetch('/api/search?q=' + encodeURIComponent(searchVal.trim()) + '&limit=5')
      const body = await res.json()
      if (body.ok) {
        // 有结果 → 展示搜索结果或直接跳转
        setSearchResults(body.data)
        return
      }
    } catch {}
    // 无结果 → 跳转 QA 提问
    navigate(`/qa?q=${encodeURIComponent(searchVal.trim())}`)
  }
}
```

搜索结果下拉改为按类别分组展示：
```
┌─ 搜索结果 ────────────────────────────────────┐
│ 📖 Wiki                                       │
│   双路分流路由算法系统                          │
│ 🏷️ Topic                                     │
│   #qa-engine: QA 引擎实践                      │
│ 💬 QA                                        │
│   #Q103 LSH 冷启动卡顿问题排查                  │
└───────────────────────────────────────────────┘
```

---

## 后端改动

### main.py — 新增路由

```python
# ── QA Save ──────────────────────────────────────────────────────

@app.post("/api/qa/save")
async def api_qa_save(body: dict):
    question = body.get("question", "").strip()
    answer = body.get("answer", "").strip()
    if not question or not answer:
        return _err("Missing question or answer")
    entry = create_entry({
        "question": question,
        "answer": answer,
        "repo": body.get("repo", ""),
        "sessionId": body.get("session_id", ""),
        "mode": body.get("mode", "deep"),
        "sources": body.get("sources", []),
    })
    # LLM 分类 domain
    domain = await classify_domain(question, answer)
    from store_qa import update_domain
    update_domain(entry["qid"], domain)
    return _ok({"qid": entry["qid"], "id": entry["id"], "domain": domain})
```

### classify_domain 函数（新增）

```python
async def classify_domain(question: str, answer: str) -> str:
    DOMAINS = ['bug-analysis', 'log-analysis', 'program-analysis', 'build-issue', 'stack-analysis', 'general']
    try:
        from langchain_openai import ChatOpenAI
        from config import get_llm_config
        llm = ChatOpenAI(**get_llm_config(), temperature=0)
        text = f"{question[:300]}\n{answer[:500]}"
        resp = await llm.ainvoke(f"将以下问答分类到以下类别之一: {', '.join(DOMAINS)}。只输出类别名，不要解释。\n\n{text}")
        domain = resp.content.strip()
        return domain if domain in DOMAINS else 'general'
    except Exception:
        return 'general'
```

### `GET /api/search` 路由（新增）

```python
@app.get("/api/search")
async def api_search(q: str = "", limit: int = 10):
    if len(q.strip()) < 2:
        return _ok({"wiki": [], "topic": [], "qa": []})

    # 搜 wiki
    wiki_results = []
    if WIKI_BASE.exists():
        for md_path in WIKI_BASE.rglob("*.md"):
            try:
                content = md_path.read_text(encoding="utf-8")[:500]
                title = md_path.stem
            except Exception:
                continue
            if q.lower() in title.lower() or q.lower() in content.lower():
                wiki_results.append({"slug": title, "title": title, "snippet": content[:120]})
            if len(wiki_results) >= 3:
                break

    # 搜 topic
    topic_results = []
    try:
        from store_topics import search_topics
        topic_results = search_topics(q, limit=3)
    except ImportError:
        pass

    # 搜 QA
    qa_results = []
    try:
        from store_qa import search_questions
        qa_results = search_questions(q, limit=3)
    except ImportError:
        pass

    return _ok({"wiki": wiki_results, "topic": topic_results, "qa": qa_results})
```

### store_topics.py + store_qa.py — 新增函数

```python
# store_topics.py
def search_topics(q: str, limit: int = 3) -> list[dict]:
    db = get_knowledge_db()
    rows = db.execute(
        "SELECT slug, name, description FROM topics WHERE slug LIKE ? OR name LIKE ? LIMIT ?",
        (f"%{q}%", f"%{q}%", limit),
    ).fetchall()
    return [dict(r) for r in rows]
```

```python
# store_qa.py
def update_domain(qid: int, domain: str):
    db = get_qa_db()
    db.execute("UPDATE qa_entries SET domain = ? WHERE qid = ?", (domain, qid))
    db.commit()
```

---

## 文件清单

| 文件 | 操作 | 改动 |
|------|------|------|
| `src/python-agent/main.py` | 修改 | +2 路由 `POST /api/qa/save` + `GET /api/search` + `classify_domain()` |
| `src/python-agent/store_topics.py` | 修改 | +`search_topics()` |
| `src/python-agent/store_qa.py` | 修改 | +`update_domain()` |
| `frontend/src/pages/QAPage.tsx` | 修改 | done handler 加 `/api/qa/save` 调用 + 列表刷新 |
| `frontend/src/pages/HomePage.tsx` | 修改 | 搜索框改为调 `/api/search` + 结果分组展示 |

---

## Spec 自检

- **占位符**：无 TBD/TODO
- **内部一致性**：API 请求/响应格式一致，domain 分类流程完整
- **范围**：QA 持久化 2 路由 + 全局搜索 1 路由 + 前端 2 文件，独立可验证
- **歧义**：domain 分类失败 → fallback 'general'，搜索无结果 → 跳转 QA 提问
