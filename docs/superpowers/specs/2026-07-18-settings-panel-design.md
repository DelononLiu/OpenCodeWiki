# 设置面板 Design Spec

## 概述

新增独立 `/settings` 页面，提供系统通用配置和模型配置。从 Header 用户下拉"个人设置"进入。配置存储为 `config.json`。

## 页面布局

```
/settings
┌─ Header ───────────────────────────────────────────┐
│ [W OpenCodeWiki]             [首页] [Wiki] [问答] [👤] │
├─ 左侧栏 ──┬─ 主内容区 ──────────────────────────────┤
│ 设置导航    │                                         │
│            │  ┌─ 通用设置 ────────────────────────┐  │
│ 📋 通用     │  │ 系统名称: [OpenCodeWiki        ]  │  │
│            │  │ [保存]                            │  │
│ 🤖 模型     │  └──────────────────────────────────┘  │
│            │                                         │
│            │  ┌─ 模型配置 ────────────────────────┐  │
│            │  │ Provider:  [OpenAI / Anthropic ▼]  │  │
│            │  │ API Key:   [sk-xxxx...         ]  │  │
│            │  │ Model:     [gpt-4o            ▼]  │  │
│            │  │ Temperature: [0.7          ▬▬  ]  │  │
│            │  │ [测试连接] [保存]                  │  │
│            │  └──────────────────────────────────┘  │
└────────────┴─────────────────────────────────────────┘
```

## API 设计

### `GET /api/settings`

返回当前配置：

```json
{
  "ok": true,
  "data": {
    "general": { "site_name": "OpenCodeWiki" },
    "model": {
      "provider": "openai",
      "api_key": "sk-xxxx",
      "model": "gpt-4o",
      "temperature": 0.7
    }
  }
}
```

### `PUT /api/settings`

保存配置：

```json
// request
{
  "section": "model",
  "data": {
    "provider": "anthropic",
    "api_key": "sk-ant-xxxx",
    "model": "claude-sonnet-5",
    "temperature": 0.3
  }
}

// response
{ "ok": true, "data": { "saved": true } }
```

## 配置存储

`~/.opencodewiki/config.json`：

```json
{
  "general": { "site_name": "OpenCodeWiki" },
  "model": {
    "provider": "openai",
    "api_key": "",
    "model": "gpt-4o",
    "temperature": 0.7
  }
}
```

## 前端改动

### 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/App.tsx` | 修改 | +`/settings` 路由 |
| `frontend/src/pages/SettingsPage.tsx` | 创建 | 设置页面 |
| `frontend/src/api/client.ts` | 修改 | +`fetchSettings` + `saveSettings` |

### 后端改动

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/python-agent/main.py` | 修改 | +2 路由 `GET/PUT /api/settings` |

## Spec 自检

- UI 简洁：两级 nav + 表单 / 不臃肿
- 配置持久化：`config.json`
- 与现有 `config.py` 关系：`config.py` 改为优先读 `config.json`，fallback 环境变量
