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
  idMap: {
    typeBar: string;
    moreBtn: string;
    moreDropdown: string;
    attachBtn: string;
    fileInput: string;
    sendBtn: string;
    qaInput: string;
    typeInput?: string;     // hidden input for type (wiki: wikiQaType)
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

  return `
<div class="qa-input-wrap">
  <div class="file-chips" id="fileChips" style="display:none;flex-wrap:wrap;gap:4px;padding:0 0 4px 0;max-height:60px;overflow-y:auto"></div>
  ${inputTag}
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
      <div class="type-bar" id="${cfg.idMap.typeBar}">
        <button class="type-chip" data-type="log-analysis">日志分析</button>
        <button class="type-chip" data-type="stack-analysis">堆栈分析</button>
        <button class="type-chip" data-type="static-analysis">静态分析</button>
        <span class="more-wrapper">
          <button class="type-chip" id="${cfg.idMap.moreBtn}" data-type="">更多&#9660;</button>
          <div class="more-dropdown" id="${cfg.idMap.moreDropdown}">
            <button class="type-chip" data-type="build">编译构建</button>
            <button class="type-chip" data-type="program-analysis">程序分析</button>
          </div>
        </span>
      </div>
      <button type="submit" id="${cfg.idMap.sendBtn}">Ask</button>
    </div>
  </form>
</div>`.trim();
}

export function qaInputInitScript(cfg: QaInputConfig): string {
  return `
// ── QA Input: type bar init ──
(function(){
  var ST = null;
  var moreBtn = document.getElementById('${cfg.idMap.moreBtn}');
  var moreDd = document.getElementById('${cfg.idMap.moreDropdown}');
  document.querySelectorAll('#${cfg.idMap.typeBar} .type-chip').forEach(function(btn){
    btn.addEventListener('click', function(){
      var type = this.dataset.type;
      if(this.id === '${cfg.idMap.moreBtn}'){ moreDd.classList.toggle('open'); return; }
      moreDd.classList.remove('open');
      if(ST === type){ ST = null;
        document.querySelectorAll('#${cfg.idMap.typeBar} .type-chip').forEach(function(b){ b.classList.remove('active'); });
      }else{ ST = type;
        document.querySelectorAll('#${cfg.idMap.typeBar} .type-chip').forEach(function(b){ b.classList.toggle('active', b.dataset.type === type); });
      }
    });
  });
  document.addEventListener('click', function(e){
    if(moreDd.classList.contains('open') && !e.target.closest('.more-wrapper')) moreDd.classList.remove('open');
  });
  // Restore from URL param
  var _qt = new URLSearchParams(location.search).get('type');
  if(_qt){
    ST = _qt;
    document.querySelectorAll('#${cfg.idMap.typeBar} .type-chip').forEach(function(b){
      if(b.dataset.type === _qt) b.classList.add('active');
    });
  }
  // Expose selectedType for page-specific send functions
  window.__qaSelectedType = function(){ return ST; };
})();
`.trim();
}
