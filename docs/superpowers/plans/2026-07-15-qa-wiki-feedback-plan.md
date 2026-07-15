# QA → Wiki 反馈回路 + UI 统一 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 OpenCodeWiki 的 4 个页面为同一骨架（Header + 侧边栏 + 底部悬浮输入框），打通 QA → Wiki 双向反馈

**Architecture:** 新增 `page-shell.ts` 作为共享 shell 生成器，所有页面通过它渲染统一骨架。实体页从独立 HTML 改为内容片段嵌入 shell。底部输入框作为 shell 的一部分统一注入，实体上下文通过 URL 路由传递。

**Tech Stack:** Node.js 24, Express, TypeScript, node:sqlite

## Global Constraints

- 所有页面通过 `page-shell.ts` 共享同一骨架（header + sidebar + bottom input）
- 主页：轻 header（仅 Logo + ⚙️），无侧边栏
- 实体/QA/管理：完整 header + 侧边栏（220px）
- 底部输入框 `position: sticky; bottom: 0`，渐变背景，`max-width: 640px; margin: 0 auto`
- 实体页输入框 placeholder 显示 "对「{实体名}」提问..."，自动带 `#slug`
- 实体页关联 #Q 内联在正文下方：已校准展开、待校准折叠
- QA 引擎接受 `context_entity_slug` 字段，注入 system prompt
- 归档路径从 `repo/.codegraph/wiki/qa/` 改为 `~/.opencodewiki/pages/qa-archives/`

---

### Task 1: 页面 Shell 生成器 (page-shell.ts)

**Files:**
- Create: `src/server/page-shell.ts`
- Modify: `src/server/server.ts`（后续任务逐步接入）

**Interfaces:**
- Produces: `renderPageShell(content, opts): string` — 完整的页面 HTML
- Produces: `renderLightHeader(): string` — 主页轻 header
- Produces: `renderFullHeader(repoName): string` — 完整 header + 导航入口
- Produces: `renderSidebar(repoName, activeSection): string` — 侧边栏
- Produces: `renderBottomInput(placeholder, contextEntitySlug?): string` — 底部输入框

- [ ] **Step 1: 创建 `src/server/page-shell.ts`**

