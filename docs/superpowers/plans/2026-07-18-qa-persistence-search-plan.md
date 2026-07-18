# QA 持久化 + 全局搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QA SSE 回答完成后自动无感保存到数据库 + LLM 同步分类 domain + 全局搜索 API 跨 wiki/topic/QA。

**Architecture:** 后端新增 2 个路由 + 2 个 store 函数 + classify_domain 函数。前端 QAPage done handler 触发保存，HomePage 搜索框改为调后端搜索 API。

**Tech Stack:** Python 3.11+, FastAPI, sqlite3, React 18, TypeScript

## Global Constraints

- API 响应格式：`{ok: bool, data?: any, error?: string}`
- domain 列表：`['bug-analysis', 'log-analysis', 'program-analysis', 'build-issue', 'stack-analysis', 'general']`
- domain 分类失败 → fallback `'general'`
- 搜索最少 2 个字符
- 中文 commit message

---

### Task 1: 后端 — store_topics.search_topics + store_qa.update_domain

**Files:**
- Modify: `src/python-agent/store_topics.py`
- Modify: `src/python-agent/store_qa.py`

- [ ] **Step 1: store_topics.py — 新增 search_topics()**

Append to `src/python-agent/store_topics.py`:

```python
def search_topics(q: str, limit: int = 3) -> list[dict]:
    db = get_knowledge_db()
    rows = db.execute(
        "SELECT slug, name, description FROM topics WHERE slug LIKE ? OR name LIKE ? LIMIT ?",
        (f"%{q}%", f"%{q}%", limit),
    ).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 2: store_qa.py — 新增 update_domain()**

Append to `src/python-agent/store_qa.py`:

```python
def update_domain(qid: int, domain: str):
    db = get_qa_db()
    db.execute("UPDATE qa_entries SET domain = ? WHERE qid = ?", (domain, qid))
    db.commit()
```

- [ ] **Step 3: 验证导入**

```bash
cd src/python-agent && python3 -c "from store_topics import search_topics; from store_qa import update_domain; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/python-agent/store_topics.py src/python-agent/store_qa.py
git commit -m "feat: store_topics.search_topics + store_qa.update_domain

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 后端 — POST /api/qa/save + classify_domain + GET /api/search

**Files:**
- Modify: `src/python-agent/main.py`

- [ ] **Step 1: 在 main.py 中添加 classify_domain 函数和两个路由**

在 `src/python-agent/main.py` 中找到 `# ── Search` 或类似注释位置（可在 topics 路由后、static files 前），添加：

```python
# ── QA Save ──────────────────────────────────────────────────────

DOMAINS = ['bug-analysis', 'log-analysis', 'program-analysis', 'build-issue', 'stack-analysis', 'general']


async def classify_domain(question: str, answer: str) -> str:
    try:
        from langchain_openai import ChatOpenAI
        from config import get_llm_config
        llm = ChatOpenAI(**get_llm_config(), temperature=0)
        text = f"{question[:300]}\n{answer[:500]}"
        resp = await llm.ainvoke(
            f"将以下问答分类到以下类别之一: {', '.join(DOMAINS)}。只输出类别名，不要解释。\n\n{text}"
        )
        domain = resp.content.strip()
        return domain if domain in DOMAINS else 'general'
    except Exception:
        return 'general'


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
    domain = await classify_domain(question, answer)
    from store_qa import update_domain
    update_domain(entry["qid"], domain)
    return _ok({"qid": entry["qid"], "id": entry["id"], "domain": domain})


# ── Global Search ───────────────────────────────────────────────

@app.get("/api/search")
async def api_search(q: str = "", limit: int = 10):
    if len(q.strip()) < 2:
        return _ok({"wiki": [], "topic": [], "qa": []})

    # 搜 wiki
    wiki_results = []
    if WIKI_BASE.exists():
        for md_path in WIKI_BASE.rglob("*.md"):
            if len(wiki_results) >= 3:
                break
            try:
                content = md_path.read_text(encoding="utf-8")[:500]
                title = md_path.stem
            except Exception:
                continue
            if q.lower() in title.lower() or q.lower() in content.lower():
                wiki_results.append({
                    "slug": title,
                    "title": title,
                    "snippet": content[:120],
                })

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

- [ ] **Step 2: 验证 Python 加载**

```bash
cd src/python-agent && python3 -c "from main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/python-agent/main.py
git commit -m "feat: POST /api/qa/save + classify_domain + GET /api/search

QA 自动保存 + LLM 分类 + 跨 wiki/topic/QA 全局搜索

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 前端 — QAPage 自动保存 + HomePage 全局搜索

**Files:**
- Modify: `frontend/src/pages/QAPage.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`

- [ ] **Step 1: QAPage.tsx — done handler 加保存调用**

在 `QAPage.tsx` 的 `handleSend` 函数中，找到 `done` 事件处理部分（约 line 38-42），替换为：

