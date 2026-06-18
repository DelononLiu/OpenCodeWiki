// ── Shared QA Input Component ──────────────────────────────
// Used by: home page, QA page, wiki viewer page
// Each page provides its own CSS variable names and callbacks.

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
  textarea?: boolean;       // true = <textarea>, false = <input>
  placeholder?: string;
  formAction?: string;      // form action URL (wiki uses '/qa')
  onsubmit?: string;        // JS onsubmit handler (home: 'return submitQa()', QA: 'sendMessage(event)')
  repoName?: string;        // hidden repo input value (wiki only)
  suggestApi?: string;      // URL for question suggestion API (autocomplete)
  suggestDebounceMs?: number; // debounce delay for suggestions (default 300)
  suggestMinChars?: number;  // minimum chars before triggering suggestions (default 2)
  idMap: {
    domainBar: string;
    domainInput: string;
    attachBtn: string;
    fileInput: string;
    sendBtn: string;
    qaInput: string;
    qaHighlight?: string;  // highlight overlay div ID
    typeInput?: string;     // hidden input for type (wiki: wikiQaType)
    suggestDropdown?: string; // suggestion dropdown container ID
  };
}

const DOMAIN_CMD_MAP: Record<string, string> = {
  bug: 'bug-analysis',
  defect: 'bug-analysis',
  log: 'log-analysis',
  stack: 'stack-analysis',
  crash: 'stack-analysis',
  build: 'build-issue',
  compile: 'build-issue',
  explain: 'program-analysis',
  analyze: 'program-analysis',
};

const DOMAIN_LABEL_MAP: Record<string, string> = {
  'log-analysis': '日志分析',
  'stack-analysis': '堆栈分析',
  'bug-analysis': '缺陷分析',
  'build-issue': '编译构建',
  'program-analysis': '程序分析',
};

