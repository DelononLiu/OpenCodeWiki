// ── Shared QA Input Component ──────────────────────────────

export interface QaInputVars {
  bgSurface: string;
  bgSecondary: string;
  border: string;
  text: string;
  textMuted: string;
  blue: string;
}

export interface QaInputConfig {
  vars: QaInputVars;
  textarea?: boolean;
  placeholder?: string;
  formAction?: string;
  onsubmit?: string;
  repoName?: string;
  suggestApi?: string;
  suggestDebounceMs?: number;
  suggestMinChars?: number;
  idMap: {
    domainBar: string;
    domainInput: string;
    attachBtn: string;
    fileInput: string;
    sendBtn: string;
    qaInput: string;
    qaHighlight?: string;
    typeInput?: string;
    suggestDropdown?: string;
  };
}

const CMD_ITEMS = [
  {key: '/bug', label: '缺陷分析', desc: '分析代码缺陷和bug'},
  {key: '/defect', label: '缺陷分析', desc: '分析代码缺陷和bug'},
  {key: '/log', label: '日志分析', desc: '分析日志和错误输出'},
  {key: '/stack', label: '堆栈分析', desc: '分析崩溃堆栈和调用栈'},
  {key: '/crash', label: '堆栈分析', desc: '分析崩溃堆栈和调用栈'},
  {key: '/build', label: '编译构建', desc: '分析编译链接问题'},
  {key: '/compile', label: '编译构建', desc: '分析编译链接问题'},
  {key: '/explain', label: '程序分析', desc: '解释代码逻辑和行为'},
  {key: '/analyze', label: '程序分析', desc: '深入分析代码实现'},
];

const DOMAIN_CMD_MAP: Record<string, string> = {
  bug: 'bug-analysis', defect: 'bug-analysis',
  log: 'log-analysis',
  stack: 'stack-analysis', crash: 'stack-analysis',
  build: 'build-issue', compile: 'build-issue',
  explain: 'program-analysis', analyze: 'program-analysis',
};

const CMD_LABEL: Record<string, string> = {bug:'缺陷分析',defect:'缺陷分析',log:'日志分析',stack:'堆栈分析',crash:'堆栈分析',build:'编译构建',compile:'编译构建',explain:'程序分析',analyze:'程序分析'};