```typescript
} else if (msg.type === 'done') {
  const finalAnswer = streamingRef.current
  const lastUserMsg = messages[messages.length - 1]
  setMessages(prev => [...prev, { role: 'assistant', content: finalAnswer }])
  setCurrentAnswer('')
  streamingRef.current = ''

  // 自动保存 QA
  fetch('/api/qa/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: lastUserMsg?.content || '',
      answer: finalAnswer,
      repo: '',
      session_id: Date.now().toString(),
      sources: [],
      mode: 'deep',
    }),
  }).then(() => fetchQaEntries({ limit: 100 }).then(d => setQaEntries(d.entries)))
  .catch(() => {})
}
```

- [ ] **Step 2: HomePage.tsx — 搜索结果状态 + 分组展示**

在 `HomePage.tsx` 中新增搜索结果状态：

```typescript
const [searchResults, setSearchResults] = useState<{ wiki: any[]; topic: any[]; qa: any[] } | null>(null)
```

替换现有的 `handleSearchKeyDown`：

```typescript
const handleSearchKeyDown = async (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && searchVal.trim()) {
    try {
      const res = await fetch('/api/search?q=' + encodeURIComponent(searchVal.trim()) + '&limit=5')
      const body = await res.json()
      if (body.ok) {
        const data = body.data
        const hasResults = (data.wiki?.length || 0) + (data.topic?.length || 0) + (data.qa?.length || 0) > 0
        if (hasResults) {
          setSearchResults(data)
          setShowSuggest(true)
          return
        }
      }
    } catch {}
    navigate(`/qa?q=${encodeURIComponent(searchVal.trim())}`)
  }
}
```

替换搜索结果下拉（替代原有的 `filteredSuggest` 展示部分），在 `showSuggest && searchVal.trim()` 条件下加入获取后端搜索结果的展示：

```typescript
{showSuggest && searchVal.trim() && searchResults && (
  <div className="absolute top-full left-4 right-4 bg-white border border-gray-100 rounded-xl shadow-xl mt-1.5 p-3 text-left text-xs z-50 max-h-80 overflow-y-auto">
    {searchResults.wiki?.length > 0 && (
      <div className="mb-3">
        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">📖 Wiki</h4>
        {searchResults.wiki.map((w: any) => (
          <button key={w.slug} onClick={() => { setShowSuggest(false); setSearchVal(''); setSearchResults(null); navigate(`/${repos[0]?.name ?? 'self'}#${w.slug}`); }}
            className="w-full p-2 hover:bg-slate-100 rounded-lg text-left">
            <div className="font-medium text-gray-700">{w.title}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{w.snippet}</div>
          </button>
        ))}
      </div>
    )}
    {searchResults.topic?.length > 0 && (
      <div className="mb-3">
        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">🏷️ Topic</h4>
        {searchResults.topic.map((t: any) => (
          <button key={t.slug} onClick={() => { setShowSuggest(false); setSearchVal(''); setSearchResults(null); navigate(`/${repos[0]?.name ?? 'self'}#${t.slug}`); }}
            className="w-full p-2 hover:bg-slate-100 rounded-lg text-left">
            <span className="font-mono font-medium text-gray-700">#{t.slug}</span>
            <span className="text-gray-500 ml-2">{t.name}</span>
          </button>
        ))}
      </div>
    )}
    {searchResults.qa?.length > 0 && (
      <div>
        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">💬 QA</h4>
        {searchResults.qa.map((q: any) => (
          <button key={q.qid} onClick={() => { setShowSuggest(false); setSearchVal(''); setSearchResults(null); navigate(`/qa?qid=${q.qid}`); }}
            className="w-full p-2 hover:bg-slate-100 rounded-lg text-left">
            <span className="text-gray-700">{q.question}</span>
            <span className="text-[10px] text-gray-400 ml-2">#{q.qid}</span>
          </button>
        ))}
      </div>
    )}
  </div>
)}
```

对于本地过滤的联想池搜索（`filteredSuggest`），保留作为后端搜索的补充但在后端搜索返回后显示为后端结果。简化为：如果在输入过程中有本地联想池结果且尚未触发全局搜索，则显示本地联想；否则显示后端搜索结果。

实际实现策略：保持 showSuggest 逻辑不变，在 Enter 触发时改用后端搜索并设置 searchResults，同时保持本地联想作为 typing 时的即时反馈（filteredSuggest 逻辑不变）。

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/QAPage.tsx frontend/src/pages/HomePage.tsx
git commit -m "feat: QAPage 自动保存 + HomePage 全局搜索

SSE done后POST /api/qa/save, 首页搜索调GET /api/search分组展示

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ POST /api/qa/save: Task 2
- ✅ classify_domain: Task 2
- ✅ GET /api/search: Task 2
- ✅ store_topics.search_topics: Task 1
- ✅ store_qa.update_domain: Task 1
- ✅ QAPage done handler: Task 3 Step 1
- ✅ HomePage 搜索: Task 3 Step 2

**2. Placeholder scan:** 无 TBD/TODO

**3. Type consistency:** `search_topics(q, limit)` → 返回 `[{slug, name, description}]`，与 API 响应结构一致。`update_domain(qid, domain)` 参数类型一致。
