# 知识源管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 审核台新增文档上传入口，上传 md/txt/pdf 后解析文本纳入 wiki（不保留原始文件）。

**Architecture:** 后端 `POST /api/documents/upload` 接收文件、校验类型和大小、提取文本写入 `pages/uploaded/` 目录。`GET /api/search` 扩展搜索该目录。前端 AdminPage 左侧栏加"上传文档"按钮 + 上传对话框。

**Tech Stack:** Python 3.11+, FastAPI, React 18, TypeScript, Tailwind CSS 3

## Global Constraints

- 文件类型：`.md` `.txt` `.pdf`
- 最大大小：10MB
- 存储路径：`~/.opencodewiki/pages/uploaded/`
- 不保留原始文件，只存提取文本
- 中文 commit message

---

### Task 1: 后端 — POST /api/documents/upload + 搜索扩展

**Files:**
- Modify: `src/python-agent/main.py`

- [ ] **Step 1: 添加文档上传路由**

在 `src/python-agent/main.py` 中（settings 路由附近）添加：

```python
# ── Documents ──────────────────────────────────────────────────

UPLOAD_DIR = Path.home() / ".opencodewiki" / "pages" / "uploaded"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTENSIONS = {".md", ".txt", ".pdf"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


def _extract_text(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        try:
            import io
            from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            return "[PDF解析需要安装PyPDF2: pip install PyPDF2]"
        except Exception as e:
            return f"[PDF解析失败: {e}]"
    elif ext in (".md", ".txt"):
        return content.decode("utf-8", errors="replace")
    return ""


@app.post("/api/documents/upload")
async def api_document_upload(
    file: UploadFile = File(...),
    tags: str = Form(""),
):
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return _err(f"不支持的文件类型: {ext}，仅支持 {', '.join(ALLOWED_EXTENSIONS)}")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        return _err(f"文件过大，最大 10MB")

    text = _extract_text(filename, content)
    slug = Path(filename).stem

    tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    # 写入 markdown
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    header = f"---\nsource: upload\noriginal_filename: {filename}\ntags: {', '.join(tag_list)}\nuploaded_at: {now}\n---\n\n"
    md_path = UPLOAD_DIR / f"{slug}.md"
    md_path.write_text(header + text, encoding="utf-8")

    return _ok({
        "slug": slug,
        "title": slug,
        "page_type": "uploaded",
        "size": len(content),
        "tags": tag_list,
    })
```

> 注意：需要在 `main.py` 顶部添加 `from fastapi import File, UploadFile, Form`

- [ ] **Step 2: 扩展 GET /api/search 搜索 uploaded 目录**

在 `api_search()` 函数的 wiki 搜索部分后，追加：

```python
    # 也搜上传文档目录
    if UPLOAD_DIR.exists():
        for md_path in UPLOAD_DIR.rglob("*.md"):
            if len(wiki_results) >= 3:
                break
            try:
                content = md_path.read_text(encoding="utf-8")[:500]
                title = md_path.stem
            except Exception:
                continue
            if q.lower() in title.lower() or q.lower() in content.lower():
                wiki_results.append({
                    "slug": title,
                    "title": f"📤 {title}",
                    "snippet": content[:120],
                })
```

- [ ] **Step 3: 验证**

```bash
cd src/python-agent && python3 -c "from main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/python-agent/main.py
git commit -m "feat: POST /api/documents/upload + 搜索扩展上传文档

支持 md/txt/pdf 上传，解析文本纳入 wiki 搜索

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 前端 — AdminPage 上传对话框

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: 添加上传入口和对话框**

在 AdminPage 左侧栏"审核队列"下方添加"📤 上传文档"按钮：

```typescript
// In the sidebar, after the 4 queue items:

<li className="pt-2 border-t border-gray-100 mt-2">
  <button onClick={() => setShowUpload(true)}
    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition text-xs">
    📤 上传文档
  </button>
</li>
```

新增 state：
```typescript
const [showUpload, setShowUpload] = useState(false)
const [uploadFile, setUploadFile] = useState<File | null>(null)
const [uploadTags, setUploadTags] = useState('')
const [uploading, setUploading] = useState(false)
const [uploadResult, setUploadResult] = useState<string | null>(null)
```

上传对话框（在 `</main>` 前添加）：
```typescript
{showUpload && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowUpload(false)}>
    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">上传文档</h2>
        <button onClick={() => setShowUpload(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
      </div>

      <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
        <input type="file" accept=".md,.txt,.pdf" onChange={e => setUploadFile(e.target.files?.[0] || null)}
          className="text-sm" />
        <p className="text-[10px] text-gray-400 mt-2">支持 .md .txt .pdf，最大 10MB</p>
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">标签（逗号分隔，可选）</label>
        <input value={uploadTags} onChange={e => setUploadTags(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyber-blue/20"
          placeholder="architecture, design" />
      </div>

      {uploadResult && (
        <div className={`text-xs px-3 py-2 rounded-lg ${uploadResult.startsWith('✅') ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-50 text-red-600'}`}>
          {uploadResult}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={() => { setShowUpload(false); setUploadFile(null); setUploadTags(''); setUploadResult(null) }}
          className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
        <button onClick={async () => {
          if (!uploadFile) return
          setUploading(true); setUploadResult(null)
          try {
            const formData = new FormData()
            formData.append('file', uploadFile)
            formData.append('tags', uploadTags)
            const res = await fetch('/api/documents/upload', { method: 'POST', body: formData })
            const body = await res.json()
            if (body.ok) setUploadResult(`✅ 上传成功: ${body.data.slug}`)
            else setUploadResult(`❌ ${body.error}`)
          } catch (e: any) { setUploadResult(`❌ ${e.message}`) }
          setUploading(false)
        }} disabled={!uploadFile || uploading}
          className="px-4 py-2 text-xs bg-cyber-blue text-white rounded-lg hover:bg-cyber-blue-dark disabled:opacity-50">
          {uploading ? '上传中...' : '上传'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat: AdminPage 审核台文档上传对话框

支持 md/txt/pdf 上传，可选标签

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 上传入口在审核台：Task 2
- ✅ md/txt/pdf 校验 + 10MB 限制：Task 1
- ✅ 文本提取 + 写入 wiki：Task 1
- ✅ 搜索扩展：Task 1
- ✅ 标签可选：Task 2

**2. Placeholder scan:** 无

**3. Type consistency:** `UploadFile` 来自 FastAPI，前端 `FormData` 标准 API。
