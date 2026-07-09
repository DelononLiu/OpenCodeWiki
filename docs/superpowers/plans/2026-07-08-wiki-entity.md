# Wiki 实体化改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现基于业务实体的 wiki 系统，支持三阶段内容生产、搜索优先的首页、实体详情页和局部关系图。

**Architecture:** 实体存储于 `.codegraph/wiki/entities/`，每个实体一个 `.json` 文件（含元数据和内容）。后端提供搜索/实体 CRUD/热门实体 API。前端首页以搜索框+热门实体为核心，实体详情页展示定义、涉及代码、上下游、局部关系图。

**Tech Stack:** TypeScript (backned API) + Python (LLM 生成) + HTML/CSS (前端)

## 数据结构

实体文件 `entities/<slug>.json`：

```json
{
  "slug": "batch-inference",
  "name": "批量推理",
  "status": "initial",           // initial | calibrated | filled
  "definition": "...",
  "project": "llama.cpp",
  "files": [
    {"path": "src/llama-batch.cpp", "symbols": ["llama_batch_allocr", "llama_decode"]}
  ],
  "relations": [
    {"target": "推理引擎", "type": "part-of"},
    {"target": "KV-Cache", "type": "depends-on"}
  ],
  "content": "...",              // LLM 填充的详情
  "searchCount": 0               // 热度
}
```

---

## 任务分解

### Task 1: 实体存储 + CRUD

**Files:**
- Create: `src/server/wiki-entity.ts`

**Interfaces:**
- Produces: `EntityStore` 类，`loadEntity(slug)`, `saveEntity(data)`, `listEntities()`, `searchEntities(query)`, `getHotEntities(count)`, `incrementSearchCount(slug)`

- [ ] **Step 1: 创建 EntityStore 类**

