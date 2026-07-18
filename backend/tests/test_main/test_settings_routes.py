"""
test_settings_routes.py — /api/settings 路由测试
"""

import json
from unittest.mock import patch


class TestSettings:
    def test_get_default_settings(self, client, tmp_path):
        """GET /api/settings 返回默认配置"""
        config_path = tmp_path / ".opencodewiki" / "config.json"
        config_path.parent.mkdir(parents=True)

        with patch("main.CONFIG_PATH", config_path):
            resp = client.get("/api/settings")
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is True
            assert "general" in data["data"]
            assert "model" in data["data"]

    def test_get_saved_settings(self, client, tmp_path):
        """GET /api/settings 返回已保存配置"""
        config_path = tmp_path / ".opencodewiki" / "config.json"
        config_path.parent.mkdir(parents=True)
        config_path.write_text(json.dumps({
            "general": {"site_name": "MyWiki"},
            "model": {"provider": "deepseek"},
        }))

        with patch("main.CONFIG_PATH", config_path):
            resp = client.get("/api/settings")
            data = resp.json()
            assert data["data"]["general"]["site_name"] == "MyWiki"
            assert data["data"]["model"]["provider"] == "deepseek"

    def test_update_settings(self, client, tmp_path):
        """PUT /api/settings 更新配置"""
        config_path = tmp_path / ".opencodewiki" / "config.json"
        config_path.parent.mkdir(parents=True)
        config_path.write_text(json.dumps({
            "general": {"site_name": "Old"},
            "model": {"provider": "openai"},
        }))

        with patch("main.CONFIG_PATH", config_path):
            resp = client.put("/api/settings", json={
                "section": "general",
                "data": {"site_name": "NewName"},
            })
            assert resp.status_code == 200
            assert resp.json()["data"]["saved"] is True

            # 验证已持久化
            saved = json.loads(config_path.read_text())
            assert saved["general"]["site_name"] == "NewName"
            assert saved["model"]["provider"] == "openai"  # 未修改部分不变

    def test_update_invalid_section(self, client, tmp_path):
        """PUT /api/settings 无效 section 返回错误"""
        config_path = tmp_path / ".opencodewiki" / "config.json"
        config_path.parent.mkdir(parents=True)
        config_path.write_text("{}")

        with patch("main.CONFIG_PATH", config_path):
            resp = client.put("/api/settings", json={
                "section": "invalid",
                "data": {},
            })
            assert resp.status_code == 400
