# Joint Review: Sub-plan 4 (QA Subsystem) and Sub-plan 5 (Admin Subsystem)

**Reviewer:** Automated code review
**Date:** 2026-07-18
**Scope:** Plan docs, implementation diff (`2acbe5d..1fccdba`), task reports, and actual source files in `frontend/src/pages/`

---

## Sub-plan 4 Verdict: NEEDS SIGNIFICANT FIX

**Status:** Structure and UI fully implemented as spec'd, but a functional bug in the SSE streaming flow breaks message history persistence.

### Checklist

| # | Requirement | Status | Notes |
|---|------------|--------|-------|
| 1 | Left sidebar `w-72` | PASS | `<aside className="w-72 ...">` (QAPage.tsx:93) |
| 2 | Time-grouped QA entries (今天/三天内/本周/本月/更早) | PASS | `useMemo` grouping logic (QAPage.tsx:41-54) |
| 3 | Domain filter tags | PASS | Filter buttons rendered from domain set (QAPage.tsx:56-59, 102-108) |
| 4 | Search box in sidebar | PASS | Input with Search icon (QAPage.tsx:94-100) |
| 5 | Each row: title + #qid (small gray) | PASS | `#qa.qid` with `text-[10px] text-gray-400 font-mono` (QAPage.tsx:120) |
| 6 | No status labels on QA rows | PASS | Confirmed absent |
| 7 | "新建提问" button at sidebar bottom | PASS | `<Button variant="outline">` with `Plus` icon (QAPage.tsx:130-134) |
| 8 | Detail view on QA click | PASS | `viewMode === 'detail'` branch renders question + answer (QAPage.tsx:139-149) |
| 9 | Ask UI with SSE streaming | PASS | `useSSE()` hook, token/error/done handling (QAPage.tsx:61-76) |
| 10 | Empty state text | PASS | "暂无 QA 记录，从首页或 Wiki 页底部提问开始" (QAPage.tsx:126-128) |

### Finding BUG-1 (SEVERITY: CRITICAL) — Stale closure in SSE done handler breaks message history

**File:** `frontend/src/pages/QAPage.tsx`, line 72
**Plan doc:** `docs/superpowers/plans/2026-07-18-subplan-4-qa-subsystem.md`, line 104

Both the plan and the implementation contain the same defect:

```typescript
else if (msg.type === 'done') {
  setMessages(prev => [...prev, { role: 'assistant', content: currentAnswer }])
  setCurrentAnswer('')
}
```

`currentAnswer` is captured in the closure at the time `handleSend` is called. When SSE tokens arrive, `setCurrentAnswer(prev => prev + token)` updates React state, but the `onMessage` callback's closure still holds the original empty string. When the `done` event fires, `currentAnswer` is still `''`, so `setMessages` adds an empty assistant message. The accumulated answer is never persisted to the message history, causing it to disappear from the UI after streaming completes.

**Impact:** Users can see the answer stream in real-time, but it disappears once streaming finishes. The chat history cannot display assistant responses. This effectively breaks the core feature of the QA page's ask mode.

**Fix:** Use a `useRef` to accumulate the answer alongside the state, or restructure the `done` handler to read the accumulated value from a ref rather than from the closure:

```typescript
const answerRef = useRef('')
// In token handler:
answerRef.current += msg.content as string
setCurrentAnswer(answerRef.current)
// In done handler:
setMessages(prev => [...prev, { role: 'assistant', content: answerRef.current }])
answerRef.current = ''
setCurrentAnswer('')
```

### Finding PLAN-1 (SEVERITY: LOW) — `activeSection` prop specified in plan but Header component does not support it

**Plan doc:** Line 122: `<Header variant="global" activeSection="qa" />`
**HeaderProps interface** (Header.tsx:8-11): Only `variant` and `repoName` exist.

The implementation correctly omits `activeSection`. This is a minor plan spec inaccuracy. The task 4 report notes this was also fixed in AdminPage.

---

## Sub-plan 5 Verdict: APPROVED WITH MINOR FIXES

**Status:** All structural and UI requirements implemented correctly. Minor TypeScript and edge-case issues.

### Checklist

| # | Requirement | Status | Notes |
|---|------------|--------|-------|
| 1 | Left sidebar `w-56` | PASS | `<aside className="w-56 ...">` (AdminPage.tsx:68) |
| 2 | 审核队列 with QA校准 + Topic建议 | PASS | Two sidebar nav items with badge counts (AdminPage.tsx:71-94) |
| 3 | Badge counts | PASS | `pendingCounts.qa` and `pendingCounts.topic` (AdminPage.tsx:81, 90) |
| 4 | Tab switching between qa/topic views | PASS | `currentView` state toggles main content (AdminPage.tsx:18, 99-187) |
| 5 | QA calibration list with textarea + 校准 button | PASS | Calibration UI with textarea and actions (AdminPage.tsx:145-170) |
| 6 | Topic detail panel: 2-column (raw QA | refined draft) | PASS | `grid grid-cols-2` layout (AdminPage.tsx:105-122) |
| 7 | Module selector | PASS | `<select>` with modules mapped to options (AdminPage.tsx:128-131) |
| 8 | 沉淀为Wiki button | PASS | Button with `ArrowUpCircle` icon and Chinese text (AdminPage.tsx:138-142) |
| 9 | Uses `publishTopic`/`publishResult`/`publishing` naming | PASS | Consistent naming (AdminPage.tsx:20-21, 48-61, 91-96) |

### Finding ADM-1 (SEVERITY: MEDIUM) — TypeScript safety bypassed with `as any`

**File:** `frontend/src/pages/AdminPage.tsx`, lines 39 and 109

