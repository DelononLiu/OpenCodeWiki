"""
集成测试：知识库上传 + QA 功能。

运行方式 (需启动后端):
  cd backend && python -m pytest tests/test_integration.py -v

或直接:
  cd backend && python tests/test_integration.py
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:8100")
PASS = 0
FAIL = 0


def _req(method: str, path: str, body: dict | None = None, expect: int = 200) -> dict:
    """发送 HTTP 请求并返回 JSON 响应。"""
    global PASS, FAIL
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            status = f"✅ PASS" if resp.status == expect else f"❌ FAIL (status {resp.status}, expected {expect})"
            print(f"  {status} {method} {path}")
            if resp.status != expect:
                FAIL += 1
            else:
                PASS += 1
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  ❌ FAIL {method} {path}: HTTP {e.code} {body[:200]}")
        FAIL += 1
        return {"ok": False, "error": body}
    except Exception as e:
        print(f"  ❌ FAIL {method} {path}: {e}")
        FAIL += 1
        return {"ok": False, "error": str(e)}


def section(name: str):
    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")


# ═══════════════════════════════════════════════════════════════
# 1. 知识库上传功能
# ═══════════════════════════════════════════════════════════════

def test_document_upload():
    """测试文档上传功能。"""
    section("1.1 文档上传")

    # 用 multipart 上传一个 .md 文件
    boundary = "----TestBoundary123"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="test_doc.md"\r\n'
        f"Content-Type: text/markdown\r\n\r\n"
        f"# 测试文档\n\n这是一篇测试文档。\n\n## 章节\n\n- 项目背景\n- 架构说明\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="tags"\r\n\r\n'
        f"测试,文档,demo\r\n"
        f"--{boundary}--\r\n"
    ).encode()

    req = urllib.request.Request(
        f"{BASE_URL}/api/documents/upload",
        data=body,
        method="POST",
    )
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            assert data.get("slug") == "test_doc", f"Expected slug 'test_doc', got {data.get('slug')}"
            print(f"  ✅ PASS POST /api/documents/upload (slug={data.get('slug')})")
            global PASS
            PASS += 1
    except Exception as e:
        print(f"  ❌ FAIL POST /api/documents/upload: {e}")
        global FAIL
        FAIL += 1


def test_list_sources():
    """测试列出来源。"""
    section("1.2 来源列表")
    data = _req("GET", "/api/sources")
    assert isinstance(data, dict)
    # 至少返回一个列表
    print(f"    来源数: {len(data.get('data', []))}")


# ═══════════════════════════════════════════════════════════════
# 2. QA 功能
# ═══════════════════════════════════════════════════════════════

def test_qa_create_entry():
    """测试 QA 条目创建。"""
    section("2.1 QA 条目创建")

    # 先获取 next-qid
    data = _req("GET", "/api/qa/next-qid")
    qid = data.get("data", {}).get("qid", 1)
    print(f"    当前 next-qid: {qid}")

    # 创建条目
    data = _req("POST", "/api/qa/save", {
        "question": "如何配置 OpenCodeWiki 的数据源？",
        "answer": "在 /api/sources 页面添加 Git 或上传 ZIP 文件。支持 code 和 docs 两种类型。",
        "repo": "",
        "session_id": f"test-session-{int(time.time())}",
        "session_create": True,
        "sources": [
            {"file": "docs/setup.md", "line": "10", "snippet": "添加数据源步骤"}
        ],
    })
    assert data.get("ok") or data.get("data"), f"创建失败: {data}"
    created_qid = data.get("data", {}).get("qid")
    print(f"    创建 Q#{created_qid}")
    return created_qid


def test_qa_get_entry(qid: int):
    """测试获取 QA 条目。"""
    section("2.2 QA 条目查询")
    data = _req("GET", f"/api/qa/entry/{qid}")
    assert data.get("data", {}).get("qid") == qid
    print(f"    问题: {data['data']['question'][:50]}...")


def test_qa_refine(qid: int):
    """测试 title/tag 精炼。"""
    section("2.3 title/tag 精炼")
    data = _req("POST", f"/api/qa/entry/{qid}/refine")
    if data.get("ok") or data.get("data"):
        result = data.get("data", {})
        print(f"    标题: {result.get('title', '')}")
        print(f"    标签: {result.get('tags', [])}")
    else:
        # 可能 LLM 调用失败，不是端点本身的问题
        print(f"    ⚠️  精炼失败（LLM 未就绪？）: {data.get('error', 'unknown')}")


def test_qa_sources(qid: int):
    """测试 QA 引用来源。"""
    section("2.4 QA 引用来源")
    data = _req("GET", f"/api/qa/entry/{qid}/sources")
    sources = data.get("data", {}).get("sources", [])
    print(f"    来源数: {len(sources)}")


def test_qa_related(qid: int):
    """测试相关问题（含回退搜索）。"""
    section("2.5 相关问题（回退搜索）")
    data = _req("GET", f"/api/qa/entry/{qid}/related")
    related = data.get("data", {}).get("related", [])
    print(f"    相关问题数: {len(related)}")
    for r in related[:3]:
        print(f"      - Q#{r['qid']}: {r['question'][:40]}")


def test_qa_share(qid: int):
    """测试分享端点。"""
    section("2.6 分享路由")
    data = _req("GET", f"/api/qa/share/{qid}")
    assert data.get("qid") == qid, f"分享数据不含 qid: {data}"
    print(f"    分享标题: {data.get('question', '')[:40]}...")
    print(f"    有回答: {'✅' if data.get('answer') else '❌'}")
    print(f"    标签: {data.get('tags', [])}")


def test_qa_suggest():
    """测试搜索建议。"""
    section("2.7 QA 搜索建议")
    data = _req("GET", "/api/qa/suggest?q=配置&limit=3")
    suggestions = data.get("data", {}).get("suggestions", [])
    print(f"    建议数: {len(suggestions)}")


def test_qa_list():
    """测试 QA 列表。"""
    section("2.8 QA 列表")
    data = _req("GET", "/api/qa/entries?limit=5")
    entries = data.get("data", {}).get("entries", [])
    print(f"    条目数: {data.get('data', {}).get('total', 0)}")
    for e in entries[:3]:
        print(f"      Q#{e['qid']}: {e['question'][:40]}")


def test_sessions():
    """测试会话列表。"""
    section("2.9 会话列表")
    data = _req("GET", "/api/sessions")
    sessions = data.get("data", {}).get("sessions", [])
    print(f"    会话数: {len(sessions)}")


# ═══════════════════════════════════════════════════════════════
# 3. 知识源管理
# ═══════════════════════════════════════════════════════════════

def test_source_crud():
    """测试知识源 CRUD。"""
    section("3.1 知识源 CRUD")

    # Code 源需要实际 git clone，跳过
    # 只测试列表和查询
    data = _req("GET", "/api/sources")
    sources = data.get("data", [])
    print(f"    已注册来源: {len(sources)}")
    for s in sources[:3]:
        print(f"      - {s.get('name')} ({s.get('type')})")

    if sources:
        name = sources[0]["name"]
        data = _req("GET", f"/api/sources/{name}")
        assert data.get("data", {}).get("name") == name
        print(f"    查询 {name}: ✅")


# ═══════════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════════

def main():
    print(f"OpenCodeWiki 集成测试")
    print(f"后端地址: {BASE_URL}")
    print()

    # 先检查后端是否运行
    try:
        urllib.request.urlopen(f"{BASE_URL}/api/repos", timeout=3)
    except Exception:
        print(f"❌ 后端未响应 {BASE_URL}，请先启动后端:")
        print(f"   cd backend && python main.py")
        sys.exit(1)

    # 运行测试
    test_document_upload()
    test_list_sources()

    qid = test_qa_create_entry()
    if qid:
        test_qa_get_entry(qid)
        test_qa_refine(qid)
        test_qa_sources(qid)
        test_qa_related(qid)
        test_qa_share(qid)

    test_qa_suggest()
    test_qa_list()
    test_sessions()
    test_source_crud()

    # 结果汇总
    total = PASS + FAIL
    print(f"\n{'='*60}")
    print(f"  总计: {total}  |  通过: {PASS}  |  失败: {FAIL}")
    print(f"{'='*60}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
