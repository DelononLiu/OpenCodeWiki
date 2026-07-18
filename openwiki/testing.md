# 测试指南

## 测试架构

| 层 | 框架 | 测试数量 | 目的 |
|---|---|---|---|
| **后端单元测试** | pytest 9.1+ | ~85+ 个测试 | 存储逻辑、路由、Agent、源码导入器 |
| **前端测试** | Vitest + MSW | ~15+ 个测试 | 组件、钩子、API 客户端 |
| **QA 评估套件** | pytest + requests | 可变 | 端到端 QA 质量评分 |

---

## 后端测试

### 测试基础设施 (`backend/tests/conftest.py`)

**Fixtures（夹具）：**

| Fixture | 用途 |
|---|---|
| `qa_db` | 内存 SQLite，包含完整的 `qa.db` 模式（schema） |
| `knowledge_db` | 内存 SQLite，包含完整的 `knowledge.db` 模式 |
| `patch_stores` | 猴子补丁 `get_qa_db()` 和 `get_knowledge_db()`，使其使用内存数据库 |
| `client` | 带有已打补丁的存储（stores）的 FastAPI `TestClient` |
| `mock_llm` | 返回预定义响应的模拟 LLM |

### 测试套件分类

**存储测试（`test_stores/`）：** 4 个文件，约 59 个测试

| 文件 | 测试数量 | 验证内容 |
|---|---|---|
| `test_qa.py` | ~18 | 创建/获取/列出/待处理/校准/搜索/增加访问/更新域/排序查询 |
| `test_topics.py` | ~14 | 创建/列出/获取/关联 QA/草稿生命周期（保存/获取/更新/审批/发布）/搜索 |
| `test_wiki.py` | ~12 | 写入（4 种页面类型 + 覆盖写入）、读取（存在/不存在/类型错误）、列出（全部/按类型/空）、页面路径解析 |
| `test_sources.py` | ~15 | 列出（空/全部/按类型/未知）、获取（找到/未找到）、创建（基本/URL/默认类型/持久化/重复）、删除、更新、常量 |

**路由测试（`test_main/`）：** 6 个文件，约 50 个测试

| 文件 | 测试数量 | 验证内容 |
|---|---|---|
| `test_sources_routes.py` | ~22 | 完整的 HTTP 覆盖：列出/获取/创建/git/zip/上传/同步/删除 + 错误情况 |
| `test_qa_routes.py` | ~9 | 列出/获取/下一个问题ID/待处理/建议/创建-校准/缺失字段 |
| `test_topic_routes.py` | ~9 | 列出/创建/获取/保存草稿/编辑草稿/发布/缺失字段 |
| `test_search_routes.py` | ~4 | 短查询/主题结果/QA 结果/混合 |
| `test_settings_routes.py` | ~3 | 获取默认/获取已保存/更新 |
| `test_wiki_routes.py` | ~3 | 未找到/通过主题/通过存储页面 |

**Agent 测试（`test_agent/`）：** 1 个文件，约 7 个测试

| 文件 | 测试数量 | 验证内容 |
|---|---|---|
| `test_graph.py` | ~7 | 意图配置（意图/限制/指南）、构建图（结构/单例/边）、意图分类（已知/未知/大小写不敏感） |

**源码导入器测试：** 1 个文件，约 18 个测试

| 文件 | 测试数量 | 验证内容 |
|---|---|---|
| `test_source_importer.py` | ~18 | 代码 git/zip 导入、文档 git/zip 导入、移除（代码/文档/向量/不存在/幽灵）、同步（代码/文档/不存在/时间戳/无 URL） |

### 运行后端测试

```bash
# 完整套件
cd backend && python -m pytest -v

# 按区域
python -m pytest backend/tests/test_stores/ -v
python -m pytest backend/tests/test_main/ -v
python -m pytest backend/tests/test_agent/ -v
python -m pytest backend/tests/test_source_importer.py -v

# 带覆盖率
cd backend && python -m pytest --cov=stores --cov=agent --cov=source_importer
```

---

## 前端测试

### 测试基础设施

| 文件 | 用途 |
|---|---|
| `src/test-setup.ts` | 全局设置——在所有测试前启动 MSW 服务器 |
| `src/mocks/server.ts` | MSW 节点服务器实例 |
| `src/mocks/handlers.ts` | 20+ 个模拟 API 端点，覆盖所有 API 函数 |

