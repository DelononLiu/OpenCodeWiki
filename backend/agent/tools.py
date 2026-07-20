"""
Tools: codegraph 工具（直连 codebase-memory-mcp CLI）。

通过 subprocess 直接调 codebase-memory-mcp 二进制，不再经过 TS Express 代理。
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from langchain_core.tools import tool

from stores.sources import REPOS_DIR

# ── 配置 ─────────────────────────────────────────────────────

REGISTRY_PATH = Path.home() / ".opencodewiki" / "registry.json"
BINARY_NAMES = ["codebase-memory-mcp"]


def _find_binary() -> str:
    """查找 codebase-memory-mcp 二进制"""
    # 1. 环境变量
    env = os.environ.get("CBM_BINARY")
    if env:
        return env
    # 2. PATH
    for name in BINARY_NAMES:
        which = subprocess.run(["which", name], capture_output=True, text=True)
        if which.returncode == 0:
            return which.stdout.strip()
    # 3. ~/.codebase-memory/bin/
    home_bin = Path.home() / ".codebase-memory" / "bin" / BINARY_NAMES[0]
    if home_bin.exists():
        return str(home_bin)
    # fallback
    return BINARY_NAMES[0]


BINARY = _find_binary()

# 最大输出字符数，防止撑爆 LLM 上下文
MAX_OUTPUT = 10000


def _log(msg: str):
    print(f"[tools] {msg}", file=sys.stderr)


def _repo_path_to_project_name(p: str) -> str:
    """路径转项目名：/home/user/repo → home-user-repo"""
    return p.lstrip("/").replace("/", "-")


def _load_registry() -> list[dict]:
    """读取仓库注册表"""
    try:
        return json.loads(REGISTRY_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _project_for_repo(repo_name: str) -> str | None:
    """根据仓库名获取 codebase-memory-mcp 的项目名。
    优先匹配 registry，未匹配则从 CLI list_projects 查找。"""
    registry = _load_registry()
    # 1. 先在 registry 中按 name 匹配
    for entry in registry:
        if entry.get("name") == repo_name:
            # 尝试 CLI 已索引的项目名
            candidates = _list_cbm_projects()
            for proj in candidates:
                if entry["name"].lower() in proj.lower():
                    return proj
    # 2. repo 名直接匹配 CLI 项目
    candidates = _list_cbm_projects()
    if repo_name:
        for proj in candidates:
            if repo_name.lower().replace(" ", "-") in proj.lower():
                return proj
    # 3. 没有匹配也没指定：返回第一个 (最重要的那个)
    if candidates:
        return candidates[-1]  # 最后注册的通常是当前项目
    return None


_cbm_projects_cache: list[str] | None = None

def _list_cbm_projects() -> list[str]:
    """调用 CLI list_projects 获取已索引的项目名列表（缓存）。"""
    global _cbm_projects_cache
    if _cbm_projects_cache is not None:
        return _cbm_projects_cache
    try:
        result = _call_cli("list_projects", {})
        data = json.loads(result)
        _cbm_projects_cache = [p["name"] for p in data.get("projects", [])]
    except Exception:
        _cbm_projects_cache = []
    return _cbm_projects_cache


# ── CLI 调用 ────────────────────────────────────────────────

def _call_cli(tool: str, args: dict) -> str:
    """调用 codebase-memory-mcp CLI"""
    cli_args = [BINARY, "cli", tool, json.dumps(args)]
    _log(f"CLI: {BINARY} cli {tool} ({json.dumps({k: v for k, v in args.items() if k != 'query' or len(str(v)) < 60})})")
    try:
        result = subprocess.run(
            cli_args,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            _log(f"  CLI ERROR ({result.returncode}): {stderr[:200]}")
            return stderr or f"Error: exit code {result.returncode}"
        # 取最后一行的 JSON（前面的行是日志）
        lines = result.stdout.strip().split("\n")
        for line in reversed(lines):
            line = line.strip()
            if line.startswith("{"):
                output = line
                if len(output) > MAX_OUTPUT:
                    output = output[:MAX_OUTPUT] + '...}'
                    _log(f"  (truncated to {MAX_OUTPUT} chars)")
                return output
        output = result.stdout
        if len(output) > MAX_OUTPUT:
            output = output[:MAX_OUTPUT] + '...'
        return output
    except subprocess.TimeoutExpired:
        return '{"error": "CLI timeout"}'
    except FileNotFoundError:
        return '{"error": "codebase-memory-mcp binary not found"}'


# ── 工具函数 ────────────────────────────────────────────────

def _normalize_args(tool: str, args: dict) -> dict:
    """参数规范化：映射到 CLI 接受的字段名"""
    mapped = dict(args)

    # project 名转换
    if "project" in mapped and mapped["project"]:
        proj = _project_for_repo(mapped["project"])
        if proj:
            mapped["project"] = proj

    if tool == "search_code":
        # search_code 用 pattern 不是 query
        if "query" in mapped and "pattern" not in mapped:
            mapped["pattern"] = mapped.pop("query")

    if tool == "get_code_snippet":
        # get_code_snippet 需要 qualified_name（全限定名）
        # 如果传入的是裸 symbol，用 search_graph 查出全名
        if "symbol" in mapped and "qualified_name" not in mapped:
            sym = mapped.pop("symbol")
            # 先试试直接当 qualified_name 用
            mapped["qualified_name"] = sym
        if "name" in mapped and "qualified_name" not in mapped:
            mapped["qualified_name"] = mapped.pop("name")

    if tool == "trace_path":
        if "symbol" in mapped:
            mapped["function_name"] = mapped.pop("symbol")

    if tool == "search_graph":
        if "maxResults" in mapped:
            mapped["limit"] = mapped.pop("maxResults")
        # search_graph 不支持 path 参数，改为 query
        if "path" in mapped:
            mapped["query"] = mapped.pop("path")
        # 确保有 query
        if "query" not in mapped:
            mapped["query"] = "."

    return mapped


# ── 工具映射表 ──────────────────────────────────────────────

TOOL_MAP = {
    "codegraph_search": "search_graph",
    "codegraph_context": "get_code_snippet",
    "codegraph_callers": "trace_path",
    "codegraph_callees": "trace_path",
    "codegraph_impact": "trace_path",
    "codegraph_status": "index_status",
    "codegraph_node": "get_code_snippet",
    "codegraph_explore": "search_code",
    "codegraph_files": "search_graph",
}

DIRECTION_MAP = {
    "codegraph_callers": "inbound",
    "codegraph_callees": "outbound",
    "codegraph_impact": "both",
}


# ── 9 个工具 + grep ─────────────────────────────────────────

@tool
async def code_search(query: str, project: str = "") -> str:
    """
    语义搜索代码。根据自然语言描述搜索代码符号和定义。
    用于：了解某个功能/模块/概念的代码位置。
    """
    args = {"query": query}
    if project:
        args["project"] = project
    tool_name = TOOL_MAP["codegraph_search"]
    result = _call_cli(tool_name, _normalize_args(tool_name, args))
    return result


@tool
async def code_context(symbol: str, project: str = "") -> str:
    """
    获取符号的完整上下文定义。传入函数名、类名、变量名等符号名。
    用于：查看某个函数/类的完整实现代码。
    """
    args = {"qualified_name": symbol}
    if project:
        args["project"] = project
    result = _call_cli("get_code_snippet", _normalize_args("get_code_snippet", args))
    # 如果失败（qualified_name 格式不对），用 search_graph 查出全限定名再试
    if "qualified_name is required" in result or "error" in result.lower():
        search_result = _call_cli("search_graph", {"query": symbol, "limit": 1})
        try:
            data = json.loads(search_result)
            if data.get("results"):
                qn = data["results"][0].get("qualified_name")
                if qn:
                    args["qualified_name"] = qn
                    result = _call_cli("get_code_snippet", args)
        except (json.JSONDecodeError, KeyError, IndexError):
            pass
    return result


@tool
async def code_callers(symbol: str, project: str = "") -> str:
    """
    追踪谁调用了指定的函数/方法。
    用于：分析调用链上游——"这个函数被谁调用了"。
    """
    args = {"symbol": symbol, "direction": "inbound"}
    if project:
        args["project"] = project
    result = _call_cli("trace_path", _normalize_args("trace_path", args))
    return result


@tool
async def code_callees(symbol: str, project: str = "") -> str:
    """
    追踪指定的函数调用了谁。
    用于：分析调用链下游——"这个函数调用了哪些其他函数"。
    """
    args = {"symbol": symbol, "direction": "outbound"}
    if project:
        args["project"] = project
    result = _call_cli("trace_path", _normalize_args("trace_path", args))
    return result


@tool
async def code_impact(symbol: str, project: str = "", depth: int = 2) -> str:
    """
    影响范围分析——双向追踪调用链（上游 + 下游）。
    用于：评估修改某个函数会影响到哪些代码。
    """
    args = {"symbol": symbol, "direction": "both", "depth": depth}
    if project:
        args["project"] = project
    result = _call_cli("trace_path", _normalize_args("trace_path", args))
    return result


@tool
async def code_files(path_pattern: str, project: str = "") -> str:
    """
    按路径模式搜索文件列表。
    用于：查找特定目录或文件模式下的文件。
    """
    args = {"path": path_pattern}
    if project:
        args["project"] = project
    tool_name = TOOL_MAP["codegraph_files"]
    result = _call_cli(tool_name, _normalize_args(tool_name, args))
    return result


@tool
async def code_node(node_id: str) -> str:
    """
    获取代码节点（AST 节点）的详细信息。
    用于：查看某个符号在 AST 中的精确位置和类型。
    """
    args = {"id": node_id}
    result = _call_cli("get_code_snippet", args)
    return result


@tool
async def code_explore(query: str, project: str = "") -> str:
    """
    探索式代码搜索——比 search 更宽泛的模糊匹配。
    用于：不确定具体符号名、想粗略了解某个区域的代码。
    """
    args = {"query": query}
    if project:
        args["project"] = project
    result = _call_cli("search_code", _normalize_args("search_code", args))
    return result


@tool
async def code_status() -> str:
    """
    获取代码索引引擎的状态。
    用于：检查索引是否就绪、统计信息。
    """
    result = _call_cli("index_status", {})
    return result


@tool
async def code_grep(pattern: str, project: str = "") -> str:
    """
    文本搜索代码内容。基于 ripgrep 实现。
    用于：搜索具体字符串、宏定义、编译选项等。
    """
    rg_path = Path(__file__).parent.parent.parent / "vendor" / "rg"
    if not rg_path.exists():
        return '{"error": "rg binary not found in vendor/"}'

    # 查找 repo 路径。无指定 project 时搜所有导入源目录
    if project:
        registry = _load_registry()
        search_dir = str(Path.cwd())
        for entry in registry:
            if entry.get("name") == project:
                search_dir = str(REPOS_DIR / entry["name"])
                break
    else:
        search_dir = str(REPOS_DIR)

    try:
        result = subprocess.run(
            [str(rg_path), "--no-heading", "-n", pattern, search_dir],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 1:
            return ""  # no matches
        result.check_returncode()
        output = result.stdout
        if len(output) > MAX_OUTPUT:
            output = output[:MAX_OUTPUT] + "\n...(truncated)"
        return output
    except subprocess.TimeoutExpired:
        return '{"error": "rg timeout"}'
    except Exception as e:
        return f'{{"error": "{e}"}}'


@tool
async def code_read_wiki(project: str = "") -> str:
    """
    读取项目的 wiki 文档（由 opencodewiki 生成）。
    从 ~/.opencodewiki/repos/{project_name}/openwiki/ 目录读取。
    用于：回答前了解项目背景、架构、工作流，使回答更准确。
    """
    registry = _load_registry()
    if not project:
        return "wiki not found"
    # 验证项目在注册表中
    found = any(entry.get("name") == project for entry in registry)
    if not found:
        return "wiki not found"
    # openwiki CLI 输出到 openwiki/ 目录
    wiki_base = REPOS_DIR / project / "openwiki"
    if not wiki_base.exists():
        return "wiki not found"
    qs = wiki_base / "quickstart.md"
    if qs.exists():
        text = qs.read_text()
        if len(text) > 4000:
            text = text[:4000] + "\n...(truncated)"
        return text
    # Try reading all .md files and concatenate them
    parts = []
    for md_path in sorted(wiki_base.glob("*.md")):
        text = md_path.read_text()
        if len(text) > 4000:
            text = text[:4000] + "\n...(truncated)"
        parts.append(text)
    if parts:
        return "\n\n---\n\n".join(parts)
    return "wiki not found"


@tool
async def code_list_repos() -> str:
    """
    列出所有已索引的代码仓库。
    用于：首次搜索前了解可用的仓库列表。
    """
    registry = _load_registry()
    return json.dumps([{"name": r["name"]} for r in registry], ensure_ascii=False)


# ── 工具列表 ─────────────────────────────────────────────────

CODEGRAPH_TOOLS = [
    code_list_repos,
    code_read_wiki,
    code_grep,
    code_search,
    code_context,
    code_callers,
    code_callees,
    code_impact,
    code_files,
    code_node,
    code_explore,
    code_status,
]
