// ── Shared User Bar Component ──────────────────────────────
// Used by: home page, QA page, wiki viewer page
// Renders the current user name + logout.

export interface UserBarVars {
  text?: string;
  text2?: string;
  text3?: string;
  blue?: string;
  border?: string;
  surface?: string;
  tagBg?: string;
}

const defaultVars: UserBarVars = {
  text: 'var(--text)',
  text2: 'var(--text2)',
  text3: 'var(--text3)',
  blue: 'var(--blue)',
  border: 'var(--border)',
  surface: 'var(--surface)',
  tagBg: 'var(--tag-bg)',
};

export function userBarStyles(vars?: UserBarVars): string {
  const v = { ...defaultVars, ...vars };
  return `
.user-bar{display:flex;align-items:center;gap:8px}
.user-bar-avatar{width:28px;height:28px;border-radius:50%;background:${v.blue};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
.user-bar-name{font-size:13px;color:${v.text};max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.user-bar-role{padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;background:#fef3c7;color:#b45309}
.user-bar-logout{padding:6px 10px;border:1px solid ${v.border};border-radius:6px;background:${v.surface};font-size:12px;color:${v.text2};cursor:pointer;text-decoration:none;transition:all .15s}
.user-bar-logout:hover{background:${v.tagBg}}
.user-bar-loading{font-size:12px;color:${v.text3}}
`;
}

export function userBarHtml(): string {
  return `<div class="user-bar" id="userBar"><span class="user-bar-loading">...</span></div>`;
}

export function userBarInitScript(): string {
  return `
(function(){
  var bar = document.getElementById('userBar');
  if (!bar) return;
  fetch('/api/me', { credentials: 'same-origin' })
    .then(function(r){ return r.json(); })
    .then(function(user){
      if (!user || !user.id) { bar.innerHTML = ''; return; }
      var initial = (user.name || user.email).charAt(0).toUpperCase();
      var roleBadge = user.role === 'admin' ? '<span class="user-bar-role">管理员</span>' : '';
      bar.innerHTML =
        '<div class="user-bar-avatar">' + initial + '</div>' +
        '<span class="user-bar-name">' + esc(user.name || user.email) + '</span>' +
        roleBadge +
        '<a class="user-bar-logout" href="/logout">退出</a>';
    })
    .catch(function(){ bar.innerHTML = ''; });
  function esc(s){ var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
})();
`;
}
