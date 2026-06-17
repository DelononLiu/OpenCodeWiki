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
    domainMoreBtn: string;
    domainMoreDropdown: string;
    domainInput: string;
    attachBtn: string;
    fileInput: string;
    sendBtn: string;
    qaInput: string;
    typeInput?: string;     // hidden input for type (wiki: wikiQaType)
    suggestDropdown?: string; // suggestion dropdown container ID
  };
}

export function qaInputStyles(v: QaInputVars): string {
  return `
.qa-input-wrap{display:flex;flex-direction:column;background:${v.bgSurface};border:1px solid ${v.border};border-radius:14px;padding:6px 8px;transition:border-color .15s,box-shadow .15s;box-shadow:0 2px 8px rgba(0,0,0,.04)}
.qa-input-wrap:focus-within{border-color:${v.blue};box-shadow:0 0 0 3px rgba(37,99,235,.18)}
.qa-input-wrap textarea,.qa-input-wrap input.qa-text-input{width:100%;border:none;background:transparent;outline:none;font-size:16px;color:${v.text};resize:none;overflow:hidden;padding:6px 4px;line-height:1.5;min-height:52px;font-family:inherit;box-sizing:border-box}
.qa-input-wrap textarea::placeholder,.qa-input-wrap input.qa-text-input::placeholder{color:${v.textMuted}}
.qa-input-wrap textarea::-webkit-scrollbar{width:4px}
.qa-input-wrap textarea::-webkit-scrollbar-thumb{background:${v.textMuted};border-radius:2px}
.qa-input-wrap textarea::-webkit-scrollbar-button{display:none}
.qa-input-footer{display:flex;align-items:center;gap:6px;padding:4px 0 2px;margin:0 2px}
.qa-input-footer .footer-attach{background:none;border:none;color:${v.textMuted};cursor:pointer;padding:4px;border-radius:4px;display:flex;align-items:center;flex-shrink:0}
.qa-input-footer .footer-attach:hover{color:${v.blue}}
.qa-input-footer .footer-divider{color:${v.border};font-size:14px;user-select:none;flex-shrink:0;line-height:1}
.qa-input-footer .type-bar{flex:1;display:flex;gap:2px}
.qa-input-footer .type-chip{padding:2px 8px;border:0.5px solid ${v.border};border-radius:10px;background:transparent;font-size:11px;color:${v.textMuted};cursor:pointer;transition:all .15s;white-space:nowrap;user-select:none}
.qa-input-footer .type-chip:hover{border-color:${v.blue};color:${v.blue}}
.qa-input-footer .type-chip.active{background:${v.blue};color:#fff;border-color:${v.blue}}
.qa-input-footer .more-wrapper{position:relative;display:inline-flex}
.qa-input-footer .more-dropdown{position:absolute;bottom:calc(100% + 4px);left:0;display:none;flex-direction:column;gap:2px;background:${v.bgSurface};border:1px solid ${v.border};border-radius:8px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:50;min-width:80px}
.qa-input-footer .more-dropdown.open{display:flex}
.qa-input-footer .more-dropdown .type-chip{white-space:nowrap}
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

  const suggestWrap = cfg.idMap.suggestDropdown
    ? `<div class="qa-suggest-wrap">${inputTag}<div class="qa-suggest-dropdown" id="${cfg.idMap.suggestDropdown}"></div></div>`
    : inputTag;

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
        <button class="type-chip" data-domain="log-analysis" data-label="日志分析">日志分析</button>
        <button class="type-chip" data-domain="stack-analysis" data-label="堆栈分析">堆栈分析</button>
        <button class="type-chip" data-domain="bug-analysis" data-label="缺陷分析">缺陷分析</button>
        <span class="more-wrapper">
          <button class="type-chip" id="${cfg.idMap.domainMoreBtn}" data-domain="">更多&#9660;</button>
          <div class="more-dropdown" id="${cfg.idMap.domainMoreDropdown}">
            <button class="type-chip" data-domain="build-issue" data-label="编译构建">编译构建</button>
            <button class="type-chip" data-domain="program-analysis" data-label="程序分析">程序分析</button>
          </div>
        </span>
      </div>
      <input type="hidden" id="${cfg.idMap.domainInput}" value="">
      <button type="${cfg.formAction || cfg.onsubmit ? 'submit' : 'button'}" id="${cfg.idMap.sendBtn}">Ask</button>
    </div>
  </form>
</div>`.trim();
}

export function qaInputInitScript(cfg: QaInputConfig): string {
  return `
// ── QA Input: domain bar init ──
(function(){
  var SD = null;
  var moreBtn = document.getElementById('${cfg.idMap.domainMoreBtn}');
  var moreDd = document.getElementById('${cfg.idMap.domainMoreDropdown}');
  var domainInput = document.getElementById('${cfg.idMap.domainInput}');
  var bar = document.getElementById('${cfg.idMap.domainBar}');
  if (!bar) return;

  function updateDomainInput() {
    if (domainInput) domainInput.value = SD || '';
  }

  bar.addEventListener('click', function(e){
    var btn = e.target.closest('.type-chip');
    if (!btn) return;
    var dom = btn.dataset.domain;
    if (btn.id === '${cfg.idMap.domainMoreBtn}'){ moreDd.classList.toggle('open'); return; }
    moreDd.classList.remove('open');
    if (SD === dom) {
      SD = null;
      bar.querySelectorAll('.type-chip').forEach(function(b){ b.classList.remove('active'); });
    } else {
      SD = dom;
      bar.querySelectorAll('.type-chip').forEach(function(b){ b.classList.toggle('active', b.dataset.domain === dom); });
    }
    updateDomainInput();
  });
  document.addEventListener('click', function(e){
    if(moreDd && moreDd.classList.contains('open') && !e.target.closest('.more-wrapper')) moreDd.classList.remove('open');
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
})();

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
  var _dismissed = false;   // 选中推荐或按ESC后，不再弹出推荐列表，直到输入框为空

  function _esc(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

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
            var esc = _esc(q);
            var lq = q.toLowerCase();
            var lv = val.toLowerCase();
            var pos = lq.indexOf(lv);
            var display = pos >= 0
              ? esc.slice(0, pos) + '<span class="qa-suggest-match">' + esc.slice(pos, pos + val.length) + '</span>' + esc.slice(pos + val.length)
              : esc;
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
  }, true);  // capture phase: 确保在页面keydown之前执行，e.defaultPrevented能被页面handler检测到

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
