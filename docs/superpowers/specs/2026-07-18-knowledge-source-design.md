# 统一知识源管理系统 — 设计文档

> 日期：2026-07-18

## 背景

当前 OpenCodeWiki 的知识源只有"代码仓库"一种类型，存储在 `registry.json` 中只有 `{name, path}`。代码生成的 wiki 文档放在项目目录下的 `.codegraph/wiki/`，与用户沉淀的 wiki 页面（`~/.opencodewiki/pages/`）割裂。

本次设计将知识源统一为"代码源"和"文档源"两种类型，统一存储路径和导入流程，所有文档归入 `~/.opencodewiki/` 统一管理。

## 目标

1. 支持注册代码仓库（git/zip）→ 自动生成文档
2. 支持注册文档仓库（git/zip）→ 直接导入 `.md` 文件
3. 所有知识源的 Wiki 页面统一可见、QA 统一检索
4. 支持同步更新和删除清理
5. 清理旧 `.codegraph/` 目录

## 目录结构

```
~/.opencodewiki/
├── config.json                    # LLM 配置（现有）
├── registry.json                  # 统一知识源注册
├── qa.db / knowledge.db          # SQLite（现有）
├── qa-sessions/                   # QA 会话（现有）
├── vectors/                       # 向量索引（现有，外部 CLI 管理）
│
├── repos/                         # 代码源
│   ├── {name}/
│   │   ├── src/                   # git clone / zip 解压的代码
│   │   ├── README.md
│   │   └── opencodewiki/          # 生成的文档
│   │       ├── quickstart.md
│   │       └── architecture/
│   │           └── overview.md
│   └── ...
│
└── pages/                         # Wiki 统一存储
    ├── entities/                  # Topic 沉淀（现有）
    ├── overviews/                 # 概览（现有）
    ├── qa-archives/               # QA 归档（现有）
    └── sources/                   # 文档源导入
        └── {name}/
            ├── 文档1.md
            └── 文档2.md
```

## Registry 扩展

```json
// ~/.opencodewiki/registry.json
[
  {
    "name": "my-project",
    "url": "git@github.com:user/my-project.git",
    "type": "code",
    "created_at": "2026-07-18T15:00:00Z",
    "updated_at": "2026-07-18T15:00:00Z"
  },
  {
    "name": "团队规范",
    "url": "https://git.company.com/team/standards.git",
    "type": "docs",
    "created_at": "2026-07-18T15:00:00Z",
    "updated_at": "2026-07-18T15:00:00Z"
  },
  {
    "name": "设计文档",
    "type": "docs",
    "created_at": "2026-07-18T16:00:00Z",
    "updated_at": "2026-07-18T16:00:00Z"
  }
]
```

- `type: "code"` — 代码仓库，导入到 `repos/{name}/`
- `type: "docs"` — 文档仓库，导入到 `pages/sources/{name}/`
- `url` 可选 — git/svn 地址。zip 导入的没有 url
- 旧的 registry 数据清空重建，不做兼容

## 新增模块：stores/sources.py

将所有 registry 操作集中在此模块。不在 main.py 和 tools.py 中重复实现。

```python
def list_sources(type: str | None = None) -> list[dict]
def get_source(name: str) -> dict | None
def create_source(data: dict) -> dict
def delete_source(name: str) -> bool
def update_source(name: str, data: dict) -> dict
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/sources | 列出所有知识源 |
| GET | /api/sources/{name} | 获取单个源信息 |
| POST | /api/sources | 注册知识源（git url） |
| POST | /api/sources/upload | 上传 zip 导入 |
| POST | /api/sources/{name}/sync | 同步更新 |
| DELETE | /api/sources/{name} | 删除知识源 |

## 导入流程

### 代码源 (git)

1. `git clone {url}` → `~/.opencodewiki/repos/{name}/`
2. codebase-memory-mcp 索引
3. subprocess 调 openwiki CLI → 生成文档到 `repos/{name}/opencodewiki/`
4. registry.json 写记录
5. 后台异步执行，前端显示"生成中"

### 代码源 (zip)

1. 解压 zip → `~/.opencodewiki/repos/{name}/`
2. codebase-memory-mcp 索引
3. openwiki CLI 生成文档
4. registry.json 写记录

### 文档源 (git)

1. `git clone {url}` → 临时目录
2. 扫描全部 `.md` 文件
3. 复制到 `pages/sources/{name}/`
4. registry.json 写记录

### 文档源 (zip)

1. 解压 zip → 临时目录
2. 扫描全部 `.md` 文件
3. 复制到 `pages/sources/{name}/`
4. registry.json 写记录

## 同步与清理

### 同步

```
POST /api/sources/{name}/sync

type=code: git pull → 重新 openwiki 生成
type=docs: git pull → 重新扫描 .md → 覆盖 pages/sources/{name}/
```

### 删除

```
DELETE /api/sources/{name}

1. 从 registry 删除
2. type=code: rm -rf repos/{name}/
3. type=docs: rm -rf pages/sources/{name}/
4. 删除 vectors/{name}.vec.db*（向量索引文件）
```

## 实施计划

### 第一阶段：后端核心

1. 新建 `stores/sources.py`（registry CRUD）
2. 新建 `routes/sources.py`（API 端点）
3. 导入流程实现（git clone / zip 解压 / openwiki CLI 调用）
4. 同步和删除逻辑
5. 测试覆盖

### 第二阶段：前端 UI + 清理

1. AdminPage/SettingsPage 改造为统一知识源管理
2. 导入进度展示
3. 清理 `.codegraph/wiki/` 目录
4. 删除 `WIKI_BASE` 相关代码
5. 更新 `code_read_wiki` Agent 工具

## 不在此次设计中的事项

- Wiki 路由的 repo 相关改造（待定）
- QA Agent 直接读取 sources 文档（待清理后统一处理）
- 前端 UI（第二阶段实施）
