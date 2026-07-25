# SVN 仓库导入支持设计

## 概述

为 OpenCodeWiki 增加 SVN 仓库导入能力。前端已支持 SVN 类型的知识库创建，但后端缺少实际的 SVN checkout/sync 逻辑。本设计补齐后端能力，并增加完整的密码弹窗交互。

## 目标

- 支持 `svn checkout` 导入 SVN 仓库
- 支持 `svn update` 增量同步
- 支持认证失败时前端弹出密码输入框
- 支持"记住密码"存入数据库

## 非目标

- 不支持 SVN 属性（svn:ignore 等）处理
- 不支持 svn:externals
- 不支持增量检出（sparse checkout）

## API 设计

### 创建 KB（已有，扩展字段）

`POST /api/kb`

新增可选字段：
- `svn_username` — SVN 用户名
- `svn_password` — SVN 密码（`save_credentials=true` 时存入）

### SVN 凭证提交（新增）

`POST /api/kb/{kb_id}/svn-auth`

Request:
```json
{
  "username": "alice",
  "password": "pass123",
  "save_credentials": true
}
```

Response: `{ "ok": true, "task_id": "task-xxx" }`

行为：
1. 更新 `knowledge_bases.svn_username` / `svn_password`
2. 自动创建一个新的 `sync_repo` task
3. 返回新 task ID

### 认证失败通知（task API 扩展）

`GET /api/tasks` 在 task 的 `params` 中带标记：
```json
{
  "id": "task-xxx",
  "params": { "auth_required": true, "realm": "SVN+SSH://..." }
}
```

## 技术栈

| 项 | 方案 | 原因 |
|----|------|------|
| SVN CLI | 调用系统 `svn` 二进制 | 成熟稳定，无需 Python 绑定 |
| 认证检测 | 解析 stderr 匹配 E215004/E170001 | `--non-interactive` 模式直接报错 |
| 凭证存储 | 明文写入 `knowledge_bases` 表 | 用户选择 |
| SVN branch | branch 参数拼入 URL | 目录式分支 |
| 变更检测 | `svn update` 输出首列状态码 | 标准格式 |
| 并发安全 | `--non-interactive` | 防止进程挂起 |

## 数据库变更

`knowledge_bases` 表新增：
- `svn_username TEXT DEFAULT ''`
- `svn_password TEXT DEFAULT ''`

## 文件变更清单

### 新增文件

- `backend/sync/svn_sync.py` — SVN CLI 操作封装
- `backend/tests/test_svn_sync.py` — SVN 同步单元测试

### 修改文件

- `backend/sync/__init__.py` — 导出 svn_sync 模块
- `backend/database.py` — 添加 `_MIGRATIONS` 新增字段
- `backend/stores/kb.py` — KB 查询返回 svn_username/svn_password，KB 创建/更新支持凭证字段
- `backend/task_worker/plugins/sync_repo.py` — 判断 repo_type 分发到 svn_sync/git_sync
- `backend/main.py` — 
  - `CreateKBRequest` 扩展 svn_username/svn_password
  - 新增 `POST /api/kb/{kb_id}/svn-auth`
  - `_fetch_commit_and_update` 处理 SVN
- `frontend/src/pages/SourcesPage.tsx` — 
  - SVN 模式显示密码输入区
  - 认证失败弹窗
- `frontend/src/api/opencodewiki.ts` — 新增 `submitSVNAuth()` API

### 其他

- `requirements.txt` — 无需新增 Python 依赖
- Dockerfile / 文档 — 提醒安装 `subversion` 包

## 关键流程

```
用户创建 SVN KB
    ↓
用户点击"同步远程"
    ↓
SyncRepoPlugin 调 svn_sync.checkout(—non-interactive)
    ↓
┌─ 成功 → 正常导入文档，写入 revision
│
└─ SVNAuthError → task.params.auth_required = true
                      ↓
              前端轮询检测到 → 弹密码对话框
                      ↓
              用户输入用户名/密码 → POST /svn-auth
                      ↓
              存入 DB → 新 sync task 用凭证重试
                      ↓
              svn_sync.checkout(—username U —password P)
                      ↓
              ┌─ 成功 → 正常流程
              └─ 仍失败 → 报错终止
```

## SVN branch 处理

SVN 目录式分支：
- trunk → `svn checkout <url>/trunk`
- branches/feature-x → `svn checkout <url>/branches/feature-x`
- tags/v1.0 → `svn checkout <url>/tags/v1.0`
- 默认 branch: `trunk`

## 安全考虑

- 密码明文存储在 SQLite，依赖文件系统权限保护
- `--non-interactive` 防止进程挂起
- 操作超时 300s，避免死连接
