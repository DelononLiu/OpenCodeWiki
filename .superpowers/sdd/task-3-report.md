# Task 3 Report: QAPage 自动保存 + HomePage 全局搜索

## Summary

Modified 2 frontend files to add auto-save on SSE done and backend-powered grouped search results.

## Changes

### QAPage.tsx
- Added `POST /api/qa/save` call in the `done` event handler (lines 82-95)
- Captures `lastUserMsg` from messages array, sends question/answer/repo/session_id/sources/mode
- On success, refreshes QA entries list via `fetchQaEntries({ limit: 100 })`

### HomePage.tsx
- Added `searchResults` state for backend search results (line 22)
- Replaced `handleSearchKeyDown` to call `GET /api/search?q=...&limit=5` (lines 54-71)
  - On successful backend results with items → sets `searchResults` + keeps suggest open
  - On no results or error → falls back to navigating to `/qa?q=...`
- Replaced suggest dropdown with two-mode display (lines 96-146)
  - **Backend results** (when `searchResults` is set): grouped by Wiki / Topic / QA sections
  - **Local fallback** (when `!searchResults`): original `filteredSuggest` for real-time typing feedback

### QAPage.tsx — stale closure fix (2026-07-18)
- Removed `lastUserMsg = messages[messages.length - 1]` in SSE `done` handler and replaced with local variable `q` (captured at function-call time on line 63)
- **Bug:** `messages` not in `useCallback` deps → stale closure → first question on fresh page sent empty string (400 error), subsequent questions sent previous text
- **Fix:** Use `q` (the `input.trim()` result) instead of `lastUserMsg?.content || ''`
- Commit `594e0b6`

## Verification
- `cd frontend && npx tsc --noEmit` — zero errors