export function qaInputStyles(v: QaInputVars): string {
  return `
.qa-input-wrap{display:flex;flex-direction:column;background:${v.bgSurface};border:1px solid ${v.border};border-radius:14px;padding:6px 8px;transition:border-color .15s,box-shadow .15s;box-shadow:0 2px 8px rgba(0,0,0,.04);position:relative}
.qa-input-wrap:focus-within{border-color:${v.blue};box-shadow:0 0 0 3px rgba(37,99,235,.18)}
.qa-input-layer{position:relative;width:100%}
.qa-input-layer textarea,.qa-input-layer input.qa-text-input,.qa-input-layer .qa-highlight{width:100%;border:none;outline:none;font-size:16px;line-height:1.5;min-height:52px;padding:6px 4px;font-family:inherit;box-sizing:border-box;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word}
.qa-input-layer .qa-highlight{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;color:${v.text};min-height:52px}
.qa-input-layer textarea,.qa-input-layer input.qa-text-input{position:relative;z-index:2;background:transparent;resize:none;color:transparent;caret-color:${v.text}}
.qa-input-layer textarea::placeholder,.qa-input-layer input.qa-text-input::placeholder{color:${v.textMuted}}
.qa-input-layer textarea::-webkit-scrollbar{width:4px}
.qa-input-layer textarea::-webkit-scrollbar-thumb{background:${v.textMuted};border-radius:2px}
.qa-input-layer textarea::-webkit-scrollbar-button{display:none}
.cmd-pill{background:${v.blue};color:#fff;border-radius:5px}
.cmd-pill.repo{background:${v.blue}}
.cmd-dropdown{position:absolute;top:30px;left:4px;right:4px;display:none;background:${v.bgSurface};border:1px solid ${v.border};border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:10;max-height:160px;overflow-y:auto;font-size:12px}
.cmd-dropdown.open{display:block}
.cmd-dropdown .cmd-item{padding:5px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;border-bottom:1px solid ${v.border}}
.cmd-dropdown .cmd-item:last-child{border-bottom:none}
.cmd-dropdown .cmd-item:hover,.cmd-dropdown .cmd-item.highlighted{background:${v.bgSecondary}}
.cmd-dropdown .cmd-key{font-weight:600;color:${v.blue};background:${v.bgSecondary};padding:0 4px;border-radius:3px;font-size:11px}
.cmd-dropdown .cmd-label{color:${v.text};flex:1}
.cmd-dropdown .cmd-desc{color:${v.textMuted};font-size:10px}
.qa-input-footer{display:flex;align-items:center;gap:6px;padding:4px 0 2px;margin:0 2px}
.qa-input-footer .footer-attach{background:none;border:none;color:${v.textMuted};cursor:pointer;padding:4px;border-radius:4px;display:flex;align-items:center;flex-shrink:0}
.qa-input-footer .footer-attach:hover{color:${v.blue}}
.qa-input-footer .footer-divider{color:${v.border};font-size:14px;user-select:none;flex-shrink:0;line-height:1}
.qa-input-footer .type-bar{flex:1;display:flex;gap:2px}
.qa-input-footer .type-chip{padding:2px 8px;border:0.5px solid ${v.border};border-radius:10px;background:transparent;font-size:11px;color:${v.textMuted};cursor:pointer;transition:all .15s;white-space:nowrap;user-select:none}
.qa-input-footer .type-chip:hover{border-color:${v.blue};color:${v.blue}}
.qa-input-footer .type-chip.active{background:${v.blue};color:#fff;border-color:${v.blue}}
.qa-input-footer button{padding:4px 16px;background:${v.blue};color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;flex-shrink:0}
.qa-input-footer button:hover{opacity:.88}
.qa-input-footer button:disabled{opacity:.35;cursor:not-allowed}
.qa-suggest-wrap{position:relative}
.qa-suggest-dropdown{position:absolute;top:100%;left:0;right:0;display:none;background:${v.bgSurface};border:1px solid ${v.border};border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:50;max-height:220px;overflow-y:auto;margin-top:2px;font-size:14px}
.qa-suggest-dropdown.open{display:block}
.qa-suggest-item{padding:10px 14px;color:${v.text};cursor:pointer;border-bottom:1px solid ${v.border};line-height:1.4;transition:background .1s}
.qa-suggest-item:last-child{border-bottom:none}
.qa-suggest-item:hover,.qa-suggest-item.highlighted{background:${v.bgSecondary}}
.qa-suggest-match{font-weight:600;color:${v.blue}}
.qa-suggest-empty,.qa-suggest-error{padding:14px;color:${v.textMuted};text-align:center;font-size:13px}
`.trim();
}

export function qaInputHtml(cfg: QaInputConfig): string {
  const inputTag = cfg.textarea !== false
    ? `<textarea id="${cfg.idMap.qaInput}" rows="2" placeholder="${cfg.placeholder || '输入代码库相关问题...'}" autocomplete="off"></textarea>`
    : `<input class="qa-text-input" type="text" id="${cfg.idMap.qaInput}" name="q" placeholder="${cfg.placeholder || 'Ask...'}" autocomplete="off">`;

  const highlightId = cfg.idMap.qaHighlight || (cfg.idMap.qaInput + '_hl');
  const hiddenRepo = cfg.repoName ? `<input type="hidden" name="repo" value="${cfg.repoName}">` : '';
  const hiddenType = cfg.idMap.typeInput ? `<input type="hidden" name="type" id="${cfg.idMap.typeInput}" value="">` : '';
  const formAttrs = cfg.formAction ? `action="${cfg.formAction}" method="GET"` : '';
  const submitAttrs = cfg.onsubmit ? `onsubmit="${cfg.onsubmit}"` : '';

  const inputHtml = cfg.idMap.qaHighlight !== undefined
    ? `<div class="qa-input-layer"><div class="qa-highlight" id="${highlightId}"></div>${inputTag}<div class="cmd-dropdown" id="${cfg.idMap.qaInput}_dd"></div></div>`
    : inputTag;

  const suggestWrap = cfg.idMap.suggestDropdown
    ? `<div class="qa-suggest-wrap">${inputHtml}<div class="qa-suggest-dropdown" id="${cfg.idMap.suggestDropdown}"></div></div>`
    : inputHtml;

  return `
<div class="qa-input-wrap">
  <div class="file-chips" id="fileChips" style="display:none;flex-wrap:wrap;gap:4px;padding:0 0 4px 0;max-height:60px;overflow-y:auto"></div>
  ${suggestWrap}
  <input type="file" id="${cfg.idMap.fileInput}" multiple style="display:none">
  <form ${formAttrs} ${submitAttrs}>
    ${hiddenRepo}${hiddenType}
    <div class="qa-input-footer">
      <button type="button" class="footer-attach" id="${cfg.idMap.attachBtn}" onclick="document.getElementById('${cfg.idMap.fileInput}').click()" title="上传文件">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      </button>
      <span class="footer-divider">|</span>
      <div class="type-bar" id="${cfg.idMap.domainBar}">
        <button type="button" class="type-chip" data-domain="log-analysis">日志分析</button>
        <button type="button" class="type-chip" data-domain="stack-analysis">堆栈分析</button>
        <button type="button" class="type-chip" data-domain="bug-analysis">缺陷分析</button>
        <button type="button" class="type-chip" data-domain="build-issue">编译构建</button>
        <button type="button" class="type-chip" data-domain="program-analysis">程序分析</button>
      </div>
      <input type="hidden" id="${cfg.idMap.domainInput}" value="">
      <button type="${cfg.formAction || cfg.onsubmit ? 'submit' : 'button'}" id="${cfg.idMap.sendBtn}">Ask</button>
    </div>
  </form>
</div>`.trim();
}

