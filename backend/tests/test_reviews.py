from backend.stores.users import create_user
from backend.stores.items import create_item, submit_item
from backend.stores.reviews import (
    create_review_task, list_review_tasks, approve_review, reject_review, get_review_task,
)


def _article_owner():
    owner = create_user("alice", "pw")["id"]
    art = create_item(owner, "待审文章", "内容", form="article")
    submit_item(art["id"])
    return owner, art


def test_create_and_list_review_task():
    owner, art = _article_owner()
    task = create_review_task(art["id"])
    assert task["action"] == "pending"
    tasks = list_review_tasks()
    assert any(t["item_id"] == art["id"] for t in tasks)
    assert any(t["title"] == "待审文章" for t in tasks)


def test_approve_review_publishes_item():
    owner, art = _article_owner()
    create_review_task(art["id"])
    reviewer = create_user("adminx", "pw")["id"]
    task = approve_review(art["id"], reviewer, "内容准确")
    assert task["action"] == "approved"
    from backend.stores.items import get_item
    item = get_item(art["id"])
    assert item["status"] == "published" and item["scope"] == "team"


def test_reject_review_returns_to_draft():
    owner, art = _article_owner()
    create_review_task(art["id"])
    reviewer = create_user("adminy", "pw")["id"]
    task = reject_review(art["id"], reviewer, "需要补充引用")
    assert task["action"] == "rejected" and task["reason"] == "需要补充引用"
    from backend.stores.items import get_item
    assert get_item(art["id"])["status"] == "draft"


def test_get_review_task():
    owner, art = _article_owner()
    create_review_task(art["id"])
    assert get_review_task(art["id"]) is not None
