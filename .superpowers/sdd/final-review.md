# Final Whole-Branch Code Quality Review

**Branch:** `main` (10 commits: f3c827d..cc62546)
**Review Scope:** 5 sub-plans of UI global upgrade (promote->publish rename, Header/HomePage, Wiki subsystem, QA subsystem, Admin subsystem)
**Spec:** `docs/superpowers/specs/2026-07-18-topic-page-sidebar-design.md`

---

## Overall Verdict: **Needs fixes** (3 high, 3 medium, 3 low)

The branch delivers the core structural changes described in the spec -- unified header, three-column WikiPage, QA sidebar, Admin audit workbench, and the promote->publish rename. However, there are two spec gaps (missing Admin queues, missing permission gating) and one regression (removed empty-state fallback on WikiPage) that should be addressed before merging.

---

## Severity-Ranked Findings

### HIGH

**H1. AdminPage spec gaps: only 2 of 4 audit queues implemented (spec, p. 6)**
The spec defines four queues (QA Calibration, Topic Suggestions, Wiki Changes, Repo Submissions) with badge counts. The implementation only has two (QA, Topic). The "Wiki Changes" and "Repo Submissions" queues listed in the spec sidebar are absent. Additionally, the spec says "**普通成员只能查看，按钮置灰**" -- the current implementation does not gate the "calibrate" or "publish" buttons behind the admin check (the `Header` has `isAdmin` logic but `AdminPage` does not apply it to any action buttons).

*File: `frontend/src/pages/AdminPage.tsx`*
*Fix: Add the missing Wiki Changes + Repo Submissions queue items (even as placeholders with zero badges). Add `isAdmin` boolean (derive from same `ADMIN_USERS` list used in Header) and apply `disabled` to calibrate/publish buttons for non-admins.*

**H2. WikiPage empty-state fallback removed (regression)**
The old code rendered a `<div>...选择左侧文档开始阅读</div>` fallback when `renderedHtml` was empty. The new code wraps the article in `{renderedHtml && (...)}` instead of the ternary `{renderedHtml ? (...) : (fallback)}`. When a slug that doesn't exist is loaded, or when `loadContent` fails, the user sees a blank white area with no guidance.

*File: `frontend/src/pages/WikiPage.tsx`, lines 94-107*
*Fix: Add an else-branch: `{renderedHtml ? (...) : (<div className="text-center text-gray-400 py-20">未找到该文档，请从左侧选择</div>)}`*

**H3. AdminPage missing preview mode removed (regression)**
The old AdminPage had a "Preview wiki effect" toggle (`previewMode`) that let the admin see a rendered preview of the draft markdown before publishing. The new implementation removed this entirely (the `previewMode` state, toggle button, and preview `<div>` are all gone). This is a power-user feature used during the review workflow.

*File: `frontend/src/pages/AdminPage.tsx`*
*Fix: Restore the preview toggle. Add `const [previewMode, setPreviewMode] = useState(false)` and render the preview `<div>` when enabled.*

---

### MEDIUM

**M1. TypeScript `as any` casts in AdminPage (known finding, unresolved)**
`fetchTopic(slug) as any` at line 39 and `(selectedTopic as any).qa_entries` at line 109 bypass type checking. The `Topic` interface does not include `qa_entries`, but the Python backend returns it. The correct fix would be to add `qa_entries` to the `Topic` interface (or use a `TopicDetail` interface).

*File: `frontend/src/pages/AdminPage.tsx` lines 39, 109*

**M2. QAPage spec divergence: missing `#topic` display in sidebar entries**
The spec shows each sidebar entry as `title + #qid + #topic` (e.g., `#103 #concurrency`). The implementation only shows the title and `#qid`. Topic tags are not rendered, reducing the usefulness of the QA sidebar for topic-aware browsing.

*File: `frontend/src/pages/QAPage.tsx`, lines 120-128*
*Fix: Add `{qa.tags?.map(t => <span className="text-[9px] text-gray-400">#{t}</span>)}` next to the `#qid` label.*

**M3. HomePage `draftQa` variable name is misleading (known finding)**
The variable is named `draftQa` but fetches `{ sort: 'latest' }` (line 26). It has not held "draft/pending" QA since subplan-2. Misleading naming harms readability.

