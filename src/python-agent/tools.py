"""
Tools: codegraph 工具注册。

通过 httpx 调用 TS codegraph-bridge 的 HTTP API（端口 4747）。
9 个工具 + 1 个 grep 工具，全部是纯转发，无业务逻辑。
"""

import json
import sys
from typing import Optional

import httpx
from langchain_core.tools import tool

from config import get_codegraph_bridge_url


def _ts_url(path: str) -> str:
    base = get_codegraph_bridge_url()
    url = f"{base}{path}"
    return url


def _log(msg: str):
    print(f"[tools] {msg}", file=sys.stderr)


async def _post(path: str, body: dict = None) -> str:
    """POST 请求 TS API，返回文本响应"""
    url = _ts_url(path)
    _log(f"POST {url}")
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=body or {})
        _log(f"  → {resp.status_code}")
        resp.raise_for_status()
        return resp.text


async def _get(path: str) -> str:
    """GET 请求 TS API"""
    url = _ts_url(path)
    _log(f"GET {url}")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        _log(f"  → {resp.status_code}")
        resp.raise_for_status()
        return resp.text


# ── 9 个 codegraph 工具 ───────────────────────────────────────────


@tool
async def code_search(query: str, project: Optional[str] = None) -> str:
    """
    语义搜索代码。根据自然语言描述搜索代码符号和定义。
    用于：了解某个功能/模块/概念的代码位置。
    """
    body = {"query": query}
    if project:
        body["projectPath"] = project
    return await _post("/api/codegraph/search", body)


@tool
async def code_context(symbol: str, project: Optional[str] = None) -> str:
    """
    获取符号的完整上下文定义。传入函数名、类名、变量名等符号名。
    用于：查看某个函数/类的完整实现代码。
    """
    body = {"symbol": symbol}
    if project:
        body["projectPath"] = project
    return await _post("/api/codegraph/context", body)


@tool
async def code_callers(symbol: str, project: Optional[str] = None) -> str:
    """
    追踪谁调用了指定的函数/方法。
    用于：分析调用链上游——"这个函数被谁调用了"。
    """
    body = {"function_name": symbol}
    if project:
        body["project"] = project
    return await _post("/api/codegraph/callers", body)


@tool
async def code_callees(symbol: str, project: Optional[str] = None) -> str:
    """
    追踪指定的函数调用了谁。
    用于：分析调用链下游——"这个函数调用了哪些其他函数"。
    """
    body = {"function_name": symbol}
    if project:
        body["project"] = project
    return await _post("/api/codegraph/callees", body)


@tool
async def code_impact(symbol: str, project: Optional[str] = None, depth: int = 2) -> str:
    """
    影响范围分析——双向追踪调用链（上游 + 下游）。
    用于：评估修改某个函数会影响到哪些代码。
    """
    body = {"function_name": symbol, "depth": depth}
    if project:
        body["project"] = project
    return await _post("/api/codegraph/impact", body)


@tool
async def code_files(path_pattern: str, project: Optional[str] = None) -> str:
    """
    按路径模式搜索文件列表。
    用于：查找特定目录或文件模式下的文件。
    """
    body = {"path": path_pattern}
    if project:
        body["projectPath"] = project
    return await _post("/api/codegraph/files", body)


@tool
async def code_node(node_id: str, project: Optional[str] = None) -> str:
    """
    获取代码节点（AST 节点）的详细信息。
    用于：查看某个符号在 AST 中的精确位置和类型。
    """
    body = {"id": node_id}
    if project:
        body["projectPath"] = project
    return await _post("/api/codegraph/node", body)


@tool
async def code_explore(query: str, project: Optional[str] = None) -> str:
    """
    探索式代码搜索——比 search 更宽泛的模糊匹配。
    用于：不确定具体符号名、想粗略了解某个区域的代码。
    """
    body = {"query": query}
    if project:
        body["projectPath"] = project
    return await _post("/api/codegraph/explore", body)


@tool
async def code_status() -> str:
    """
    获取代码索引引擎的状态。
    用于：检查索引是否就绪、统计信息。
    """
    return await _get("/api/codegraph/status")


@tool
async def code_grep(pattern: str, project: str = "") -> str:
    """
    文本搜索代码内容。基于 ripgrep 实现，比语义搜索更适合：
    - 搜索具体字符串、错误码、宏定义、函数调用
    - 搜索配置文件内容（CMakeLists.txt、Makefile、package.json 等）
    - 不确定符号名时用文本搜索定位

    参数：
      pattern: 搜索关键词（支持正则）
      project: 仓库名（来自 code_list_repos），不传则搜所有
    """
    body = {"pattern": pattern}
    if project:
        body["project"] = project
    return await _post("/api/codegraph/grep", body)


@tool
async def code_list_repos() -> str:
    """
    列出所有已索引的代码仓库。
    用于：首次搜索前了解可用的仓库列表，然后使用 code_search 时指定 project 参数。

    返回格式：[{"name":"仓库名","stats":{...}}]
    """
    return await _get("/api/repos")


# ── 工具列表 ─────────────────────────────────────────────────────

CODEGRAPH_TOOLS = [
    code_list_repos,      # 放在首位，Agent 会先了解可用仓库
    code_grep,            # ripgrep 文本搜索
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
