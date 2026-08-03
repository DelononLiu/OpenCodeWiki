import tempfile
from backend.database import init_databases
from backend.config import Config
from backend.stores.users import create_user
from backend.stores.items import create_item
from backend.stores.wiki_tree import (
    create_node, get_node, list_tree, attach_item, move_node, delete_node, get_node_content,
)


def setup_module():
    cfg = Config()
    cfg.database.path = tempfile.mkdtemp()
    init_databases(cfg)

def test_create_and_get_node():
    root = create_node("产品文档")
    assert root["name"] == "产品文档" and root["parent_id"] is None
    child = create_node("指南", parent_id=root["id"])
    assert get_node(child["id"])["parent_id"] == root["id"]

def test_tree_returns_nested_forest():
    a = create_node("根A")
    b = create_node("根B")
    c = create_node("子", parent_id=a["id"])
    tree = list_tree()
    names = {n["name"]: n for n in tree}
    assert "根A" in names and "根B" in names
    assert any(ch["id"] == c["id"] for ch in names["根A"]["children"])

def test_attach_item_to_node():
    owner = create_user("alice", "pw")["id"]
    item = create_item(owner, "文章一", "# 内容", form="article", scope="team")
    node = create_node("文章一")
    attached = attach_item(node["id"], item["id"])
    assert attached["item_id"] == item["id"]
    content = get_node_content(node["id"])
    assert content["content"] == "# 内容"

def test_move_node_rejects_cycle():
    a = create_node("父")
    b = create_node("子", parent_id=a["id"])
    try:
        move_node(a["id"], b["id"])  # 把父移到子下面 → 环
        assert False, "should reject cycle"
    except ValueError:
        pass

def test_delete_node_cascades():
    a = create_node("父")
    b = create_node("子", parent_id=a["id"])
    delete_node(a["id"])
    assert get_node(a["id"]) is None and get_node(b["id"]) is None

def test_node_content_from_file(tmp_path):
    md = tmp_path / "legacy.md"
    md.write_text("# 旧文件\n内容", encoding="utf-8")
    node = create_node("旧文件", file_path=str(md))
    content = get_node_content(node["id"])
    assert "旧文件" in content["content"]

def test_migrate_legacy_tree(tmp_path):
    from backend.stores.wiki_tree import migrate_legacy_tree, list_tree
    kb_dir = tmp_path / "knowledge" / "默认知识库"
    kb_dir.mkdir(parents=True)
    (kb_dir / "readme.md").write_text("# readme", encoding="utf-8")
    (kb_dir / "guide.md").write_text("# guide", encoding="utf-8")
    pages = tmp_path / "pages"
    pages.mkdir(parents=True)
    (pages / "archive.md").write_text("# archive", encoding="utf-8")
    n = migrate_legacy_tree(str(tmp_path / "knowledge"), str(pages))
    # knowledge 根(1) + readme(1) + guide(1) + pages 根(1) + archive(1) = 5
    assert n == 5
    tree = list_tree()
    assert any(r["name"] == "默认知识库" for r in tree)
    assert any(r["name"] == "pages" for r in tree)
    # 幂等：再跑一次不新增
    assert migrate_legacy_tree(str(tmp_path / "knowledge"), str(pages)) == 0