### 测试套件

| 文件 | 测试数量 | 验证内容 |
|---|---|---|
| `api/client.test.ts` | 8 | 仓库、QA、wiki、主题、设置、错误处理 |
| `hooks/useSSE.test.ts` | ~3 | SSE 流式状态 |
| `Header.test.tsx` | ~2 | Header 组件渲染 |
| `BottomInput.test.tsx` | ~2 | Input 组件行为 |
| `HomePage.test.tsx` | ~3 | HomePage 渲染 |
| `QAPage.test.tsx` | ~2 | QA 页面交互 |

### 运行前端测试

```bash
cd frontend

# 完整套件
npx vitest run

# 监视模式
npx vitest

# 覆盖率
npx vitest run --coverage

# 指定文件
npx vitest run src/api/client.test.ts
```

---

## QA 评估套件

`eval/` 目录包含针对运行中服务器的端到端 QA 质量测试。

### 架构

- **基于 API**——使用 `requests`，不导入后端模块
- **conftest.py**：启动 uvicorn 子进程，等待健康检查，返回 `requests.Session`
- **两种测试类别：**
  - 快速冒烟测试（基本连通性验证）
  - 慢速 QA 质量测试（经 LLM 评分的答案质量）

### 评分（`eval/score.py`）

基于 LLM 的评分，涵盖 5 个维度（每项 1-5 分）：

| 维度 | 衡量内容 |
|---|---|
| **完整性** | 答案是否覆盖了所有方面？ |
| **代码引用** | 代码引用是否准确且相关？ |
| **结构** | 答案是否组织良好？ |
| **深度** | 是否超越了表面层次？ |
| **可操作性** | 读者是否可以基于答案采取行动？ |

**总分：** 满分 25 分。

### 数据集

| 数据集 | 用例数 | 来源 |
|---|---|---|
| `datasets/tiny.json` | 10 | 从 3 个仓库（codegraph, kcode, OpenCodeWiki）机器标注 |
| `datasets/sweqa_144.json` | 144 | SWE-QA 数据集 |
| `cases/001-005` | 5 | 人工标注，附有参考答案 |

### 运行评估

```bash
cd eval
source ../backend/.venv/bin/activate
bash run.sh
```

`run.sh` 执行两步流水线（pipeline）：快速冒烟测试 → 慢速 QA 质量测试。结果出现在 `results/` 中。

---

## TDD 纪律（来自 AGENTS.md）

> 完整详情请参见中文版 `AGENTS.md`。

### 变更 → 测试映射

| 你修改的内容 | 需要运行的测试 |
|---|---|
| `stores/*.py` | `python -m pytest backend/tests/test_stores/ -v` |
| `main.py` 中的路由 | `python -m pytest backend/tests/test_main/ -v` |
| `agent/*.py` | `python -m pytest backend/tests/test_agent/ -v` |
| 前端组件/页面 | `npx vitest run src/pages/ src/components/ --reporter=verbose` |
| 前端钩子 | `npx vitest run src/hooks/ --reporter=verbose` |
| 跨模块变更 | 完整的后端 + 前端套件 |

### 应避免的反模式

项目强制执行严格的测试质量规则（详见 AGENTS.md 中“测试质量问责”部分）：
- 禁止裸调用测试（只断言 200 而不验证业务逻辑）
- 禁止“存在性断言”测试（`assert "data" in result` 而不检查具体值）
- 禁止同义反复断言（例如 `assert len >= 0`）
- 禁止仅做结构检查而不验证具体值
- 禁止边界盲区——必须测试错误/空/空值路径
- 禁止模拟而不进行验证

## 变更指导

在引入新测试时：

1. **存储测试：** 使用 `conftest.py` 中的内存 SQLite fixtures。测试所有 CRUD 路径 + 业务规则 + 边界情况。
2. **路由测试：** 使用带有已打补丁存储的 TestClient。覆盖成功 + 错误 + 边界情况。
3. **Agent 测试：** 模拟 LLM 并验证意图分类 + Agent 图结构。
4. **前端测试：** 使用 MSW 模拟 API 响应。测试组件渲染 + 用户交互。
5. **评估测试：** 对于新的 QA 场景，将测试用例添加到 `datasets/tiny.json` 或 `cases/` 中。