*File: `frontend/src/pages/HomePage.tsx`, lines 18, 26*
*Fix: Rename to `latestQa`.*

---

### LOW

**L1. Dead code: LeftSidebar `pageType='qa'` and `pageType='admin'` branches**
QAPage and AdminPage no longer use `LeftSidebar` -- they have their own inline sidebars. The `LeftSidebar` component still contains unreachable `pageType === 'qa'` (lines 77-105) and `pageType === 'admin'` (lines 107-128) branches. These are dead code.

*File: `frontend/src/components/layout/LeftSidebar.tsx`*
*Suggestion: Remove the unreachable branches, or keep as dead code pending future reuse.*

**L2. Dead code: `fetchQaPending` in client.ts**
The old AdminPage imported `fetchQaPending`. The new code uses `fetchQaEntries({ status: 'pending', ... })` instead. The `fetchQaPending` export in `client.ts` (line 38-41) is no longer imported anywhere.

*File: `frontend/src/api/client.ts` lines 38-41*
*Suggestion: Remove the unused export.*

**L3. HomePage search pool has hardcoded document entry (known finding)**
The hardcoded entry `'📖 物理文档: 双路分流路由算法系统'` with key `'02-qa-engine'` is a demo placeholder. This is acceptable for now but should be replaced with a live `fetchWikiModules()` or similar API call.

*File: `frontend/src/pages/HomePage.tsx` line 32*

---

## Verified Fixes

| Finding | Status | Evidence |
|---------|--------|----------|
| QAPage SSE stale closure | **VERIFIED FIXED** | commit cc62546: `streamingRef` useRef introduced, `done` handler reads from `streamingRef.current` instead of closure-captured `currentAnswer`. Correct pattern. |
| SQL column alignment (database.py) | **VERIFIED** | `published_at TEXT DEFAULT NULL` on line 140, aligned with other columns. No trailing comma or indentation issues. |
| promote->publish rename completeness | **VERIFIED** | No occurrences of `promote`/`promoted`/`promoting` found in any file. All layers covered: DB CHECK constraint, column name, Python function names, API route, TypeScript types, client.ts, AdminPage, LeftSidebar, tests, UI labels. |
| Header `activeSection` prop removal | **VERIFIED** | Removed from `HeaderProps` interface (commit 89f6648). All callers (`<Header variant="global" />`) updated -- no `activeSection` passed. |
| Route order `/wiki` before `/:repo` | **VERIFIED** | App.tsx line 13: `/wiki` registered before `/:repo` on line 14. React Router v6 matches static paths first. |
| WikiPage prose class simplification | **VERIFIED** | Long prose class trimmed (removed h3 margin, p margins, ul/ol styling, hr, img styles). Acceptable simplification per plan. |

---

## Regressions Detected

1. **WikiPage empty-state fallback** (H2 above) -- user sees blank area for invalid slugs
2. **AdminPage preview mode** (H3 above) -- admin cannot preview draft before publish
3. **Admin "Analyze QA Pool" button removed** -- the old `handleAnalyze` function and its button were deleted. This was not mentioned in the spec or plans. If intentional, it is a power-user feature loss.

---

## Strengths

1. **Consistent visual design language** -- all pages share the same background (`#F8F9FA`), card style (white, border, rounded-xl), sidebar pattern (border-r, `#FBFBFC`), and typography (mono for code, uppercase tracking for section headers).

2. **Thorough promote->publish rename** -- spans all layers: SQL schema, Python store_topics, FastAPI routes, TypeScript types, API client, two page components, test assertions. No residual old terms found.

3. **Clean component decomposition** -- WikiRightSidebar (TOC) and TopicRightSidebar (related content) are well-factored, single-responsibility components with clear interfaces.

4. **SSE stale closure fix is robust** -- uses `useRef` (not `useState`) to accumulate streaming tokens, decoupling the streaming callback from React re-render cycles. The `handleSend` dependency array correctly omits `currentAnswer`.

5. **Good use of React performance patterns** -- `useMemo` for filtered/grouped QA entries, domain list, search suggestions, and rendered HTML. `useCallback` for loadContent and handleSend.

6. **Correct route registration** -- `/wiki` before `/:repo` in App.tsx, preventing the catch-all `:repo` param from matching "wiki" as a repo name.
