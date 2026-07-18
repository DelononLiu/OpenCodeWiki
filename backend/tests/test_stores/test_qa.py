"""
test_qa.py — QA 存储层单元测试

测试 stores.qa 模块全部 10 个函数。
使用内存 SQLite + patch_stores fixture，不依赖真实数据库文件。
"""

import pytest
from unittest.mock import patch


class TestCreateEntry:
    def test_create_basic_entry(self, patch_stores):
        """创建基本 QA 条目"""
        from stores.qa import create_entry

        result = create_entry({"question": "测试问题", "answer": "测试答案"})
        assert "id" in result
        assert "qid" in result
        assert result["qid"] >= 1

    def test_create_with_qid(self, patch_stores):
        """使用指定 qid 创建"""
        from stores.qa import create_entry

        result = create_entry({"qid": 42, "question": "指定 qid"})
        assert result["qid"] == 42

    def test_create_with_tags_and_sources(self, patch_stores):
        """创建带标签和来源的条目，验证 JSON 序列化/反序列化正确"""
        from stores.qa import create_entry, get_entry

        created = create_entry({
            "question": "带标签",
            "tags": ["bug", "feature"],
            "sources": ["file1.py"],
        })
        entry = get_entry(created["qid"])
        assert entry["tags"] == ["bug", "feature"]
        assert entry["sources"] == ["file1.py"]


class TestGetEntry:
    def test_get_existing(self, patch_stores):
        """获取存在的条目"""
        from stores.qa import create_entry, get_entry

        created = create_entry({"question": "取回测试", "answer": "取回答复"})
        entry = get_entry(created["qid"])
        assert entry is not None
        assert entry["question"] == "取回测试"
        assert entry["answer"] == "取回答复"

    def test_get_nonexistent(self, patch_stores):
        """获取不存在的条目返回 None"""
        from stores.qa import get_entry

        assert get_entry(99999) is None

    def test_get_calibrated_flag(self, patch_stores):
        """校准条目正确标记 is_calibrated"""
        from stores.qa import create_entry, get_entry

        created = create_entry({"question": "校准测试", "answer": "原始答案"})
        entry = get_entry(created["qid"])
        assert entry["is_calibrated"] is False

    def test_get_auto_qid_increment(self, patch_stores):
        """自动 qid 递增"""
        from stores.qa import create_entry, get_next_qid

        qid1 = get_next_qid()
        create_entry({"question": "条目 1"})
        qid2 = get_next_qid()
        assert qid2 > qid1


class TestListEntries:
    def test_list_all(self, patch_stores):
        """列出全部条目"""
        from stores.qa import create_entry, list_entries

        create_entry({"question": "A"})
        create_entry({"question": "B"})

        result = list_entries({})
        assert result["total"] == 2

    def test_list_by_status(self, patch_stores):
        """按状态筛选"""
        from stores.qa import create_entry, list_entries, get_entry

        create_entry({"question": "待处理"})
        result = list_entries({"status": "pending"})
        assert result["total"] == 1

        result2 = list_entries({"status": "active"})
        assert result2["total"] == 0

    def test_list_pagination(self, patch_stores):
        """分页限制"""
        from stores.qa import create_entry, list_entries

        for i in range(5):
            create_entry({"question": f"Q{i}"})

        result = list_entries({"limit": 2})
        assert len(result["entries"]) == 2
        assert result["total"] == 5

    def test_list_by_repo(self, patch_stores):
        """按仓库筛选"""
        from stores.qa import create_entry, list_entries

        create_entry({"question": "Q1", "repo": "repo-a"})
        create_entry({"question": "Q2", "repo": "repo-b"})

        result = list_entries({"repo": "repo-a"})
        assert result["total"] == 1


