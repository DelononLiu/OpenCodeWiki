// src/server/page-shell.ts — 统一页面骨架生成器

export interface SidebarOptions {
  wikiTree?: {name: string, slug: string, children?: {name: string, slug: string}[]}[];
  entities?: {name: string, slug: string, qaCount?: number}[];
  qaEntries?: {qid: number, question: string}[];
}

export interface ShellOpts {
  headerMode: 'light' | 'full';
  repoName?: string;
  activeSection?: string;
  title?: string;
  bottomInput?: {
    placeholder: string;
    contextEntitySlug?: string;
  };
  sidebar?: SidebarOptions;
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

export function renderSidebar(repoName: string, activeSection: string, options?: SidebarOptions): string {
  let html = '<div class="sidebar"><div class="sidebar-nav">';

  // Admin page sidebar
  if (activeSection === 'admin') {
    html += '<div class="sidebar-section">⚙️ 管理</div>';
    html += '<a class="sidebar-item active" href="/admin">⏳ 待审区</a>';
    html += '<a class="sidebar-item" href="/admin/entities">🏷️ 实体管理</a>';
    html += '</div></div>';
    return html;
  }

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
  const dataAttr = `data-entity-slug="${contextEntitySlug || ''}"`;
  return `<div class="bottom-input-wrap">
    <div class="bottom-input">
      <input type="text" placeholder="${placeholder}" id="globalQaInput" ${dataAttr}>
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
  const sidebar = opts.headerMode === 'full' ? renderSidebar(opts.repoName || '', opts.activeSection || '', opts.sidebar) : '';
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
async function sendGlobalQa(){var i=document.getElementById('globalQaInput');if(!i||!i.value.trim())return;var q=i.value;var slug=i.getAttribute('data-entity-slug')||'';var url='/qa?q='+encodeURIComponent(q);if(slug)url+='&context_entity_slug='+encodeURIComponent(slug);window.location.href=url}
document.getElementById('globalQaInput')?.addEventListener('keydown',function(e){if(e.key==='Enter')sendGlobalQa()});
</script>
</body></html>`;
}