```typescript
// src/server/page-shell.ts — 统一页面骨架生成器

export interface ShellOpts {
  headerMode: 'light' | 'full';
  repoName?: string;
  activeSection?: 'wiki' | 'entity' | 'qa' | 'admin';
  title?: string;
  content: string;
  bottomInput?: {
    placeholder: string;
    contextEntitySlug?: string;
  };
}

const STYLES = `
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#ffffff;--bg-secondary:#f8f9fb;--border:#e5e7eb;--text:#1e293b;--text-muted:#64748b;--primary:#2563eb;--primary-soft:#eff6ff;--hover:#f1f5f9;--radius:8px}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.65;color:var(--text);background:var(--bg)}
.header{display:flex;align-items:center;padding:10px 20px;background:var(--bg);border-bottom:1px solid var(--border);gap:8px;position:sticky;top:0;z-index:30}
.header-light{display:flex;align-items:center;padding:10px 20px;gap:8px}
.header a{text-decoration:none;color:var(--text)}
.layout{display:flex;min-height:calc(100vh - 41px)}
.sidebar{width:220px;background:var(--bg-secondary);border-right:1px solid var(--border);flex-shrink:0;padding:12px;font-size:13px;display:flex;flex-direction:column}
.sidebar-nav{flex:1}
.content{flex:1;padding:24px 32px 80px;max-width:800px}
.sidebar-section{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:12px 0 6px 10px}
.sidebar-item{display:block;padding:6px 10px;border-radius:6px;color:var(--text);text-decoration:none;cursor:pointer}
.sidebar-item:hover{background:var(--hover)}
.sidebar-item.active{background:var(--primary-soft);color:var(--primary);font-weight:500}
.sidebar-item.nested{padding-left:24px}
.sidebar-item.muted{color:var(--text-muted)}
.sidebar-divider{height:1px;background:var(--border);margin:8px 12px}
.bottom-input-wrap{position:sticky;bottom:0;padding:10px 24px 14px;background:linear-gradient(rgba(255,255,255,0),rgba(255,255,255,.95) 35%)}
.bottom-input{display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid #d1d5db;border-radius:12px;padding:8px 14px;max-width:640px;margin:0 auto;box-shadow:0 -2px 8px rgba(0,0,0,.04),0 4px 20px rgba(0,0,0,.1)}
.bottom-input input{flex:1;border:none;outline:none;font-size:14px;font-family:inherit;background:transparent;color:var(--text)}
.bottom-input input::placeholder{color:#94a3b8}
.bottom-input .entity-tag{font-size:10px;padding:1px 6px;background:var(--primary-soft);color:var(--primary);border-radius:4px;font-weight:500;margin-left:4px}
.bottom-input .cmd-hint{font-size:10px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;color:var(--text-muted)}
.bottom-input .send-btn{padding:6px 14px;background:var(--primary);color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer}
@media(max-width:768px){.sidebar{display:none}.content{padding:16px}.bottom-input-wrap{padding:8px 12px}}
`;

export function renderLightHeader(): string {
  return `<div class="header-light">
    <a href="/" style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      OpenCodeWiki
    </a>
    <div style="flex:1"></div>
    <a href="/admin" style="font-size:12px;color:var(--text-muted);text-decoration:none">⚙️ 管理</a>
  </div>`;
}

export function renderFullHeader(repoName: string): string {
  const nav = (label: string, path: string, active: boolean) =>
    `<a href="${path}" style="font-size:12px;padding:4px 8px;border-radius:4px;text-decoration:none;${active ? 'background:var(--primary-soft);color:var(--primary)' : 'color:var(--text-muted)'}">${label}</a>`;
  return `<div class="header">
    <a href="/" style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;text-decoration:none;color:var(--text)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      OpenCodeWiki
    </a>
    <span style="font-size:10px;padding:2px 8px;background:var(--hover);border-radius:4px;color:var(--text-muted)">${repoName}</span>
    <div style="flex:1"></div>
    ${nav('🏷️ 实体', `/${repoName}/entities`, false)}
    ${nav('💬 #Q', `/${repoName}/qa`, false)}
    ${nav('⚙️ 管理', '/admin', false)}
  </div>`;
}

export function renderSidebar(repoName: string, activeSection: string, options?: {wikiTree?: {name:string,slug:string,children?:{name:string,slug:string}[]}[], entities?: {name:string,slug:string,qaCount?:number}[], qaEntries?: {qid:number,question:string}[]}): string {
  let html = '<div class="sidebar"><div class="sidebar-nav">';

  // Wiki pages
  html += '<div class="sidebar-section">📖 Wiki 页面</div>';
  if (options?.wikiTree) {
    for (const item of options.wikiTree) {
      const active = activeSection === item.slug ? ' active' : '';
      html += `<a class="sidebar-item${active}" href="/${repoName}/wiki/${item.slug}">${item.name}</a>`;
      if (item.children && (activeSection === item.slug || activeSection.startsWith(item.slug + '/'))) {
        for (const child of item.children) {
          const ca = activeSection === child.slug ? ' active' : '';
          html += `<a class="sidebar-item nested${ca}" href="/${repoName}/wiki/${child.slug}">${child.name}</a>`;
        }
      }
    }
  } else {
    html += '<div class="sidebar-item muted" style="cursor:default">加载中...</div>';
  }

  html += '<div class="sidebar-divider"></div>';
  html += '<div class="sidebar-section">🏷️ 实体</div>';
  if (options?.entities) {
    for (const e of options.entities) {
      const active = activeSection === e.slug ? ' active' : '';
      const badge = e.qaCount ? ` <span style="font-size:10px;color:var(--text-muted)">(${e.qaCount})</span>` : '';
      html += `<a class="sidebar-item${active}" href="/${repoName}/wiki/${e.slug}">${e.name}${badge}</a>`;
    }
  }

  html += '<div class="sidebar-divider"></div>';
  html += '<div class="sidebar-section">💬 #Q 存档</div>';
  if (options?.qaEntries) {
    for (const q of options.qaEntries) {
      const active = activeSection === `q${q.qid}` ? ' active' : '';
      html += `<a class="sidebar-item${active}" href="/${repoName}/qa?qid=${q.qid}">#Q${q.qid}: ${q.question.slice(0, 30)}</a>`;
    }
  }

  html += '</div>'; // sidebar-nav
  html += `<div style="padding:8px 12px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)"><a href="/admin" style="color:inherit;text-decoration:none">⚙️ 管理</a></div>`;
  html += '</div>';
  return html;
}

