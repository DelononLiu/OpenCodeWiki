# AdminPage 知识源管理 UI — 设计文档

> 日期：2026-07-18

## 背景

后端已实现统一知识源管理系统（stores/sources.py + source_importer.py + 6 个 API 端点）。
AdminPage 当前 repo 标签只是一个空占位，需要改造为完整的知识源管理 UI。

## 目标

1. AdminPage 左侧栏 `🗃️ 代码库提交` 改为 `📦 知识源管理`
2. 知识源列表页展示已注册的源，支持添加、同步、删除
3. 添加弹窗支持类型选择（code/docs）和来源选择（git/zip）

## 改动范围

仅 `frontend/src/pages/AdminPage.tsx`，无后端改动。

## UI 设计

### 左侧栏

`🗃️ 代码库提交` → `📦 知识源管理`，图标改为 Database 或 Box。

### 知识源列表

```
📦 知识源管理                    [+ 添加知识源]
──────────────────────────────────────────────
  my-project     ● code    git@github.com...  2026-07-18  [同步] [删除]
  团队规范        ● docs    https://git...     2026-07-18  [同步] [删除]
  设计文档        ● docs    (zip 导入)         2026-07-18  [删除]
```

- 类型标签：code 蓝底白字，docs 绿底白字
- 有 URL 的显示 [同步] 按钮，zip 导入的只有 [删除]
- 操作前确认弹窗（删除确认）
- 空状态：`暂无知识源，点击上方按钮添加`

### 添加弹窗

```
📦 添加知识源
────────────────────────
  名称: [________________]
  
  类型: ○ 代码仓库  ○ 纯文档
  
  来源: ○ git URL  ○ 上传 zip
  
  URL:  [________________]       (git 模式)
  文件: [选择文件]               (zip 模式)
  
  [取消] [提交]
```

- 代码仓库 → 导入后触发 openwiki 生成文档
- 纯文档 → 只扫描导入 .md 文件
- 提交后关闭弹窗，列表自动刷新，新源显示在列表中
- 同步/删除操作后自动刷新列表

## 无后端改动

全部 API 端点已存在：GET /api/sources, POST /api/sources, POST /api/sources/upload, POST /api/sources/{name}/sync, DELETE /api/sources/{name}
