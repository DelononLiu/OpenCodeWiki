from backend.stores.users import create_user
from backend.stores.items import (
    create_item, get_item, list_items, update_item, publish_card,
    submit_item, approve_item, reject_item, delete_item, add_link, list_links,
)


def _users():
    a = create_user("alice", "pw")["id"]
    b = create_user("bob", "pw")["id"]
    return a, b

def test_create_and_get_item():
    owner, _ = _users()
    item = create_item(owner, "卡片一", "内容", form="card", scope="personal")
    assert item["status"] == "draft"
    got = get_item(item["id"])
    assert got["title"] == "卡片一" and got["owner_id"] == owner

def test_create_item_with_kb():
    owner, _ = _users()
    item = create_item(owner, "带库卡片", "内容", form="card", scope="team", kb_id="kb-abc")
    assert item["kb_id"] == "kb-abc"
    assert get_item(item["id"])["kb_id"] == "kb-abc"

def test_team_card_auto_published():
    owner, _ = _users()
    item = create_item(owner, "直接新增", "内容", form="card", scope="team")
    assert item["status"] == "published"

def test_visibility():
    alice, bob = _users()
    a_private = create_item(alice, "a私有", "x", scope="personal")
    team_card = create_item(alice, "团队卡", "y", form="card", scope="team")
    # alice 可见自己的私有 + 团队
    ids_a = {i["id"] for i in list_items(alice)}
    assert a_private["id"] in ids_a and team_card["id"] in ids_a
    # bob 看不到 alice 的私有
    ids_b = {i["id"] for i in list_items(bob)}
    assert a_private["id"] not in ids_b and team_card["id"] in ids_b

def test_filter_by_form_scope():
    owner, _ = _users()
    c = create_item(owner, "卡", "x", form="card", scope="team")
    a = create_item(owner, "文", "y", form="article", scope="team")
    assert [i["id"] for i in list_items(owner, form="card")] == [c["id"]]
    assert [i["id"] for i in list_items(owner, form="article")] == [a["id"]]

def test_keyword_search():
    owner, _ = _users()
    create_item(owner, "Kubernetes 部署指南", "内容", scope="team")
    hits = list_items(owner, q="kubernetes")
    assert len(hits) == 1

def test_update_item():
    owner, _ = _users()
    item = create_item(owner, "旧标题", "旧内容")
    updated = update_item(item["id"], title="新标题")
    assert updated["title"] == "新标题"
    assert updated["content_md"] == "旧内容"

def test_publish_card_to_team():
    owner, _ = _users()
    item = create_item(owner, "碎片", "内容")
    published = publish_card(item["id"])
    assert published["scope"] == "team" and published["status"] == "published"
    assert published["published_at"]

def test_publish_article_rejected():
    owner, _ = _users()
    art = create_item(owner, "文章", "内容", form="article")
    try:
        publish_card(art["id"])
        assert False, "article cannot publish directly"
    except ValueError:
        pass

def test_article_review_lifecycle():
    owner, _ = _users()
    art = create_item(owner, "文章", "内容", form="article")
    assert submit_item(art["id"])["status"] == "pending"
    assert approve_item(art["id"])["status"] == "published"
    assert get_item(art["id"])["scope"] == "team"

def test_reject_returns_to_draft():
    owner, _ = _users()
    art = create_item(owner, "文章", "内容", form="article")
    submit_item(art["id"])
    assert reject_item(art["id"])["status"] == "draft"
    assert get_item(art["id"])["scope"] == "personal"

def test_delete_item():
    owner, _ = _users()
    item = create_item(owner, "要删", "x")
    delete_item(item["id"])
    assert get_item(item["id"]) is None

def test_links():
    owner, _ = _users()
    a = create_item(owner, "卡A", "x", scope="team")
    b = create_item(owner, "卡B", "y", scope="team")
    add_link(a["id"], b["id"], "references")
    links = list_links(a["id"])
    assert any(l["id"] == b["id"] for l in links)
