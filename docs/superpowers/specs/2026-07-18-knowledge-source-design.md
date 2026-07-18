# 知识源管理 Design Spec

## 概述

统一管理代码库接入 + 文档上传。代码库入口在首页和 `/wiki` 全局页，文档上传入口在审核台 `/admin`。上传后解析提取文本，纳入 wiki 体系（不保留原始文件）。

## 代码库接入（已有，微调）

保持已有逻辑：`registry.json` 记录 repo 路径 → codegraph 索引生成 wiki。

首页/Wiki全局页："+ 提交代码库"按钮 → 跳转审核台代码库提交队列。

## 文档上传（新增）

### 入口

审核台 `/admin` 左侧栏增加"📤 上传文档"入口（操作按钮，非队列）。

点击 → 弹出上传对话框：

```
┌─ 上传文档 ────────────────────────────────────┐
│                                                 │
│   拖拽文件到此处，或                            │
│   [选择文件]                                    │
│                                                 │
│   支持: .md .txt .pdf                           │
│   最大: 10MB                                    │
│                                                 │
│   标签: [___________] (可选，逗号分隔)           │
│                                                 │
│   [取消] [上传]                                  │
└─────────────────────────────────────────────────┘
```

### 上传流程

```
用户选择文件 → 前端上传 POST /api/documents/upload
                   ↓
              后端存储原始文本到 ~/.opencodewiki/pages/
              生成 metadata（来源、标签、时间）
                   ↓
              纳入 wiki 全文搜索索引
                   ↓
              返回 { slug, title }
              Wiki 全局页最近变动中可见
```

### API `POST /api/documents/upload`

**Request:** `multipart/form-data`
```
file: document.md
tags: "architecture, design"
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "slug": "architecture-design",
    "title": "architecture-design",
    "page_type": "uploaded",
    "size": 2048,
    "tags": ["architecture", "design"]
  }
}
```

**后端处理：**
1. 接收文件，校验类型（`.md` `.txt` `.pdf`）和大小（≤10MB）
2. 提取文本内容：md/txt 直接读取，pdf 用 PyPDF2 或 pdfplumber 解析
3. 写入 `~/.opencodewiki/pages/uploaded/{slug}.md`
4. 返回 slug + title

### Wiki 搜索集成

`GET /api/search` 已搜 `.codegraph/wiki/`，需扩展搜索 `~/.opencodewiki/pages/uploaded/` 目录。

---

## 前端改动

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/pages/AdminPage.tsx` | 修改 | +文档上传入口 + 上传对话框 |
| `frontend/src/pages/HomePage.tsx` | 不变 | 提交代码库跳转审核台 |
| `frontend/src/pages/WikiGlobalPage.tsx` | 不变 | 最近变动列表需后端支持 |

## 后端改动

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/python-agent/main.py` | 修改 | +`POST /api/documents/upload` 路由 |
| `src/python-agent/main.py` | 修改 | `GET /api/search` 扩展搜 `pages/uploaded/` |

## Spec 自检

- **范围**：仅文档上传 + 文本提取，不保留原始文件
- **格式**：md/txt/pdf，≤10MB
- **标签**：可选，用于 wiki 分类
- **安全**：文件类型白名单校验，大小限制