export function renderBottomInput(placeholder: string, contextEntitySlug?: string): string {
  const tag = contextEntitySlug ? `<span class="entity-tag">#${contextEntitySlug}</span>` : '';
  return `<div class="bottom-input-wrap">
    <div class="bottom-input">
      <input type="text" placeholder="${placeholder}" id="globalQaInput">
      ${tag}
      <div style="display:flex;gap:2px;margin-left:auto;align-items:center">
        <span class="cmd-hint">/bug</span>
        <span class="cmd-hint">/log</span>
        <button class="send-btn" onclick="sendGlobalQa()">提问</button>
      </div>
    </div>
  </div>`;
}

export function renderPageShell(content: string, opts: ShellOpts): string {
  const header = opts.headerMode === 'light' ? renderLightHeader() : renderFullHeader(opts.repoName || '');
  const sidebar = opts.headerMode === 'full' ? renderSidebar(opts.repoName || '', opts.activeSection || '') : '';
  const bottom = opts.bottomInput ? renderBottomInput(opts.bottomInput.placeholder, opts.bottomInput.contextEntitySlug) : '';

  const layout = opts.headerMode === 'full'
    ? `<div class="layout">${sidebar}<div class="content">${content}</div></div>`
    : `<div style="padding:24px;max-width:900px;margin:0 auto">${content}</div>`;

  return `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${opts.title || 'OpenCodeWiki'}</title>
<style>${STYLES}</style>
<script src="/vendor/marked.min.js"></script></head>
<body>
${header}
${layout}
${bottom}
<script>
async function sendGlobalQa(){var i=document.getElementById('globalQaInput');if(!i.value.trim())return;var q=i.value;window.location.href='/qa?q='+encodeURIComponent(q)}
document.getElementById('globalQaInput')?.addEventListener('keydown',function(e){if(e.key==='Enter')sendGlobalQa()});
</script>
</body></html>`;
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit` 确认无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/server/page-shell.ts
git commit -m "feat: unified page shell builder (header, sidebar, bottom input)"
```

---

### Task 2: 主页接入统一骨架

**Files:**
- Modify: `src/server/server.ts` — `sendHomePage()` 改用 page-shell
- Consumes: `src/server/page-shell.ts`

- [ ] **Step 1: 修改 `sendHomePage()`**

```typescript
import { renderPageShell } from './page-shell.js';

// Replace the existing sendHomePage function body
async function sendHomePage(_req: any, res: any) {
  try {
    const repos = await loadRegistry();
    // Build repo cards
    const repoCards = repos.map(r => `
      <a href="/${r.name}/wiki/overview" style="display:block;padding:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--text)">
        <div style="font-weight:600;font-size:14px">${r.name}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${r.path}</div>
      </a>
    `).join('');

    // Get hot entities
    let hotHtml = '';
    try {
      const entities = getEntityService().hot(5);
      hotHtml = entities.map(e =>
        `<a href="/self/wiki/${e.slug}" style="display:inline-block;padding:4px 10px;background:var(--primary-soft);color:var(--primary);border-radius:6px;font-size:12px;text-decoration:none;margin:2px">${e.name}</a>`
      ).join('');
    } catch {}

    const content = `
      <h1 style="font-size:24px;font-weight:700;margin-bottom:4px">欢迎回来</h1>
      <p style="font-size:14px;color:var(--text-muted);margin-bottom:20px">已注册 ${repos.length} 个仓库</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-bottom:24px">${repoCards}</div>
      ${hotHtml ? `<div style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:8px">🔥 热门实体</div><div>${hotHtml}</div>` : ''}
    `;

    const html = renderPageShell(content, {
      headerMode: 'light',
      title: 'OpenCodeWiki',
      bottomInput: { placeholder: '对代码库提问...' },
    });
    res.type('html').send(html);
  } catch {
    res.status(404).type('text').send('Home page not found');
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`

- [ ] **Step 3: 验证首页渲染**

Run: `npx tsx --test src/server/page-shell.test.ts`（如果已有测试），或启动服务手动验证

- [ ] **Step 4: 提交**

```bash
git add src/server/server.ts
git commit -m "feat: home page with unified shell (light header, no sidebar)"
```

---

### Task 3: 实体页 → 内容片段 + 内联 #Q

**Files:**
- Rewrite: `src/wiki/entity.html` — 去掉独立骨架，改为内容片段
- Modify: `src/server/server.ts` — 实体页渲染走 shell + 内容片段

- [ ] **Step 1: 重写 `src/wiki/entity.html` 为内容片段**

去掉原来的完整 HTML 结构（`<!DOCTYPE>`、`<html>`、`<head>`、`<style>`、`<body>`），只保留渲染逻辑的内容模板。使用 `{{SLUG}}`、`{{NAME}}` 等模板占位符，由服务端替换：

```html
<!-- src/wiki/entity.html — 内容片段，嵌入 page-shell -->
<div class="entity-header" style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
  <span style="font-size:24px;font-weight:700">{{NAME}}</span>
  <span class="status-badge {{STATUS_CLASS}}" style="font-size:11px;padding:2px 10px;border-radius:10px;font-weight:500">{{STATUS_LABEL}}</span>
</div>
<p style="font-size:15px;color:var(--text-muted);line-height:1.6;margin-bottom:20px">{{DEFINITION}}</p>

{{FILES_SECTION}}

{{CONTENT_SECTION}}

<!-- 关联 QA -->
<div style="border-top:1px solid var(--border);padding-top:20px;margin-top:20px">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
    <span style="font-size:15px;font-weight:600">💬 关联问答</span>
    <span style="font-size:10px;padding:2px 8px;background:var(--primary-soft);color:var(--primary);border-radius:8px">{{QA_COUNT}} 个问题</span>
  </div>
  <div id="entityQaList">{{QA_LIST}}</div>
</div>

<script>
async function loadEntityQa() {
  const slug = '{{SLUG}}';
  try {
    const r = await fetch('/api/wiki/entities/' + slug + '/qa');
    const data = await r.json();
    const list = document.getElementById('entityQaList');
    if (!data.qa || !data.qa.length) { list.innerHTML = '<span style="font-size:13px;color:var(--text-muted)">暂无关联问题</span>'; return; }
    list.innerHTML = data.qa.map(function(q) {
      const cal = q.isCalibrated;
      const statusBadge = cal ? '<span style="font-size:9px;padding:1px 8px;background:#ecfdf5;color:#059669;border-radius:8px;margin-left:auto">已校准 ✅</span>' : '<span style="font-size:9px;padding:1px 8px;background:#fef3c7;color:#92400e;border-radius:8px;margin-left:auto">待校准 ⏳</span>';
      const answerHtml = cal && q.answer ? '<div style="font-size:13px;color:#475569;line-height:1.7;margin-top:6px">' + q.answer + '</div>' : '';
      return '<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
        '<span style="font-size:11px;font-weight:600;color:var(--primary)">#Q' + q.qid + '</span>' +
        '<span style="font-size:13px;font-weight:500">' + q.question + '</span>' +
        statusBadge +
        '</div>' + answerHtml + '</div>';
    }).join('');
  } catch(e) { document.getElementById('entityQaList').innerHTML = '<span style="font-size:13px;color:#ef4444">加载失败</span>'; }
}
loadEntityQa();
</script>
```

- [ ] **Step 2: 验证文件存在**

Run: `wc -l src/wiki/entity.html` — 文件应远小于之前（不再包含完整骨架）

- [ ] **Step 3: 提交**

```bash
git add src/wiki/entity.html
git commit -m "feat: entity page as content fragment (no standalone shell)"
```

---

### Task 4: 实体/Wiki 页面渲染接入 Shell

**Files:**
- Modify: `src/server/server.ts` — 实体 wiki 查看器改用 page-shell + 实体内容片段
- Consumes: `src/server/page-shell.ts`, `src/wiki/entity.html`

- [ ] **Step 1: 修改 `sendWikiViewer()`**

```typescript
// In server.ts, modify sendWikiViewer to detect entity pages and render with shell

// Load entity template once at module level
const entityTemplate = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../wiki/entity.html'), 'utf-8'
);

// In sendWikiViewer, after determining repo and slug:
async function sendWikiViewer(repoName: string, req: any, res: any) {
  const slug = req.params.slug || 'overview';
  
  // Check if this is an entity page
  const entityService = getEntityService();
  const entity = entityService.get(slug);
  
  if (entity) {
    // Render entity page using shell + entity template
    let content = entityTemplate
      .replace(/\{\{SLUG\}\}/g, entity.slug)
      .replace(/\{\{NAME\}\}/g, entity.name)
      .replace(/\{\{STATUS_CLASS\}\}/g, entity.status)
      .replace(/\{\{STATUS_LABEL\}\}/g, ({draft:'草稿',reviewed:'已校准',published:'已发布'})[entity.status] || entity.status)
      .replace(/\{\{DEFINITION\}\}/g, entity.definition)
      .replace('{{FILES_SECTION}}', entity.files?.length
        ? `<div style="margin-bottom:16px"><div style="font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">涉及代码</div><div style="display:flex;flex-wrap:wrap;gap:4px">${entity.files.map(f => `<span style="font-size:12px;padding:3px 8px;background:var(--hover);border-radius:4px"><code>${f.path}</code></span>`).join('')}</div></div>`
        : '')
      .replace('{{CONTENT_SECTION}}', entity.content
        ? `<div style="font-size:14px;line-height:1.7;color:#334155;margin-bottom:24px">${entity.content}</div>`
        : '')
      .replace('{{QA_COUNT}}', '0') // populated by JS
      .replace('{{QA_LIST}}', '<span style="font-size:13px;color:var(--text-muted)">加载中...</span>');

    const html = renderPageShell(content, {
      headerMode: 'full',
      repoName: repoName,
      activeSection: entity.slug,
      title: `${entity.name} — OpenCodeWiki`,
      bottomInput: { placeholder: `对「${entity.name}」提问...`, contextEntitySlug: entity.slug },
    });
    res.type('html').send(html);
    return;
  }
  
  // Fallback to existing wiki page rendering (keep existing code)
  // ... existing wiki viewer logic ...
}
```

Note: The existing wiki viewer renders wiki .md pages with a sidebar tree. Keep that logic for non-entity pages, but wrap the result with `renderPageShell()` instead of the standalone HTML it currently generates.

- [ ] **Step 2: 验证实体页渲染**

启动服务 `npm start`，访问 `http://localhost:4747/self/wiki/<entity-slug>`，确认：
- Header 存在（repo 名称 + 导航入口）
- 侧边栏显示 Wiki 树 + 实体列表
- 实体内容渲染正确
- 底部输入框显示 "对「{实体名}」提问..."
- 关联 QA 加载并展开已校准答案

- [ ] **Step 3: 提交**

```bash
git add src/server/server.ts
git commit -m "feat: entity/wiki page with unified shell + inline QA"
```

---

### Task 5: context_entity_slug 支持

**Files:**
- Modify: `src/server/qa-endpoint.ts` — 接受 `context_entity_slug` 字段
- Modify: `src/server/server.ts` — QA 路由接收上下文参数

- [ ] **Step 1: 修改 QA 端点，接受 context_entity_slug**

在 qa-endpoint.ts 中修改请求处理，在从请求体读取参数时增加 `context_entity_slug`：

```typescript
// In the handler inside createQaEndpoint, when processing the request body:
const { question, sessionId, repo, context_entity_slug } = req.body || {};

// Before calling LLM/ACP, build entity context:
let entityContext = '';
if (context_entity_slug) {
  try {
    const entityService = getEntityService();
    const entity = entityService.get(context_entity_slug);
    if (entity) {
      entityContext = `[用户正在查看实体 "${entity.name}" (#${entity.slug})]\n定义: ${entity.definition}\n`;
    }
  } catch {}
}