```typescript
// src/server/wiki-entity.ts
import fs from 'fs/promises';
import path from 'path';

export interface WikiEntity {
  slug: string;
  name: string;
  status: 'initial' | 'calibrated' | 'filled';
  definition: string;
  project: string;
  files: { path: string; symbols: string[] }[];
  relations: { target: string; type: string }[];
  content: string;
  searchCount: number;
}

const ENTITIES_DIR = '.codegraph/wiki/entities';

export class EntityStore {
  constructor(private repoPath: string) {}

  private get dir() { return path.join(this.repoPath, ENTITIES_DIR); }

  async all(): Promise<WikiEntity[]> {
    try {
      const files = await fs.readdir(this.dir);
      const entities = await Promise.all(
        files.filter(f => f.endsWith('.json')).map(f =>
          fs.readFile(path.join(this.dir, f), 'utf-8').then(JSON.parse)
        )
      );
      return entities;
    } catch { return []; }
  }

  async get(slug: string): Promise<WikiEntity | null> {
    try {
      const data = await fs.readFile(path.join(this.dir, `${slug}.json`), 'utf-8');
      return JSON.parse(data);
    } catch { return null; }
  }

  async save(entity: WikiEntity): Promise<void> {
    const dir = this.dir;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${entity.slug}.json`), JSON.stringify(entity, null, 2));
  }

  async search(query: string): Promise<WikiEntity[]> {
    const all = await this.all();
    const q = query.toLowerCase();
    return all.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.definition.toLowerCase().includes(q) ||
      e.files.some(f => f.path.toLowerCase().includes(q))
    ).sort((a, b) => b.searchCount - a.searchCount);
  }

  async hot(count = 10): Promise<WikiEntity[]> {
    const all = await this.all();
    return all.sort((a, b) => b.searchCount - a.searchCount).slice(0, count);
  }

  async bump(slug: string): Promise<void> {
    const entity = await this.get(slug);
    if (entity) { entity.searchCount++; await this.save(entity); }
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
cd /home/long2015/Code/OpenCodeWiki && npx tsc --noEmit 2>&1 | grep -v node_modules | head -5
```
Expected: 无 wiki-entity.ts 相关错误

- [ ] **Step 3: 提交**

```bash
git add src/server/wiki-entity.ts && git commit -m "feat: 实体存储 + CRUD"
```

---

### Task 2: 实体 API 路由

**Files:**
- Modify: `src/server/server.ts`
- Create: `src/server/wiki-entity.ts` (已在上一步创建)

**Interfaces:**
- Produces: `GET /api/wiki/entities/search?q=xxx` — 搜索实体
- Produces: `GET /api/wiki/entities/hot` — 热门实体
- Produces: `GET /api/wiki/entities/:slug` — 实体详情
- Produces: `POST /api/wiki/entities/:slug/view` — 增加热度

- [ ] **Step 1: 在 server.ts 注册 EntityStore 实例**

```typescript
// 在 server.ts 中找到 registry 初始化附近的位置
import { EntityStore } from './wiki-entity.js';

// 创建 entity store（懒加载）
let _entityStore: EntityStore | null = null;
function getEntityStore(): EntityStore {
  if (!_entityStore) {
    _entityStore = new EntityStore(rootDir);
  }
  return _entityStore;
}
```

- [ ] **Step 2: 添加实体 API 路由**

```typescript
// 搜索实体
app.get('/api/wiki/entities/search', async (req, res) => {
  const q = (req.query.q as string || '').trim();
  if (!q) { res.json({ results: [] }); return; }
  const store = getEntityStore();
  const results = await store.search(q);
  res.json({ results });
});

// 热门实体
app.get('/api/wiki/entities/hot', async (_req, res) => {
  const store = getEntityStore();
  const results = await store.hot(10);
  res.json({ results });
});

// 实体详情
app.get('/api/wiki/entities/:slug', async (req, res) => {
  const store = getEntityStore();
  const entity = await store.get(req.params.slug);
  if (!entity) { res.status(404).json({ error: 'Entity not found' }); return; }
  await store.bump(req.params.slug);
  res.json(entity);
});
```

- [ ] **Step 3: 验证编译**

```bash
cd /home/long2015/Code/OpenCodeWiki && npx tsc --noEmit 2>&1 | grep -v node_modules | grep "server\|entity" | head -5
```
Expected: 无 server.ts / wiki-entity.ts 相关错误

- [ ] **Step 4: 提交**

```bash
git add src/server/server.ts && git commit -m "feat: 实体 API 路由"
```

---

### Task 3: LLM 骨架生成

**Files:**
- Create: `src/python-agent/wiki-entity-builder.py`

**Interfaces:**
- Produces: `generate_skeleton(project, concept_name)` — 返回实体骨架 JSON
- Produces: `fill_details(entity_data)` — 基于已校准骨架填充详情

- [ ] **Step 1: 创建骨架生成器**

```python
# src/python-agent/wiki-entity-builder.py
"""
Entity 骨架生成 + 详情填充。
调用 codebase-memory-mcp CLI 获取符号信息，LLM 生成概念定义和内容。
"""
import json
import subprocess
import sys
from pathlib import Path

from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic

sys.path.insert(0, str(Path(__file__).parent))
from config import get_llm_config


def _call_cli(tool: str, args: dict) -> dict:
    binary = "/home/long2015/.local/bin/codebase-memory-mcp"
    result = subprocess.run([binary, "cli", tool, json.dumps(args)],
        capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        return {}
    for line in reversed(result.stdout.strip().split("\n")):
        if line.startswith("{"):
            return json.loads(line)
    return {}


def _find_symbols(project: str, concept: str) -> list[dict]:
    """搜索与概念相关的符号"""
    data = _call_cli("search_graph", {"query": concept, "project": project, "limit": 15})
    return [{"name": r.get("name"), "file": r.get("file_path"), "line": r.get("start_line")}
            for r in data.get("results", []) if r.get("name")]


def generate_skeleton(project: str, concept: str) -> dict:
    """
    Phase 1: 生成实体骨架。
    返回：{ slug, name, status, definition, project, files, relations, content, searchCount }
    """
    symbols = _find_symbols(project, concept)
    cfg = get_llm_config()
    
    if cfg.get("provider") == "anthropic":
        llm = ChatAnthropic(model=cfg["model"], api_key=cfg["apiKey"], temperature=0)
    else:
        llm = ChatOpenAI(model=cfg["model"], api_key=cfg["apiKey"],
                         base_url=cfg["baseUrl"], temperature=0)

    files_str = "\n".join(f"- {s['file']}:{s['line']} ({s['name']})" for s in symbols[:10])
    prompt = f"""根据以下代码信息，为概念「{concept}」生成 wiki 实体骨架。

涉及代码：
{files_str or '（未找到直接相关符号）'}

请返回 JSON：
{{
  "slug": "英文短横线格式",
  "name": "实体名称（中文）",
  "definition": "一句话定义（20 字内）",
  "files": ["涉及的文件路径"],
  "relations": ["可能相关的上游/下游实体名称"]
}}"""

    resp = llm.invoke(prompt)
    try:
        data = json.loads(resp.content.strip().strip("```json").strip("```").strip())
    except json.JSONDecodeError:
        data = {"definition": resp.content.strip()[:100]}

    return {
        "slug": data.get("slug", concept.lower().replace(" ", "-")),
        "name": data.get("name", concept),
        "status": "initial",
        "definition": data.get("definition", ""),
        "project": project,
        "files": [{"path": f, "symbols": [s["name"] for s in symbols if s["file"] == f]}
                  for f in data.get("files", [])],
        "relations": [{"target": r, "type": "related"} for r in data.get("relations", [])],
        "content": "",
        "searchCount": 0,
    }


def fill_details(entity: dict) -> dict:
    """
    Phase 3: 基于已校准骨架填充详情。
    返回更新后的 entity（status → 'filled', content 填充）。
    """
    cfg = get_llm_config()
    if cfg.get("provider") == "anthropic":
        llm = ChatAnthropic(model=cfg["model"], api_key=cfg["apiKey"], temperature=0)
    else:
        llm = ChatOpenAI(model=cfg["model"], api_key=cfg["apiKey"],
                         base_url=cfg["baseUrl"], temperature=0)

    files_str = "\n".join(f"- {f['path']}" for f in entity.get("files", []))
    prompt = f"""实体「{entity['name']}」定义：{entity['definition']}

涉及文件：
{files_str or "（无）"}

请用中文写一段 300-500 字的详细介绍，说明这个模块/概念做什么、涉及的代码结构、
核心逻辑。用 markdown 格式，可包含 mermaid 图。"""

    resp = llm.invoke(prompt)
    entity["content"] = resp.content.strip()
    entity["status"] = "filled"
    return entity


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "generate":
        result = generate_skeleton(sys.argv[2], " ".join(sys.argv[3:]))
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif cmd == "fill":
        data = json.loads(sys.stdin.read())
        result = fill_details(data)
        print(json.dumps(result, ensure_ascii=False, indent=2))
```

- [ ] **Step 2: 测试骨架生成**

```bash
cd /home/long2015/Code/OpenCodeWiki/src/python-agent && source .venv/bin/activate && python3 -c "
from wiki_entity_builder import generate_skeleton
result = generate_skeleton('home-long2015-Code-llama.cpp', '批量推理')
print(result['slug'], result['definition'])
" 2>&1 | grep -v "level=info"
```
Expected: 输出实体 slug 和定义

- [ ] **Step 3: 提交**

```bash
cd /home/long2015/Code/OpenCodeWiki && git add src/python-agent/wiki-entity-builder.py && git commit -m "feat: 实体骨架生成器"
```

---

### Task 4: 首页搜索 + 热门实体

**Files:**
- Modify: `src/home/index.html`

- [ ] **Step 1: 添加搜索框 + 热门实体区域到首页**

在 `src/home/index.html` 中现有内容基础上，增加搜索框和热门实体区域：

```html
<div class="entity-section">
  <div class="search-box">
    <input type="text" id="entitySearch" placeholder="搜索代码实体..." autofocus>
    <div id="searchResults" class="search-results"></div>
  </div>
  <div class="hot-entities" id="hotEntities"></div>
</div>

<script>
async function loadHotEntities() {
  const res = await fetch('/api/wiki/entities/hot');
  const data = await res.json();
  const container = document.getElementById('hotEntities');
  container.innerHTML = '<h3>热门实体</h3>' + 
    data.results.map(e => 
      `<a href="/wiki/entity/${e.slug}" class="entity-tag">${e.name}</a>`
    ).join('');
}

async function searchEntities(q) {
  if (q.length < 2) { document.getElementById('searchResults').innerHTML = ''; return; }
  const res = await fetch(`/api/wiki/entities/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  document.getElementById('searchResults').innerHTML = data.results.map(e =>
    `<a href="/wiki/entity/${e.slug}" class="search-item">
      <strong>${e.name}</strong>
      <span>${e.definition}</span>
     </a>`
  ).join('');
}

document.getElementById('entitySearch').addEventListener('input', e => searchEntities(e.target.value));
loadHotEntities();
</script>
```

- [ ] **Step 2: 提交**

```bash
git add src/home/index.html && git commit -m "feat: 首页搜索框 + 热门实体"
```

---

### Task 5: 实体详情页

**Files:**
- Create: `src/wiki/entity.html` — 实体详情页面

- [ ] **Step 1: 创建实体详情页**

```html
<!-- src/wiki/entity.html -->
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title id="entityTitle">实体详情</title>
<link rel="stylesheet" href="/vendor/wiki.css"></head>
<body>
<div class="entity-header">
  <h1 id="entityName"></h1>
  <span class="status-badge" id="entityStatus"></span>
</div>
<p class="definition" id="entityDef"></p>

<section id="entityFiles">
  <h3>涉及代码</h3>
  <ul id="fileList"></ul>
</section>

<section id="entityRelations">
  <h3>上下游关系</h3>
  <div id="relationGraph"></div>
</section>

<section id="entityContent" class="markdown-body"></section>

<script>
async function loadEntity() {
  const slug = location.pathname.split('/').pop();
  const res = await fetch(`/api/wiki/entities/${slug}`);
  const e = await res.json();
  document.title = e.name;
  document.getElementById('entityName').textContent = e.name;
  document.getElementById('entityStatus').textContent = 
    ({initial:'AI生成初版', calibrated:'已校准', filled:'已填充'})[e.status] || e.status;
  document.getElementById('entityDef').textContent = e.definition;
  
  document.getElementById('fileList').innerHTML = e.files.map(f =>
    `<li><code>${f.path}</code> ${f.symbols.length ? '— ' + f.symbols.join(', ') : ''}</li>`
  ).join('');
  
  // 局部关系图（文本方式）
  if (e.relations.length) {
    document.getElementById('relationGraph').innerHTML = 
      '<ul>' + e.relations.map(r => `<li>${r.type}: <a href="/wiki/entity/${r.target}">${r.target}</a></li>`).join('') + '</ul>';
  }
  
  if (e.content) {
    document.getElementById('entityContent').innerHTML = 
      '<h3>详情</h3>' + e.content.replace(/\n/g, '<br>');
  }
}
loadEntity();
</script>
</body>
</html>
```

- [ ] **Step 2: 在 server.ts 添加实体页面路由**

```typescript
// 在 server.ts 的页面路由区域添加
import path from 'path';
const entityViewFile = path.resolve(rootDir, 'src', 'wiki', 'entity.html');

// 在已有的 app.get('/:repoName/qa', sendQaPage); 附近添加
// 注意：/wiki/entity/:slug 需要在其他 wiki 路由之前注册
app.get('/wiki/entity/:slug', async (_req, res) => {
  try {
    const content = await fs.readFile(entityViewFile, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(content);
  } catch {
    res.status(404).send('Entity page not found');
  }
});
```

- [ ] **Step 3: 验证端到端**

```bash
# 先生成一个测试实体
cd /home/long2015/Code/OpenCodeWiki/src/python-agent
source .venv/bin/activate
python3 -c "
from wiki_entity_builder import generate_skeleton
import json
result = generate_skeleton('home-long2015-Code-llama.cpp', '批量推理')
with open('/tmp/test-entity.json', 'w') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print('OK:', result['slug'])
"

# 复制到实体系目录
mkdir -p /home/long2015/.opencodewiki/entities
cp /tmp/test-entity.json /home/long2015/.opencodewiki/entities/

# 启动服务访问
# curl http://localhost:4747/api/wiki/entities/search?q=批量
# curl http://localhost:4747/api/wiki/entities/hot
```

- [ ] **Step 4: 提交**

```bash
git add src/wiki/entity.html src/server/server.ts && git commit -m "feat: 实体详情页 + 路由"
```

---

## 实施顺序

| 阶段 | 任务 | 依赖 | 预估 |
|------|------|------|------|
| Phase A | Task 1: 实体存储 CRUD | 无 | 1h |
| Phase A | Task 2: 实体 API 路由 | Task 1 | 1h |
| Phase B | Task 3: LLM 骨架生成 | 无 | 2h |
| Phase B | Task 4: 首页搜索 + 热门 | Task 2 | 2h |
| Phase B | Task 5: 实体详情页 | Task 2, 3 | 2h |