export function qaInputInitScript(cfg: QaInputConfig): string {
  const highlightId = cfg.idMap.qaHighlight || (cfg.idMap.qaInput + '_hl');
  return `
(function(){
  var SD = null, SR = null;
  var di = document.getElementById('${cfg.idMap.domainInput}');
  var bar = document.getElementById('${cfg.idMap.domainBar}');
  var inp = document.getElementById('${cfg.idMap.qaInput}');
  var hl = document.getElementById('${highlightId}');
  if (!bar || !inp) return;
  var dd = document.getElementById(inp.id + '_dd');
  var repoList = [];
  try { fetch('/api/repos').then(function(r){return r.json()}).then(function(a){ repoList = (a||[]).map(function(x){return x.name}); }).catch(function(){}); } catch(e) {}

  var $CMD = ${JSON.stringify(CMD_ITEMS)};
  var $MAP = ${JSON.stringify(DOMAIN_CMD_MAP)};
  var $LAB = ${JSON.stringify(CMD_LABEL)};

  // ── Highlight overlay ──
  var _pending = false, _lastHl = '';
  function render() {
    if (!hl || _pending) return;
    _pending = true;
    requestAnimationFrame(function(){
      _pending = false;
      var raw = inp.value;
      if (!raw) {
        if (_lastHl) { hl.textContent = ''; _lastHl = ''; }
        return;
      }
      if (/[\/@]/.test(raw)) {
        var h = esc(raw).replace(/(?:^|\\s)(\\/[a-zA-Z]+)/g, '<span class="cmd-pill">$1</span>');
        h = h.replace(/(?:^|\\s)(@[a-zA-Z0-9._-]+)/g, '<span class="cmd-pill repo">$1</span>');
        if (h !== _lastHl) { hl.innerHTML = h; _lastHl = h; }
      } else {
        if (raw !== _lastHl) { hl.textContent = raw; _lastHl = raw; }
      }
    });
  }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function cmdLabel(k) { return $LAB[k] || k; }

  // ── Completion dropdown ──
  var CMDS_CACHE = null;

  function showCmd(partial) {
    if (!dd) return;
    CMDS_CACHE = 'cmd';
    var q = partial.toLowerCase();
    var items = q ? $CMD.filter(function(x){ return x.key.indexOf(q) >= 0; }) : $CMD;
    if (!items.length) { hide(); return; }
    dd.innerHTML = items.map(function(x,i){ return '<div class="cmd-item" data-i="' + i + '"><span class="cmd-key">' + esc(x.key) + '</span><span class="cmd-label">' + esc(x.label) + '</span><span class="cmd-desc">' + esc(x.desc) + '</span></div>'; }).join('');
    dd._items = items;
    cmdIdx = 0;
    dd.classList.add('open');
    cmdHighlight();
  }

  function showRepo(partial) {
    if (!dd) return;
    CMDS_CACHE = 'repo';
    var q = partial.toLowerCase();
    var items = q ? repoList.filter(function(x){ return x.toLowerCase().indexOf(q) >= 0; }) : repoList.slice();
    if (!items.length) { hide(); return; }
    dd.innerHTML = items.map(function(x,i){ return '<div class="cmd-item" data-i="' + i + '"><span class="cmd-key" style="background:none">@</span><span class="cmd-label">' + esc(x) + '</span></div>'; }).join('');
    dd._items = items;
    cmdIdx = 0;
    dd.classList.add('open');
    cmdHighlight();
  }

  var cmdIdx = -1;
  function hide() { if (dd) { dd.classList.remove('open'); dd.innerHTML = ''; dd._items = null; CMDS_CACHE = null; cmdIdx = -1; } }

  function cmdSelect(idx) {
    if (!dd || !dd._items || !CMDS_CACHE) return;
    var sel = dd._items[idx];
    if (!sel) return;
    if (CMDS_CACHE === 'cmd') {
      inp.value = inp.value.replace(/(?:^|\\s)\\/[^\\s]*$/, ' ' + sel.key + ' ');
    } else {
      inp.value = inp.value.replace(/(?:^|\\s)@[^\\s]*$/, ' @' + sel + ' ');
    }
    hide(); render(); inp.focus();
  }

  function cmdHighlight() {
    if (!dd) return;
    var items = dd.querySelectorAll('.cmd-item');
    items.forEach(function(el, i){ el.classList.toggle('highlighted', i === cmdIdx); });
  }

  // ── Keyboard: ArrowDown/Up/Enter/Escape for cmd dropdown ──
  inp.addEventListener('keydown', function(e){
    if (!dd || !dd.classList.contains('open') || !dd._items) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdIdx = Math.min(cmdIdx + 1, dd._items.length - 1); cmdHighlight(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); cmdIdx = Math.max(cmdIdx - 1, -1); cmdHighlight(); return; }
    if (e.key === 'Enter') {
      if (cmdIdx >= 0) { e.preventDefault(); e.stopImmediatePropagation(); cmdSelect(cmdIdx); return; }
      e.preventDefault(); hide(); return;
    }
    if (e.key === 'Escape') { e.preventDefault(); hide(); return; }
  }, true);  // capture phase: prevent submit before page-level handlers see it

  if (dd) {
    dd.addEventListener('mousedown', function(e){
      var item = e.target.closest('.cmd-item');
      if (!item || !dd._items || !CMDS_CACHE) return;
      cmdSelect(parseInt(item.dataset.i));
    });
  }

  // ── Input events ──
  inp.addEventListener('input', function() {
    render();
    var v = inp.value;
    // Match / at end of a word — show command completion whether partial or not
    var cm = v.match(/(?:^|\\s)(\\/[^\\s]*)$/);
    if (cm) { showCmd(cm[1].slice(1)); return; }
    // Match @ at end of a word — show repo completion
    var am = v.match(/(?:^|\\s)(@[^\\s]*)$/);
    if (am) { showRepo(am[1].slice(1)); return; }
    // No match → hide, but parse /command at front for domain
    hide();
    var dm = v.match(/^\\s*\\/([a-zA-Z]+)(?:\\s|$)/);
    if (dm) { var dom = $MAP[dm[1].toLowerCase()]; if (dom && dom !== SD) { SD = dom; bar.querySelectorAll('.type-chip').forEach(function(b){ b.classList.toggle('active', b.dataset.domain === dom); }); if (di) di.value = dom; } }
  });

  document.addEventListener('click', function(e) { if (dd && !e.target.closest('.qa-input-wrap')) hide(); });

  // ── Domain chip click ──
  function upd() { if (di) di.value = SD || ''; }
  bar.addEventListener('click', function(e){
    var btn = e.target.closest('.type-chip');
    if (!btn) return;
    var dom = btn.dataset.domain;
    if (SD === dom) { SD = null; bar.querySelectorAll('.type-chip').forEach(function(b){ b.classList.remove('active'); }); }
    else { SD = dom; bar.querySelectorAll('.type-chip').forEach(function(b){ b.classList.toggle('active', b.dataset.domain === dom); }); }
    upd();
  });

  var _dm = new URLSearchParams(location.search).get('domain');
  if (_dm) { SD = _dm; bar.querySelectorAll('.type-chip').forEach(function(b){ if (b.dataset.domain === _dm) b.classList.add('active'); }); upd(); }

  window.__qaSelectedDomain = function(){ return SD; };
  window.__qaSelectedRepo = function(){ return SR; };
  render();
})();

// ── Suggest autocomplete ──
try {
(function(){
  var _api = ${cfg.suggestApi ? `'${cfg.suggestApi}'` : 'null'};
  var _min = ${cfg.suggestMinChars ?? 2};
  var _deb = ${cfg.suggestDebounceMs ?? 300};
  if (!_api) return;
  var _inp = document.getElementById('${cfg.idMap.qaInput}');
  var _dd = document.getElementById('${cfg.idMap.suggestDropdown || ''}');
  if (!_inp || !_dd) return;
  var _timer, _items = [], _idx = -1, _comp = false, _dismissed = false;

  _inp.addEventListener('compositionstart', function(){ _comp = true; });
  _inp.addEventListener('compositionend', function(){ _comp = false; this.dispatchEvent(new Event('input', {bubbles:true})); });

  _inp.addEventListener('input', function(){
    clearTimeout(_timer);
    if (_comp || _dismissed) return;
    // Don't show suggest while cmd dropdown is open (typing / or @)
    var cmdDd = document.getElementById(this.id + '_dd');
    if (cmdDd && cmdDd.classList.contains('open')) return;
    var val = this.value.trim();
    if (val.length < _min) { _dd.classList.remove('open'); _dd.innerHTML = ''; _items = []; _idx = -1; _dismissed = false; return; }
    _timer = setTimeout(function(){
      fetch(_api + '?q=' + encodeURIComponent(val) + '&limit=5')
        .then(function(r){ if (!r.ok) throw Error(); return r.json(); })
        .then(function(data){
          _items = data.suggestions || []; _idx = -1;
          if (!_items.length) return;
          _dd.innerHTML = _items.map(function(q,i){
            var es = esc(q.question), lq = q.question.toLowerCase(), lv = val.toLowerCase(), p = lq.indexOf(lv);
            return '<div class="qa-suggest-item" data-index="' + i + '">' + (p >= 0 ? es.slice(0,p) + '<span class="qa-suggest-match">' + es.slice(p,p+val.length) + '</span>' + es.slice(p+val.length) : es) + '</div>';
          }).join('');
          _dd.classList.add('open');
        }).catch(function(){});
    }, _deb);
  });

  _inp.addEventListener('keydown', function(e){
    if (!_dd.classList.contains('open') || !_items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); _idx = Math.min(_idx+1, _items.length-1); _dd.querySelectorAll('.qa-suggest-item').forEach(function(el,i){ el.classList.toggle('highlighted',i===_idx); }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _idx = Math.max(_idx-1, -1); _dd.querySelectorAll('.qa-suggest-item').forEach(function(el,i){ el.classList.toggle('highlighted',i===_idx); }); }
    else if (e.key === 'Enter' && _idx >= 0) { e.preventDefault(); _select(_idx); }
    else if (e.key === 'Escape') { _dd.classList.remove('open'); _dd.innerHTML = ''; _items = []; _idx = -1; _dismissed = true; }
  }, true);

  function _select(i) {
    if (i >= 0 && i < _items.length) {
      _inp.value = _items[i].question;
      _dd.classList.remove('open'); _dd.innerHTML = ''; _items = []; _idx = -1; _dismissed = true;
      if (typeof updateSendBtn === 'function') updateSendBtn();
      if (typeof autoResize === 'function') autoResize();
      _inp.focus();
    }
  }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  _dd.addEventListener('mousedown', function(e){ var item = e.target.closest('.qa-suggest-item'); if (item) _select(parseInt(item.dataset.index)); });
  document.addEventListener('click', function(e){ var w = _inp.closest('.qa-suggest-wrap'); if (!w || !w.contains(e.target)) { _dd.classList.remove('open'); _dd.innerHTML = ''; _items = []; _idx = -1; } });
})();
} catch(e) { console.error('[qa-input]', e); }
`.trim();
}
