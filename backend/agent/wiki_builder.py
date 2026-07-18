"""
Entity 骨架生成 + 详情填充。

调用 codebase-memory-mcp CLI 获取符号信息，LLM 生成概念定义和描述内容。
"""
import json
import subprocess
import sys
from pathlib import Path

# Add parent dir for config import
sys.path.insert(0, str(Path(__file__).parent))

from config import get_llm_config

CLI_BINARY = "/home/long2015/.local/bin/codebase-memory-mcp"


def _call_cli(tool: str, args: dict) -> dict:
    """调用 codebase-memory-mcp CLI"""
    try:
        result = subprocess.run(
            [CLI_BINARY, "cli", tool, json.dumps(args)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return {}
        for line in reversed(result.stdout.strip().split("\n")):
            if line.startswith("{"):
                return json.loads(line)
        return {}
    except Exception:
        return {}


def _find_symbols(project: str, concept: str) -> list[dict]:
    """搜索与概念相关的符号"""
    data = _call_cli("search_graph", {"query": concept, "project": project, "limit": 15})
    return [
        {"name": r.get("name"), "file": r.get("file_path"), "line": r.get("start_line")}
        for r in data.get("results", []) if r.get("name")
    ]


def generate_skeleton(project: str, concept: str) -> dict:
    """
    Phase 1: 生成实体骨架。
    返回 EntityStore 兼容的实体字典。
    """
    symbols = _find_symbols(project, concept)
    cfg = get_llm_config()

    # Build LLM
    if cfg.get("provider") == "anthropic":
        from langchain_anthropic import ChatAnthropic
        llm = ChatAnthropic(model=cfg["model"], api_key=cfg["apiKey"], temperature=0)
    else:
        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(
            model=cfg["model"], api_key=cfg["apiKey"],
            base_url=cfg["baseUrl"], temperature=0,
        )

    files_str = "\n".join(
        f"- {s['file']}:{s['line']} ({s['name']})" for s in symbols[:10]
    ) or "（未找到直接相关符号）"

    prompt = f"""根据以下代码信息，为概念「{concept}」生成 wiki 实体骨架。

涉及代码：
{files_str}

项目：{project}

请返回以下 JSON 格式，不要加其他说明：
{{
  "slug": "英文短横线格式，如 batch-inference",
  "name": "实体名称（中文，15字内）",
  "definition": "一句话定义（20字内）",
  "files": ["涉及的文件相对路径，只列出最相关的3-5个"],
  "relations": ["相关的其他实体名称列表，如推理引擎、量化等"]
}}"""

    resp = llm.invoke(prompt)
    content = resp.content.strip()
    # Strip markdown code fences if present
    if content.startswith("```"):
        content = content.split("\n", 1)[-1]
        content = content.rsplit("```", 1)[0]

    try:
        data = json.loads(content.strip())
    except json.JSONDecodeError:
        data = {"definition": content[:100]}

    return {
        "slug": data.get("slug", concept.lower().replace(" ", "-")),
        "name": data.get("name", concept),
        "status": "initial",
        "definition": data.get("definition", ""),
        "project": project,
        "files": [
            {"path": f, "symbols": [s["name"] for s in symbols if s["file"] == f]}
            for f in data.get("files", [])
        ],
        "relations": [{"target": r, "type": "related"} for r in data.get("relations", [])],
        "content": "",
        "searchCount": 0,
    }


def fill_details(entity: dict) -> dict:
    """
    Phase 3: 基于已校准骨架填充详情。
    """
    cfg = get_llm_config()

    if cfg.get("provider") == "anthropic":
        from langchain_anthropic import ChatAnthropic
        llm = ChatAnthropic(model=cfg["model"], api_key=cfg["apiKey"], temperature=0)
    else:
        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(
            model=cfg["model"], api_key=cfg["apiKey"],
            base_url=cfg["baseUrl"], temperature=0,
        )

    files_str = "\n".join(f"- {f['path']}" for f in entity.get("files", [])) or "（无）"
    prompt = f"""实体「{entity['name']}」定义：{entity['definition']}

涉及文件：
{files_str}

请用中文写一段 300-500 字的详细介绍，说明这个模块/概念做什么、涉及的代码结构、核心逻辑。使用 markdown 格式。可包含 mermaid 流程图。"""

    resp = llm.invoke(prompt)
    entity["content"] = resp.content.strip()
    entity["status"] = "filled"
    return entity


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "generate":
        result = generate_skeleton(sys.argv[2], " ".join(sys.argv[3:]))
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif cmd == "fill":
        data = json.loads(sys.stdin.read())
        result = fill_details(data)
        print(json.dumps(result, ensure_ascii=False, indent=2))
