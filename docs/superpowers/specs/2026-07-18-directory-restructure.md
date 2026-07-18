# 目录结构重构 Spec

## 目标

重构项目目录结构，保证功能不变。分两阶段：

### Phase 1: 顶层重命名

- `src/python-agent/` → `backend/`
- `docs/调研*` `docs/专利*` `docs/模型*` → `docs/research/`

### Phase 2: backend 内部重构

- `store_qa.py` → `backend/stores/qa.py`
- `store_topics.py` → `backend/stores/topics.py`
- `store_wiki.py` → `backend/stores/wiki.py`
- `agent.py` → `backend/agent/agent.py`
- `graph.py` → `backend/agent/graph.py`
- `tools.py` → `backend/agent/tools.py`
- `wiki_entity_builder.py` → `backend/agent/wiki_builder.py`
- `test_store_topics.py` → `backend/tests/test_stores.py`
- `test_agent.py` → `backend/tests/test_agent.py`
- `config.py` `database.py` `main.py` `requirements.txt` 留在 `backend/`

### 清理

- 删除 `engine/` `example/` `config.example.json` `wiki_meta.json` `Dockerfile`
- 删除 `scripts/*.mjs` `scripts/postinstall.mjs` `scripts/index.mjs` `scripts/reindex.mjs`（旧 Node.js 死代码）
- 重写 `scripts/start.sh`（删掉引用 `src/server/server.ts` 的旧逻辑）
- 合并 `scripts/crg-wiki.py` + `scripts/wiki-entity.sh` → `scripts/wiki-generate.sh`

### 不变

- `frontend/` 不动
- `eval/` 不动
- AGENTS.md README.md .gitignore .prettierrc 保留

## 约束

- 所有 move 用 `git mv` 保留历史
- Python import 路径全部更新
- Python 测试 6/6 必须通过
- TypeScript 编译零错误
- 前后端能启动