export function qaInputStyles(v: QaInputVars): string {
  return `
.qa-input-wrap{display:flex;flex-direction:column;background:${v.bgSurface};border:1px solid ${v.border};border-radius:14px;padding:6px 8px;transition:border-color .15s,box-shadow .15s;box-shadow:0 2px 8px rgba(0,0,0,.04)}
.qa-input-wrap:focus-within{border-color:${v.blue};box-shadow:0 0 0 3px rgba(37,99,235,.18)}
.qa-input-layer{position:relative;width:100%}
.qa-input-layer textarea,.qa-input-layer input.qa-text-input,.qa-input-layer .qa-highlight{width:100%;border:none;outline:none;font-size:16px;line-height:1.5;min-height:52px;padding:6px 4px;font-family:inherit;box-sizing:border-box;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word}
.qa-input-layer .qa-highlight{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;color:${v.text};overflow:hidden;min-height:52px}
.qa-input-layer textarea,.qa-input-layer input.qa-text-input{position:relative;z-index:1;background:transparent;resize:none;color:transparent;caret-color:${v.text}}
.qa-input-layer textarea::placeholder,.qa-input-layer input.qa-text-input::placeholder{color:${v.textMuted}}
.qa-input-layer textarea::-webkit-scrollbar{width:4px}
.qa-input-layer textarea::-webkit-scrollbar-thumb{background:${v.textMuted};border-radius:2px}
.qa-input-layer textarea::-webkit-scrollbar-button{display:none}
.cmd-pill{display:inline;padding:1px 6px;border-radius:6px;font-size:14px;font-weight:500;background:${v.blue};color:#fff;line-height:1.8}
.cmd-pill.repo{background:#6366f1}
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
    : `<input class="qa-text-input" type="text" id="${cfg.idMap.qaInput}" name="q" placeholder="${cfg.placeholder || 'Ask anything about this codebase...'}" autocomplete="off">`;

  const highlightId = cfg.idMap.qaHighlight || (cfg.idMap.qaInput + '_hl');

  const hiddenRepo = cfg.repoName
    ? `<input type="hidden" name="repo" value="${cfg.repoName}">`
    : '';
  const hiddenType = cfg.idMap.typeInput
    ? `<input type="hidden" name="type" id="${cfg.idMap.typeInput}" value="">`
    : '';
  const formAttrs = cfg.formAction
    ? `action="${cfg.formAction}" method="GET"`
    : '';
  const submitAttrs = cfg.onsubmit
    ? `onsubmit="${cfg.onsubmit}"`
    : '';

  const inputWithLayer = cfg.idMap.qaHighlight !== undefined
    ? `<div class="qa-input-layer"><div class="qa-highlight" id="${highlightId}"></div>${inputTag}</div>`
    : inputTag;

  const suggestWrap = cfg.idMap.suggestDropdown
    ? `<div class="qa-suggest-wrap">${inputWithLayer}<div class="qa-suggest-dropdown" id="${cfg.idMap.suggestDropdown}"></div></div>`
    : inputWithLayer;

  return `
<div class="qa-input-wrap">
  <div class="file-chips" id="fileChips" style="display:none;flex-wrap:wrap;gap:4px;padding:0 0 4px 0;max-height:60px;overflow-y:auto"></div>
  ${suggestWrap}
  <input type="file" id="${cfg.idMap.fileInput}" multiple style="display:none">
  <form ${formAttrs} ${submitAttrs}>
    ${hiddenRepo}
    ${hiddenType}
    <div class="qa-input-footer">
      <button type="button" class="footer-attach" id="${cfg.idMap.attachBtn}" onclick="document.getElementById('${cfg.idMap.fileInput}').click()" title="上传文件 (日志、截图等)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
      </button>
      <span class="footer-divider">|</span>
      <div class="type-bar" id="${cfg.idMap.domainBar}">
        <button type="button" class="type-chip" data-domain="log-analysis" data-label="日志分析">日志分析</button>
        <button type="button" class="type-chip" data-domain="stack-analysis" data-label="堆栈分析">堆栈分析</button>
        <button type="button" class="type-chip" data-domain="bug-analysis" data-label="缺陷分析">缺陷分析</button>
        <button type="button" class="type-chip" data-domain="build-issue" data-label="编译构建">编译构建</button>
        <button type="button" class="type-chip" data-domain="program-analysis" data-label="程序分析">程序分析</button>
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
// ── QA Input: domain bar init ──
(function(){
  var SD = null;
  var SR = null; // selected repo
  var domainInput = document.getElementById('${cfg.idMap.domainInput}');
  var bar = document.getElementById('${cfg.idMap.domainBar}');
  var inp = document.getElementById('${cfg.idMap.qaInput}');
  var hl = document.getElementById('${highlightId}');
  var repoList = []; // fetched from /api/repos

  if (!bar) return;

  // ── /command and @repo highlight ──
  if (inp && hl) {
    // Fetch known repo names
    try { fetch('/api/repos').then(function(r){return r.json()}).then(function(list){ repoList = (list||[]).map(function(x){return x.name}); }).catch(function(){}); } catch(e) {}

    function renderHighlight() {
      var raw = inp.value;
      if (!raw) { hl.innerHTML = ''; return; }
      // /command at start
      var html = raw.replace(
        /(?:^|\\s)(\\/[a-zA-Z]+)/g,
        function(m, cmd) {
          var key = cmd.slice(1).toLowerCase();
          var label = DOMAIN_CMD_LABEL[key] || key;
          return '<span class="cmd-pill">' + esc(label) + '</span>';
        }
      );
      // @repo
      html = html.replace(
        /(?:^|\\s)(@[a-zA-Z0-9._-]+)/g,
        function(m, at) {
          var name = at.slice(1);
          return '<span class="cmd-pill repo">' + esc(name) + '</span>';
        }
      );
      hl.innerHTML = html;
    }

    inp.addEventListener('input', function() {
      renderHighlight();
      // Parse /command → set domain
      var m = inp.value.match(/^\\s*\\/([a-zA-Z]+)/);
      if (m) {
        var key = m[1].toLowerCase();
        var dom = DOMAIN_CMD_MAP[key];
        if (dom && dom !== SD) {
          SD = dom;
          bar.querySelectorAll('.type-chip').forEach(function(b){ b.classList.toggle('active', b.dataset.domain === dom); });
          updateDomainInput();
        }
      }
    });

    renderHighlight();
  }

  function updateDomainInput() {
    if (domainInput) domainInput.value = SD || '';
  }

  bar.addEventListener('click', function(e){
    var btn = e.target.closest('.type-chip');
    if (!btn) return;
    var dom = btn.dataset.domain;
    if (SD === dom) {
      SD = null;
      bar.querySelectorAll('.type-chip').forEach(function(b){ b.classList.remove('active'); });
    } else {
      SD = dom;
      bar.querySelectorAll('.type-chip').forEach(function(b){ b.classList.toggle('active', b.dataset.domain === dom); });
    }
    updateDomainInput();
  });
  // Restore from URL param
  var _dm = new URLSearchParams(location.search).get('domain');
  if(_dm){
    SD = _dm;
    bar.querySelectorAll('.type-chip').forEach(function(b){
      if(b.dataset.domain === _dm) b.classList.add('active');
    });
    updateDomainInput();
  }
  // Expose selectedDomain for page-specific send functions
  window.__qaSelectedDomain = function(){ return SD; };
  window.__qaSelectedRepo = function(){ return SR; };
})();

// ── QA Input: /@ command maps ──
var DOMAIN_CMD_MAP = ${JSON.stringify(DOMAIN_CMD_MAP)};
var DOMAIN_CMD_LABEL = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(DOMAIN_CMD_MAP).map(([cmd, dom]) => [cmd, DOMAIN_LABEL_MAP[dom] || dom])
  )
)};
var DOMAIN_LABEL_MAP = ${JSON.stringify(DOMAIN_LABEL_MAP)};

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── QA Input: question suggest autocomplete ──
try {
(function(){
  var _api = ${cfg.suggestApi ? `'${cfg.suggestApi}'` : 'null'};
  var _min = ${cfg.suggestMinChars ?? 2};
  var _deb = ${cfg.suggestDebounceMs ?? 300};
  if (!_api) return;
  var _inp = document.getElementById('${cfg.idMap.qaInput}');
  var _dd = document.getElementById('${cfg.idMap.suggestDropdown || ''}');
  if (!_inp || !_dd) return;
  var _timer = null;
  var _items = [];
  var _idx = -1;
  var _comp = false;
  var _dismissed = false;

  _inp.addEventListener('compositionstart', function(){ _comp = true; });
  _inp.addEventListener('compositionend', function(){ _comp = false; this.dispatchEvent(new Event('input', {bubbles:true})); });

  _inp.addEventListener('input', function(){
    clearTimeout(_timer);
    if (_comp) return;
    if (_dismissed) return;
    var val = this.value.trim();
    if (val.length < _min) {
      _dd.classList.remove('open'); _dd.innerHTML = ''; _items = []; _idx = -1; _dismissed = false; return;
    }
    _timer = setTimeout(function(){
      _dd.innerHTML = '<div class="qa-suggest-empty">Searching...</div>';
      _dd.classList.add('open');
      fetch(_api + '?q=' + encodeURIComponent(val) + '&limit=5')
        .then(function(r){ if (!r.ok) throw new Error('fail'); return r.json(); })
        .then(function(data){
          _items = data.suggestions || []; _idx = -1;
          if (_items.length === 0) {
            _dd.classList.remove('open'); _dd.innerHTML = ''; return;
          }
          var html = '';
          for (var i = 0; i < _items.length; i++) {
            var q = _items[i].question;
            var escQ = esc(q);
            var lq = q.toLowerCase();
            var lv = val.toLowerCase();
            var pos = lq.indexOf(lv);
            var display = pos >= 0
              ? escQ.slice(0, pos) + '<span class="qa-suggest-match">' + escQ.slice(pos, pos + val.length) + '</span>' + escQ.slice(pos + val.length)
              : escQ;
            html += '<div class="qa-suggest-item" data-index="' + i + '">' + display + '</div>';
          }
          _dd.innerHTML = html;
        })
        .catch(function(){ _dd.innerHTML = '<div class="qa-suggest-error">Suggestions unavailable</div>'; });
    }, _deb);
  });

  _inp.addEventListener('keydown', function(e){
    if (!_dd.classList.contains('open') || _items.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); _idx = Math.min(_idx + 1, _items.length - 1); _highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _idx = Math.max(_idx - 1, -1); _highlight(); }
    else if (e.key === 'Enter' && _idx >= 0) { e.preventDefault(); _select(_idx); }
    else if (e.key === 'Escape') { _dd.classList.remove('open'); _dd.innerHTML = ''; _items = []; _idx = -1; _dismissed = true; }
  }, true);

  function _highlight() {
    var items = _dd.querySelectorAll('.qa-suggest-item');
    items.forEach(function(el, i){ el.classList.toggle('highlighted', i === _idx); });
    if (_idx >= 0 && items[_idx]) items[_idx].scrollIntoView({ block: 'nearest' });
  }

  function _select(index) {
    if (index >= 0 && index < _items.length) {
      _inp.value = _items[index].question;
      _dd.classList.remove('open'); _dd.innerHTML = ''; _items = []; _idx = -1; _dismissed = true;
      if (typeof updateSendBtn === 'function') updateSendBtn();
      if (typeof autoResize === 'function') autoResize();
      if (inp && hl) { var e = document.createEvent('Event'); e.initEvent('input', true, false); inp.dispatchEvent(e); }
      _inp.focus();
    }
  }

  _dd.addEventListener('mousedown', function(e){
    var item = e.target.closest('.qa-suggest-item');
    if (item) { _select(parseInt(item.dataset.index)); }
  });

  document.addEventListener('click', function(e){
    var wrap = _inp.closest('.qa-suggest-wrap');
    if (!wrap || !wrap.contains(e.target)) {
      _dd.classList.remove('open'); _dd.innerHTML = ''; _items = []; _idx = -1;
    }
  });
})();
} catch(e) { console.error('[qa-input] suggest error', e); }
`.trim();
}
