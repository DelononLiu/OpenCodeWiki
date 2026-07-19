# Task 3 Report: graph.py — parse sources from tool messages

**Status: Completed**

## Changes made to `backend/agent/graph.py`

1. **Added `import json`** (line 8) — needed for parsing tool message content.
2. **Added sources parsing block** after `all_msgs = final.get("messages", [])` (lines 129-163) — iterates over tool messages, extracting `file`, `line`, and `snippet` from the five code tool names (`code_search`, `code_context`, `code_grep`, `code_files`, `code_read_wiki`). Handles both list and dict JSON structures, with a 300-char snippet truncation.
3. **Added deduplication** (lines 156-163) — removes duplicate source entries by `(file, line)` key, producing `unique_sources`.
4. **Added `unique_sources = []`** (line 172) in the `except GraphRecursionError:` block — ensures the variable always exists even on the error path.
5. **Changed return** (line 174) from `return {"messages": all_msgs}` to `return {"messages": all_msgs, "sources": unique_sources}`.

## Verification

- `python3 -c "from agent.graph import get_graph; g = get_graph(); print('graph OK')"` — passed.
- Commit: `c780d1d` on branch `main`.

## Notes

- This change is a prerequisite for Task 4 (`main.py`), which will consume the `sources` key from `run_sub`'s return dict in `_qa_event_stream`.
