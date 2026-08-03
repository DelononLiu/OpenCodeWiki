import os
import uuid
from backend.database import get_knora_db

_NODE_COLS = "id, parent_id, name, item_id, file_path, sort_order, created_at"


def create_node(name: str, parent_id: str | None = None, item_id: str | None = None,
                file_path: str = "") -> dict:
    db = get_knora_db()
    if parent_id and not db.execute("SELECT id FROM wiki_nodes WHERE id = ?", (parent_id,)).fetchone():
        raise ValueError("父节点不存在")
    node_id = f"wn-{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO wiki_nodes (id, parent_id, name, item_id, file_path) VALUES (?, ?, ?, ?, ?)",
        (node_id, parent_id, name or "", item_id, file_path or ""),
    )
    db.commit()
    return get_node(node_id)


def get_node(node_id: str) -> dict | None:
    db = get_knora_db()
    row = db.execute(f"SELECT {_NODE_COLS} FROM wiki_nodes WHERE id = ?", (node_id,)).fetchone()
    return _row_to_dict(row) if row else None


def list_tree() -> list[dict]:
    """返回嵌套森林：每个根节点含 children 递归。"""
    db = get_knora_db()
    rows = db.execute(f"SELECT {_NODE_COLS} FROM wiki_nodes ORDER BY sort_order, created_at").fetchall()
    nodes = {r[0]: _row_to_dict(r) for r in rows}
    roots = []
    for n in nodes.values():
        n["children"] = []
    for n in nodes.values():
        if n["parent_id"] and n["parent_id"] in nodes:
            nodes[n["parent_id"]]["children"].append(n)
        else:
            roots.append(n)
    return roots


def attach_item(node_id: str, item_id: str) -> dict:
    db = get_knora_db()
    if not db.execute("SELECT id FROM knowledge_items WHERE id = ?", (item_id,)).fetchone():
        raise ValueError("知识项不存在")
    db.execute(
        "UPDATE wiki_nodes SET item_id = ?, file_path = '' WHERE id = ?",
        (item_id, node_id),
    )
    db.commit()
    return get_node(node_id)


def move_node(node_id: str, new_parent_id: str | None, sort_order: int | None = None) -> None:
    if new_parent_id == node_id:
        raise ValueError("不能移动到自身下")
    # 防环：新父不能是自己的子孙
    if new_parent_id:
        cur = get_node(new_parent_id)
        while cur:
            if cur["id"] == node_id:
                raise ValueError("不能移动到自己的子树内")
            cur = get_node(cur["parent_id"]) if cur["parent_id"] else None
    db = get_knora_db()
    if sort_order is not None:
        db.execute("UPDATE wiki_nodes SET parent_id = ?, sort_order = ? WHERE id = ?",
                   (new_parent_id, sort_order, node_id))
    else:
        db.execute("UPDATE wiki_nodes SET parent_id = ? WHERE id = ?",
                   (new_parent_id, node_id))
    db.commit()


def delete_node(node_id: str) -> None:
    db = get_knora_db()
    db.execute("DELETE FROM wiki_nodes WHERE id = ?", (node_id,))
    db.commit()


def get_node_content(node_id: str) -> dict | None:
    """渲染节点：有 item_id 查知识项；否则有 file_path 读文件。"""
    node = get_node(node_id)
    if not node:
        return None
    if node["item_id"]:
        from backend.stores.items import get_item
        item = get_item(node["item_id"])
        if not item:
            return {"node": node, "content": "", "title": node["name"]}
        return {"node": node, "content": item["content_md"], "title": item["title"] or node["name"]}
    if node["file_path"] and os.path.isfile(node["file_path"]):
        with open(node["file_path"], encoding="utf-8") as f:
            return {"node": node, "content": f.read(), "title": node["name"]}
    return {"node": node, "content": "", "title": node["name"]}


def _row_to_dict(row) -> dict:
    return {
        "id": row[0], "parent_id": row[1], "name": row[2],
        "item_id": row[3], "file_path": row[4],
        "sort_order": row[5], "created_at": row[6],
    }
