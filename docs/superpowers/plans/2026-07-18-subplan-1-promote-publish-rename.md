# 子计划 1：promote → publish 全链路重命名

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Topic 生命周期术语从 promote/promoted 全面替换为 publish/published，覆盖数据库、API、函数名、类型、文案。

**Architecture:** 纯重命名，不改功能逻辑。Python 后端 + TypeScript 前端统一替换。

**Tech Stack:** Python 3.11+, FastAPI, sqlite3, React 18, TypeScript

## Global Constraints

- 数据库 CHECK 约束改为 `CHECK(status IN ('pool', 'published'))`
- 列名 `promoted_at` → `published_at`
- API 路由 `POST /api/topics/{slug}/publish`
- 中文文案：已固化 → 已沉淀，晋升 → 沉淀

---

### Task 1: promote → publish 全链路重命名

**Files:**
- Modify: `src/python-agent/database.py:137-140`
- Modify: `src/python-agent/store_topics.py:104-112`
- Modify: `src/python-agent/main.py:256,332-366`
- Modify: `src/python-agent/test_store_topics.py:101-110`
- Modify: `frontend/src/types/index.ts:25,29`
- Modify: `frontend/src/api/client.ts:91-96`
- Modify: `frontend/src/pages/AdminPage.tsx` (多处)
- Modify: `frontend/src/components/layout/LeftSidebar.tsx:66`

**Interfaces:**
- Consumes: (none)
- Produces: `publish(slug, wiki_module) -> bool`, `POST /api/topics/{slug}/publish`, `Topic.status: 'pool' | 'published'`

- [ ] **Step 1: database.py**

Edit `src/python-agent/database.py` lines 137-140:

```python
                        CHECK(status IN ('pool', 'published')),
            wiki_module TEXT DEFAULT NULL,
            created_at  TEXT DEFAULT (datetime('now')),
            published_at TEXT DEFAULT NULL
```

- [ ] **Step 2: store_topics.py**

```python
def publish(topic_slug: str, wiki_module: str) -> bool:
    db = get_knowledge_db()
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE topics SET status = 'published', wiki_module = ?, published_at = ? WHERE slug = ?",
        (wiki_module, now, topic_slug),
    )
    db.commit()
    return True
```

- [ ] **Step 3: main.py import + route**

Line 256:
```python
        save_draft, link_qa, update_draft_content, publish as publish_topic,
```

Lines 332-366:
```python
    @app.post("/api/topics/{slug}/publish")
    async def api_publish_topic(slug: str, body: dict):
        """沉淀 topic 为 wiki 页面"""
        wiki_module = body.get("wiki_module", "").strip()
        if not wiki_module:
            return _err("Missing wiki_module")
        topic = get_topic(slug)
        if not topic:
            raise HTTPException(404, f"Topic '{slug}' not found")
        draft = get_draft(slug)
        content = None
        if draft:
            content = draft.get("edited_content") or draft.get("raw_content")
        if not content:
            qa_list = topic.get("qa_entries", [])
            lines = [f"# {topic['name']}\n", f"", f"{topic['description']}\n", f""]
            for qa in qa_list:
                lines.append(f"## #Q{qa['qid']}: {qa['question']}\n")
                if qa.get("answer"):
                    lines.append(f"{qa['answer']}\n")
            content = "\n".join(lines)
        from store_wiki import write_page
        write_page(slug, "entity", content)
        publish_topic(slug, wiki_module)
        return _ok({"slug": slug, "wiki_module": wiki_module, "published": True})
```

- [ ] **Step 4: test_store_topics.py**

```python
    def test_publish(self):
        """沉淀 topic 为 wiki"""
        self.create_topic("publish-test", "沉淀测试")
        from store_topics import publish, get_topic
        publish("publish-test", "core-module")
        topic = get_topic("publish-test")
        self.assertEqual(topic["status"], "published")
        self.assertEqual(topic["wiki_module"], "core-module")
```

- [ ] **Step 5: 运行 Python 测试**

```bash
cd src/python-agent && python3 -m pytest test_store_topics.py -v
```
Expected: all PASS

- [ ] **Step 6: 删除旧数据库让 schema 重建**

```bash
rm -f ~/.opencodewiki/knowledge.db
```

- [ ] **Step 7: types/index.ts**

```typescript
export interface Topic {
  slug: string
  name: string
  description: string
  status: 'pool' | 'published'
  wiki_module: string | null
  qa_count?: number
  created_at: string
  published_at: string | null
}
```

- [ ] **Step 8: api/client.ts**

```typescript
export function publishTopic(slug: string, wikiModule: string): Promise<{ slug: string }> {
  return request(`/topics/${encodeURIComponent(slug)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ wiki_module: wikiModule }),
  })
}
```

- [ ] **Step 9: AdminPage.tsx 全局替换**

在 `frontend/src/pages/AdminPage.tsx` 中替换所有出现：
- `promoteTopic` → `publishTopic`
- `promoteResult` → `publishResult`
- `setPromoteResult` → `setPublishResult`
- `handlePromote` → `handlePublish`
- `promoting` → `publishing`
- `'promoted'` → `'published'`
- `'已固化'` → `'已沉淀'`
- `'晋升到 Wiki'` → `'沉淀为 Wiki'`
- `'晋升成功'` → `'沉淀成功'`
- `'晋升失败'` → `'沉淀失败'`
- `'晋升中...'` → `'沉淀中...'`

- [ ] **Step 10: LeftSidebar.tsx line 66**

```typescript
<span className="text-[9px] bg-cyber-blue/10 text-cyber-blue px-1.5 py-0.5 rounded-full font-bold">{t.status === 'published' ? '已沉淀' : '聚合中'}</span>
```

- [ ] **Step 11: 验证前端编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 12: Commit**

```bash
git add src/python-agent/database.py src/python-agent/store_topics.py src/python-agent/main.py src/python-agent/test_store_topics.py frontend/src/types/index.ts frontend/src/api/client.ts frontend/src/pages/AdminPage.tsx frontend/src/components/layout/LeftSidebar.tsx
git commit -m "重构: promote→publish 全链路术语重命名

数据库/API/前端类型/文案同步: promoted→published, 晋升→沉淀

Co-Authored-By: Claude <noreply@anthropic.com>"
```