```typescript
const topic = await fetchTopic(slug) as any
// ...
{(selectedTopic as any).qa_entries?.map((qa: any) => (
```

The `Topic` interface (types/index.ts:21-30) does not include `qa_entries`. The backend returns this field but the frontend type is incorrect. The `as any` casts bypass compile-time checks entirely.

**Impact:** Any future changes to the backend response schema will not be caught by TypeScript. This masks a type mismatch between frontend and backend.

**Fix:** Either add `qa_entries?: { qid: number; question: string; created_at: string }[]` to the `Topic` interface, or create a separate interface for the topic detail response. Remove `as any` casts.

### Finding ADM-2 (SEVERITY: LOW) — Plan spec for `fetchTopics` doesn't match API client

**Plan doc:** Line 54: `fetchTopics({ status: 'pool' })`
**API client** (client.ts:68-70): `fetchTopics()` takes no parameters.

The implementation correctly does client-side filtering (`fetchTopics().then(d => d.filter(t => t.status === 'pool'))`). This works but is less efficient than server-side filtering. The plan incorrectly assumes `fetchTopics` accepts a filter parameter.

### Finding ADM-3 (SEVERITY: LOW) — Module selector may have no default selection

**File:** `frontend/src/pages/AdminPage.tsx`, line 44

```typescript
if (modules.length > 0 && !selectedModule) setSelectedModule(modules[0].slug)
```

`modules` is loaded asynchronously (`fetchWikiModules().then(setModules)`). If the user opens a topic detail before modules finish loading, `selectedModule` remains `''` and the select shows no selected option until a manual choice is made. The module selector no longer has an empty placeholder option (`<option value="">-- 选择模块 --</option>`) that existed in the previous version, so an empty value will select the first option textually but the `value` binding won't match.

---

## Cross-Cutting Findings

### Finding GLOBAL-1 (SEVERITY: MEDIUM) — Missing shadcn/ui Input and Select components

**Files:** QAPage.tsx (lines 97-99, 180-183), AdminPage.tsx (lines 128-131, 148-150, 183-185)

The plan specifies "shadcn/ui + Tailwind, no custom CSS." However, both pages use raw HTML `<input>`, `<select>`, `<textarea>`, and `<button>` elements directly instead of shadcn `Input`, `Select`, `Textarea`, or the existing `Button` component. The project only defines `Button` and `Card` shadcn components. While there is no custom CSS (the only addition is `.no-scrollbar`), the absence of standard shadcn form components means styling is inconsistent and not centralized.

### Finding GLOBAL-2 (SEVERITY: LOW) — Hardcoded colors bypass Tailwind theme tokens

**Files:** QAPage.tsx (line 89), AdminPage.tsx (line 64)

Both pages use `bg-[#F8F9FA]` and `bg-[#FBFBFC]` as arbitrary values. The Tailwind config defines `cyber-bg: '#F8F9FA'` and `cyber-card: '#FFFFFF'`, but `#FBFBFC` has no token. Using hardcoded hex values makes future theme changes more difficult.

### Finding GLOBAL-3 (SEVERITY: LOW) — Minimal test coverage

**File:** `tests/api.test.ts` — 4 basic tests for URL construction and type shapes only.

Neither QAPage nor AdminPage has any component tests. The SSE hook (`useSSE.ts`) has no tests. The stale closure bug in QAPage would have been caught by even a basic rendering test that exercises the send-then-done flow.

---

## Strengths

1. **Faithful implementation of plan specs.** Both sub-plans are implemented closely to their design documents. The UI structure (sidebar widths, grouping logic, button placement, layout) matches the plan exactly.

2. **Clean component architecture.** QAPage and AdminPage are self-contained with inline sidebars, removing dependency on the shared `LeftSidebar` component. This simplifies the component hierarchy.

3. **Good React patterns.** Proper use of `useMemo` for derived data (filtering, grouping, domain extraction), `useCallback` for handlers, and functional updates in `setState` calls. The SSE hook is well-isolated and reusable.

4. **Consistent Chinese copy.** All UI text uses consistent Chinese terminology ("校准", "沉淀", "审核队列", "新建提问"), matching the global constraint.

5. **Clean diff from the old implementation.** The rewrite removes unused states (`analyzing`, `previewMode`, `topicQaEntries`), unused imports (`LeftSidebar`, `Sparkles`, `FileText`), and redundant code paths. The new code is ~50 lines shorter while adding more functionality.

6. **Proper error handling.** All API calls use `.catch(() => {})` to prevent unhandled promise rejections. The SSE hook handles `AbortError` gracefully.

---

## Summary

| Aspect | Verdict |
|--------|---------|
| **Sub-plan 4 (QAPage)** | Needs significant fix — UI structure is correct but the stale closure bug (CRITICAL) breaks the core SSE streaming feature |
| **Sub-plan 5 (AdminPage)** | Approved with minor fixes — TypeScript `as any` casts and a module selector edge case should be addressed |
| **Overall** | The implementation faithfully follows the plan designs. One critical bug (stale closure in SSE done handler) affects sub-plan 4 and must be fixed before the feature is usable. Sub-plan 5 is functionally sound with minor quality issues. |

**Recommended actions (ordered by priority):**

1. Fix BUG-1 (CRITICAL): Refactor QAPage SSE done handler to use a ref for answer accumulation
2. Fix ADM-1 (MEDIUM): Add `qa_entries` to the `Topic` interface and remove `as any` casts
3. Fix GLOBAL-1 (MEDIUM): Add missing shadcn Input/Select/Textarea components and migrate usage
4. Fix GLOBAL-3 (LOW): Add component tests for QAPage and AdminPage, and unit tests for useSSE
5. Fix ADM-2, ADM-3, GLOBAL-2, PLAN-1 (LOW): Minor alignment and quality issues
