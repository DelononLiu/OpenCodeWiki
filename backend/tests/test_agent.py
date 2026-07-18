"""
自测脚本：验证 Python LangGraph Agent 端到端流程。

用法：
  1. 确保 TS codegraph-bridge 在运行 (port 4747)
  2. python3 test_agent.py

测试内容：
  - 健康检查
  - 简单代码问答（依赖 TS 侧有已索引的 repo）
  - SSE 流格式验证
"""

import json
import subprocess
import sys
import time
import urllib.request
import urllib.error

PYTHON_AGENT_URL = "http://localhost:8000"
TS_BRIDGE_URL = "http://localhost:4747"


def check_server(url: str, name: str) -> bool:
    """检查服务是否运行"""
    try:
        urllib.request.urlopen(f"{url}/health", timeout=3)
        print(f"  ✅ {name} 运行中 ({url})")
        return True
    except Exception:
        print(f"  ❌ {name} 未启动 ({url})")
        return False


def test_health():
    """测试健康检查"""
    print("\n=== 测试 1: 健康检查 ===")
    try:
        resp = urllib.request.urlopen(f"{PYTHON_AGENT_URL}/health", timeout=5)
        data = json.loads(resp.read())
        assert data["status"] == "ok"
        print("  ✅ /health 返回 ok")
    except Exception as e:
        print(f"  ❌ /health 失败: {e}")
        raise


def test_agent_qa(question: str, label: str):
    """测试 Agent 问答（验证 SSE 流）"""
    print(f"\n=== 测试 2: {label} ===")
    print(f"  问题: {question}")

    body = json.dumps({"question": question}).encode()
    req = urllib.request.Request(
        f"{PYTHON_AGENT_URL}/agent/qa",
        data=body,
        headers={"Content-Type": "application/json"},
    )

    try:
        resp = urllib.request.urlopen(req, timeout=60)
        assert resp.headers.get("Content-Type", "").startswith("text/event-stream")
        print("  ✅ 响应是 SSE 流格式")

        # 读取 SSE 事件
        buffer = b""
        event_count = {"session": 0, "token": 0, "reasoning": 0, "done": 0, "error": 0}
        has_content = False

        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            buffer += chunk
            # 按行解析
            text = buffer.decode("utf-8")
            lines = text.split("\n")
            buffer = b""  # 简单处理，不处理跨包行

            for line in lines:
                if line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        event_type = data.get("type", "unknown")
                        if event_type == "done":
                            event_count["done"] += 1
                            has_content = True
                            break
                        if event_type in event_count:
                            event_count[event_type] += 1
                            if event_type == "token" and data.get("content"):
                                if event_count["token"] == 1:
                                    print(f"  ✅ 收到首个 token: {data['content'][:50]}...")
                    except json.JSONDecodeError:
                        pass

        # 验证事件结构
        assert event_count["session"] >= 1, "缺少 session 事件"
        assert event_count["done"] >= 1, "缺少 done 事件"
        print(f"  ✅ SSE 事件统计: session={event_count['session']}, "
              f"token={event_count['token']}, "
              f"reasoning={event_count['reasoning']}, "
              f"done={event_count['done']}")
        print(f"  ✅ {label} 通过")

    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"  ❌ HTTP {e.code}: {error_body[:200]}")
        raise
    except Exception as e:
        print(f"  ❌ 请求失败: {e}")
        raise


def main():
    print("=" * 50)
    print("OpenCodeWiki Python Agent 自测")
    print("=" * 50)

    # 检查依赖服务
    ts_ok = check_server(TS_BRIDGE_URL, "TS codegraph-bridge")
    if not ts_ok:
        print("\n⚠️  TS 服务未启动。部分测试可能失败（工具调用需要 TS API）。")
        print("   启动方式: cd .. && npm run dev")

    py_ok = check_server(PYTHON_AGENT_URL, "Python Agent")
    if not py_ok:
        print("\n❌ Python Agent 未启动。请先启动：")
        print("   cd src/python-agent && source .venv/bin/activate && uvicorn main:app --port 8000")
        sys.exit(1)

    # 执行测试
    try:
        test_health()
        test_agent_qa(
            "What open source license does this project use?",
            "简单问题：查询项目 License",
        )
        print("\n" + "=" * 50)
        print("✅ 所有测试通过")
        print("=" * 50)
    except Exception:
        print("\n" + "=" * 50)
        print("❌ 测试失败")
        print("=" * 50)
        sys.exit(1)


if __name__ == "__main__":
    main()
