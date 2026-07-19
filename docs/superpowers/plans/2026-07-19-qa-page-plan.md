# QA 页面改造 — 实施计划

**Goal:** QA 页面从对话模式改为问答条目列表模式，支持追问折叠和 /new 命令

**Architecture:** 重构 QAPage.tsx 主渲染逻辑，新增 stores/qa.py 的追问查询 API

**Tech Stack:** React, TypeScript, FastAPI

---

### Task 1: 后端新增追问列表 API

**Files:**
- Modify: `backend/stores/qa.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_main/test_qa_routes.py`

后端已有 `parent_qid` 字段和 `create_entry` 支持关联。需要新增一个按父 qid 列出追问的接口。

**Step 1: stores/qa.py 新增 list_followups**

```python
def list_followups(parent_qid: int) -> list[dict]:
    db = get_qa_db()
    rows = db.execute(
        "SELECT qid, question, answer, created_at FROM qa_entries WHERE parent_qid = ? ORDER BY created_at ASC",
        (parent_qid,),
    ).fetchall()
    return [dict(r) for r in rows]
```

**Step 2: main.py 新增 GET /api/qa/entry/{qid}/followups**

```python
@app.get("/api/qa/entry/{qid}/followups")
async def api_qa_followups(qid: int):
    from stores.qa import list_followups
    return _ok(list_followups(qid))
```

**Step 3: 测试 + 提交**

---

### Task 2: QAPage 重构为条目列表模式

**Files:**
- Modify: `frontend/src/pages/QAPage.tsx`

核心改动：移除左右分栏对话模式，改为条目列表 + 展开详情 + 底部追问输入框。

- 页面加载时调用 `fetchQaEntries({ limit: 100 })` 展示条目列表
- 每条渲染为：标题 + 元数据(访问计数/日期) + 答案预览 + 追问折叠区
- 点击条目展开/收起
- `/new` 命令检测
- 追问输入框在展开条目底部

---

### Task 3: 前端测试

**Files:**
- Create: `frontend/src/pages/QAPage.test.tsx`（更新）

更新现有 QAPage 测试覆盖新布局。