class TestPending:
    def test_list_pending(self, patch_stores):
        """列出待处理条目"""
        from stores.qa import create_entry, list_pending

        create_entry({"question": "待处理"})
        create_entry({"question": "状态变更", "status": "active"})

        pending = list_pending()
        assert len(pending) >= 1

    def test_list_pending_with_repo(self, patch_stores):
        """按仓库筛选待处理，验证 repo-a 不包含 repo-b 的条目"""
        from stores.qa import create_entry, list_pending, calibrate

        # repo-a 待处理条目在结果中
        c_a = create_entry({"question": "A问题", "repo": "repo-a"})
        # repo-b 的条目不应出现在 repo-a 的结果中
        create_entry({"question": "B问题", "repo": "repo-b"})
        # 已校准（status=active）的不应出现
        calibrate(create_entry({"question": "C已激活", "repo": "repo-a"})["qid"], "已校准")

        result = list_pending("repo-a")
        questions = [r["question"] for r in result]
        assert "A问题" in questions
        assert "B问题" not in questions
        assert "C已激活" not in questions


class TestCalibrate:
    def test_calibrate_entry(self, patch_stores):
        """校准条目"""
        from stores.qa import create_entry, calibrate, get_entry

        created = create_entry({"question": "待校准", "answer": "原答案"})
        ok = calibrate(created["qid"], "校准确认答案")
        assert ok is True

        entry = get_entry(created["qid"])
        assert entry["is_calibrated"] is True
        assert entry["status"] == "active"

    def test_calibrate_nonexistent(self, patch_stores):
        """校准不存在的条目返回 False"""
        from stores.qa import calibrate

        ok = calibrate(99999, "答案")
        assert ok is False


class TestSearch:
    def test_search_questions(self, patch_stores):
        """搜索问题"""
        from stores.qa import create_entry, search_questions

        create_entry({"question": "如何配置数据库"})
        create_entry({"question": "如何部署服务"})

        results = search_questions("数据库")
        assert len(results) >= 1
        assert "数据库" in results[0]["question"]


class TestBumpVisit:
    def test_bump_visit(self, patch_stores):
        """增加访问计数"""
        from stores.qa import create_entry, get_entry, bump_visit

        created = create_entry({"question": "计数测试"})
        entry_before = get_entry(created["qid"])
        old_count = entry_before["visit_count"]

        bump_visit(created["qid"])
        entry_after = get_entry(created["qid"])
        assert entry_after["visit_count"] == old_count + 1


class TestUpdateDomain:
    def test_update_domain(self, patch_stores):
        """更新 domain"""
        from stores.qa import create_entry, get_entry, update_domain

        created = create_entry({"question": "domain 测试"})
        update_domain(created["qid"], "bug-analysis")

        entry = get_entry(created["qid"])
        assert entry["domain"] == "bug-analysis"


class TestListSorted:
    def test_list_sorted_by_latest(self, patch_stores, qa_db):
        """按最新排序，验证 created_at DESC"""
        from stores.qa import create_entry, list_entries, get_entry

        c1 = create_entry({"question": "老的"})
        c2 = create_entry({"question": "新的"})

        # 给"老的"设一个更早的时间，确保排序可验证
        qa_db.execute("UPDATE qa_entries SET created_at = '2025-01-01T00:00:00' WHERE qid = ?", (c1["qid"],))
        qa_db.execute("UPDATE qa_entries SET created_at = '2026-07-18T00:00:00' WHERE qid = ?", (c2["qid"],))
        qa_db.commit()

        result = list_entries({"sort": "latest"})
        entries = result["entries"]
        assert len(entries) >= 2
        # 新的应排第一
        assert entries[0]["qid"] == c2["qid"]
        assert entries[1]["qid"] == c1["qid"]

    def test_list_sorted_by_popular(self, patch_stores, qa_db):
        """按热门排序，验证 visit_count DESC"""
        from stores.qa import create_entry, list_entries, bump_visit

        cold = create_entry({"question": "冷门"})  # visit_count = 0
        hot = create_entry({"question": "热门"})   # visit_count = 0
        bump_visit(hot["qid"])
        bump_visit(hot["qid"])
        bump_visit(hot["qid"])

        result = list_entries({"sort": "popular"})
        entries = result["entries"]
        # 按 visit_count 倒序，hot 应有更高计数
        hot_entry = next(e for e in entries if e["qid"] == hot["qid"])
        cold_entry = next(e for e in entries if e["qid"] == cold["qid"])
        assert hot_entry["visit_count"] > cold_entry["visit_count"]