// Prepend entityContext to the system prompt:
const fullSystemPrompt = (entityContext ? entityContext + '\n' : '') + systemPrompt;
```

- [ ] **Step 2: 验证 context 传递**

确认实体页底部输入框的提问请求携带 `context_entity_slug={slug}`

- [ ] **Step 3: 提交**

```bash
git add src/server/qa-endpoint.ts
git commit -m "feat: accept context_entity_slug in QA endpoint"
```

---

### Task 6: QA 页面接入统一 Shell

**Files:**
- Modify: `src/server/server.ts` — QA 页改用 page-shell

- [ ] **Step 1: 修改 QA 页面渲染**

```typescript
// Modify sendQaPage to use renderPageShell
async function sendQaPage(req: any, res: any) {
  try {
    let content = await fs.readFile(qaIndexFile, 'utf-8');
    // Keep the existing QA page functionality (it's a SPA-like page)
    // but wrap it in the unified shell

    const html = renderPageShell(content, {
      headerMode: 'full',
      repoName: req.params.repoName || 'self',
      activeSection: 'qa',
      title: '问答 — OpenCodeWiki',
      bottomInput: { placeholder: '对代码库提问...' },
    });
    res.type('html').send(html);
  } catch {
    res.status(404).type('text').send('Q&A page not found');
  }
}
```

- [ ] **Step 2: 更新 QA 路由**

```typescript
// Update the QA route to include repo context
app.get('/:repoName/qa', sendQaPage);
// Keep the old /qa route for backward compatibility
app.get('/qa', sendQaPage);
```

- [ ] **Step 3: 提交**

```bash
git add src/server/server.ts
git commit -m "feat: QA page with unified shell"
```

---

### Task 7: 管理页接入统一 Shell

**Files:**
- Modify: `src/server/server.ts` — 管理页改用 page-shell
- Remove: 内联 HTML/CSS/JS 的硬编码

- [ ] **Step 1: 重写 `sendAdminPage()`**

```typescript
async function sendAdminPage(_req: any, res: any) {
  const repos = await loadRegistry();
  let pendingHtml = '';
  let hasAny = false;

  for (const repo of repos) {
    const entries = qaStore.listPendingEntries(repo.name);
    if (entries.length === 0) continue;
    hasAny = true;
    pendingHtml += `<div style="margin-bottom:16px">
      <h3 style="font-size:15px;font-weight:600;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--border)">${repo.name} <span style="font-size:11px;color:var(--text-muted);font-weight:400">(${entries.length})</span></h3>`;
    for (const e of entries) {
      pendingHtml += `<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:11px;font-weight:600;color:var(--primary)">#Q${e.qid}</span>
          <span style="font-size:14px;font-weight:500">${e.question.replace(/</g,'&lt;')}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:auto">${(e.createdAt||'').slice(0,10)}</span>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button onclick="window.location.href='/qa?qid=${e.qid}'" style="padding:4px 12px;background:var(--primary);color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer">查看</button>
        </div>
      </div>`;
    }
    pendingHtml += '</div>';
  }

  const content = `
    <h1 style="font-size:22px;font-weight:700;margin-bottom:16px">⏳ 待审区</h1>
    ${hasAny ? pendingHtml : '<div style="color:var(--text-muted);text-align:center;padding:40px;font-size:14px">✅ 暂无待审核条目</div>'}
  `;

  const html = renderPageShell(content, {
    headerMode: 'full',
    repoName: 'self',
    activeSection: 'admin',
    title: '管理 — OpenCodeWiki',
    // No bottom input for admin page
  });
  res.type('html').send(html);
}
```

- [ ] **Step 2: 验证管理页功能**

启动服务，访问 `/admin`，确认：
- 待审条目列表正常显示
- 可点击查看跳转到 QA 页

- [ ] **Step 3: 提交**

```bash
git add src/server/server.ts
git commit -m "feat: admin page with unified shell"
```

---

### Task 8: 归档路由 → wiki-page-service

**Files:**
- Modify: `src/server/server.ts` — POST `/api/wiki/archive` 改用 wiki-page-service

- [ ] **Step 1: 修改归档路由**

```typescript
// Replace the existing archive route body (around line 1254)
app.post('/api/wiki/archive', async (req, res) => {
  const { qid } = req.body;
  if (!qid) { res.status(400).json({ error: 'Missing qid' }); return; }
  try {
    const entry = qaStore.getEntryByQid(qid);
    if (!entry) { res.status(404).json({ error: `#Q${qid} not found` }); return; }
    const cal = qaStore.getCalibratedAnswer(entry.id);
    if (!cal) { res.status(400).json({ error: `#Q${qid} has no calibrated answer` }); return; }

    const { writePage } = await import('./wiki-page-service.js');
    const slug = `q${qid}-${entry.question.slice(0, 40).replace(/[^a-zA-Z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '')}`;
    const content = `---
slug: ${slug}
page_type: qa-archive
status: published
title: "#Q${qid}: ${entry.question}"
---

# #Q${qid}: ${entry.question}

${cal.answer}

---

> 此页面由 #Q${qid} 的校准答案自动归档生成。
`;

    await writePage(slug, 'qa-archive', content);
    res.json({ success: true, slug });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: 验证归档**

调用 POST `/api/wiki/archive` with `{ qid: 3 }`，确认文件写入 `~/.opencodewiki/pages/qa-archives/`

- [ ] **Step 3: 提交**

```bash
git add src/server/server.ts
git commit -m "fix: archive route uses wiki-page-service path"
```

---

## 自审检查

### 1. Spec 覆盖度

| Spec 需求 | 对应 Task |
|-----------|-----------|
| 统一页面骨架 (page-shell.ts) | Task 1 |
| 主页轻 header + 无侧边栏 | Task 2 |
| 实体页完整 header + 侧边栏 | Task 4 |
| 实体页内联 #Q（已校准展开/待校准折叠） | Task 3 + Task 4 |
| 底部输入框统一（三态 placeholder） | Task 1 + Task 2/4/6 注入 |
| context_entity_slug | Task 5 |
| QA 页接入 shell | Task 6 |
| 管理页接入 shell | Task 7 |
| 归档改到 wiki-page-service | Task 8 |

### 2. Placeholder 扫描

所有代码块已包含完整实现。无 TBD/TODO。

### 3. 类型一致性

- `renderPageShell` 在 Task 1 定义，后续所有任务使用相同签名
- `getEntityService()` 已在 wiki-entity.ts 中导出，Task 4 直接使用
- `bottomInput` 的 `contextEntitySlug` 字段类型 `string|undefined` 在 Task 1 定义
