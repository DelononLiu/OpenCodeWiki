#!/usr/bin/env python3
"""
Bridge script: call CRG's generate_wiki() with a custom output directory.
Optionally enriches wiki pages with LLM-generated descriptions.

Usage:
    python3 scripts/crg-wiki.py <repo_path> <output_dir> [--force] [--skip-llm]

Outputs JSON to stdout:
    {"success": true, "generated": 5, "updated": 2, "unchanged": 1, "total": 8, "output_dir": "/path/to/.codegraph/wiki"}
    {"success": false, "error": "..."}

LLM config (priority: env var > ~/.opencodewiki/config.json):
    OPENAI_API_KEY / LLM_API_KEY
    LLM_BASE_URL (default: https://api.openai.com/v1)
    LLM_MODEL (default: gpt-4o-mini)
"""

import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path


# ── LLM config ─────────────────────────────────────────────

def load_opencodewiki_config():
    """Load ~/.opencodewiki/config.json if it exists."""
    cfg_path = Path.home() / '.opencodewiki' / 'config.json'
    try:
        with open(cfg_path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def get_llm_config():
    """Resolve LLM config with priority: env var > config file > defaults."""
    cfg = load_opencodewiki_config()
    api_key = (os.environ.get('OPENAI_API_KEY')
               or os.environ.get('LLM_API_KEY')
               or cfg.get('apiKey'))
    base_url = (os.environ.get('LLM_BASE_URL')
                or cfg.get('baseUrl')
                or 'https://api.openai.com/v1')
    model = (os.environ.get('LLM_MODEL')
             or cfg.get('model')
             or 'gpt-4o-mini')
    return api_key, base_url.rstrip('/'), model


def llm_chat(prompt: str, api_key: str, base_url: str, model: str) -> str | None:
    """Call OpenAI-compatible chat completions API. Returns content or None."""
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
    body = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.3,
    }).encode()

    req = urllib.request.Request(
        f'{base_url}/chat/completions',
        data=body, headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            return result['choices'][0]['message']['content'].strip()
    except Exception as exc:
        print(json.dumps({
            "success": False, "warning": f"LLM call failed: {exc}",
        }), flush=True)
        return None


# ── Community enrichment ────────────────────────────────────

LLM_DESCRIPTION_PROMPT = """You are analyzing a code community from a graph analysis of a codebase.

Community name: {name}
Size: {size} nodes, Cohesion: {cohesion:.4f}
Dominant language: {language}
Directory: {directory}

Key members (symbols in this community):
{members}

{flows_section}
{deps_section}

Write a concise architectural description (2-3 paragraphs) explaining:
1. What this module or component does in the overall codebase
2. Its key entry points and most important components
3. How it interacts with other parts of the system

Focus on architecture and purpose. Use a technical but readable style.
Do NOT just list the members again — synthesize what they collectively do.
If the community name hints at a role (e.g. "server-session" → session management),
explain that role concretely."""


def format_members_for_prompt(conn, qualified_names, limit=30):
    """Build a compact member table for the LLM prompt."""
    lines = []
    for qn in qualified_names[:limit]:
        row = conn.execute(
            'SELECT name, kind, file_path FROM nodes WHERE qualified_name=?',
            (qn,)
        ).fetchone()
        if row:
            name, kind, fp = row
            short_fp = '/'.join(fp.split('/')[-3:]) if fp else '?'
            lines.append(f"  {name:30s} {kind:12s} {short_fp}")
    if len(qualified_names) > limit:
        lines.append(f"  ... and {len(qualified_names) - limit} more symbols")
    return '\n'.join(lines) if lines else "  (none)"


def get_directory_hint(conn, qualified_names):
    """Derive the primary directory for a community from its members."""
    dirs = {}
    for qn in qualified_names:
        row = conn.execute(
            'SELECT file_path FROM nodes WHERE qualified_name=?', (qn,)
        ).fetchone()
        if row and row[0]:
            parts = Path(row[0]).parts
            # Take first meaningful directory segment
            for p in parts:
                if p not in ('src', 'home', '..', '.') and '/' not in p:
                    dirs.setdefault(p, 0)
                    dirs[p] += 1
                    break
    if dirs:
        return max(dirs, key=dirs.get)
    return ''


def enrich_communities_with_llm(store, api_key, base_url, model):
    """For each community, call LLM to generate a description, then UPDATE the DB."""
    from code_review_graph.communities import get_communities
    conn = store._conn  # raw SQLite connection for member queries

    communities = get_communities(store)
    if not communities:
        return

    print(json.dumps({
        "info": f"Enriching {len(communities)} communities with LLM...",
    }), flush=True)

    for comm in communities:
        cid = comm.get('id')
        name = comm.get('name', 'unnamed')
        size = comm.get('size', 0)

        # Skip if description already exists and seems meaningful
        existing_desc = (comm.get('description') or '').strip()
        if existing_desc and len(existing_desc) > 80 and 'Directory-based' not in existing_desc:
            continue

        members = comm.get('members', [])
        directory = get_directory_hint(conn, members)
        member_text = format_members_for_prompt(conn, members)

        # Get flows if available
        flows_section = ''
        try:
            from code_review_graph.flows import get_flows
            flows = get_flows(store, sort_by='criticality', limit=10)
            community_flows = [f for f in flows if
                               store.get_flow_qualified_names(f['id']) & set(members)]
            if community_flows:
                flow_lines = ['Execution flows through this community:']
                for f in community_flows[:5]:
                    flow_lines.append(f"  {f.get('name', '?')} (criticality: {f.get('criticality', 0):.2f})")
                flows_section = '\n'.join(flow_lines)
        except Exception:
            flows_section = ''

        # Get dependencies if available
        deps_section = ''
        try:
            if members:
                outgoing = store.get_outgoing_targets(list(members))
                incoming = store.get_incoming_sources(list(members))
                dep_lines = []
                if outgoing:
                    # Filter to meaningful targets (not builtins)
                    meaningful = [(t, c) for t, c in outgoing.most_common(10)
                                  if not t[0].islower()]  # skip lowercase (likely builtins)
                    if meaningful:
                        dep_lines.append('Key outgoing dependencies:')
                        for t, c in meaningful[:5]:
                            dep_lines.append(f"  {t} ({c} edge(s))")
                if incoming:
                    meaningful = [(s, c) for s, c in incoming.most_common(10)
                                  if not s[0].islower()]
                    if meaningful:
                        dep_lines.append('Key incoming dependencies:')
                        for s, c in meaningful[:5]:
                            dep_lines.append(f"  {s} ({c} edge(s))")
                deps_section = '\n'.join(dep_lines)
        except Exception:
            deps_section = ''

        prompt = LLM_DESCRIPTION_PROMPT.format(
            name=name,
            size=size,
            cohesion=comm.get('cohesion', 0.0),
            language=comm.get('dominant_language', 'unknown'),
            directory=directory,
            members=member_text,
            flows_section=flows_section,
            deps_section=deps_section,
        )

        description = llm_chat(prompt, api_key, base_url, model)
        if description and len(description) > 20:
            conn.execute('UPDATE communities SET description = ? WHERE id = ?', (description, cid))
            conn.commit()
            print(json.dumps({
                "info": f"  ✓ {name}: description updated ({len(description)} chars)",
            }), flush=True)
        else:
            print(json.dumps({
                "warning": f"  ✗ {name}: LLM returned empty description",
            }), flush=True)


# ── Main ────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: crg-wiki.py <repo_path> <output_dir> [--force] [--skip-llm]"}))
        sys.exit(1)

    repo_path = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()
    force = "--force" in sys.argv
    skip_llm = "--skip-llm" in sys.argv

    if not repo_path.is_dir():
        print(json.dumps({"success": False, "error": f"Repo path not found: {repo_path}"}))
        sys.exit(1)

    # CRG stores its data in .code-review-graph/
    crg_data_dir = repo_path / ".code-review-graph"
    crg_db = crg_data_dir / "graph.db"

    # Step 1: Build CRG index if it doesn't exist
    if not crg_db.is_file():
        print(json.dumps({"success": False, "error": "CRG index not found, building...", "needs_build": True}), flush=True)
        try:
            result = subprocess.run(
                ["code-review-graph", "build", "--repo", str(repo_path)],
                capture_output=True, text=True, timeout=600,
            )
            if result.returncode != 0:
                print(json.dumps({
                    "success": False,
                    "error": f"CRG build failed: {result.stderr.strip()}",
                    "stdout": result.stdout.strip(),
                }))
                sys.exit(1)
        except FileNotFoundError:
            print(json.dumps({
                "success": False,
                "error": "code-review-graph not found. Install: pip install code-review-graph",
            }))
            sys.exit(1)
        except subprocess.TimeoutExpired:
            print(json.dumps({"success": False, "error": "CRG build timed out (600s)"}))
            sys.exit(1)

    # Step 2: Verify the DB exists now
    if not crg_db.is_file():
        print(json.dumps({"success": False, "error": f"CRG database not found at {crg_db} after build"}))
        sys.exit(1)

    # Step 3: Import CRG
    try:
        from code_review_graph.graph import GraphStore
        from code_review_graph.wiki import generate_wiki
    except ImportError:
        print(json.dumps({
            "success": False,
            "error": "code_review_graph module not found. Install: pip install code-review-graph",
        }))
        sys.exit(1)

    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        store = GraphStore(crg_db)

        # Step 4: LLM enrichment (skip if --skip-llm or no API key)
        if not skip_llm:
            api_key, base_url, model = get_llm_config()
            if api_key:
                enrich_communities_with_llm(
                    store, api_key, base_url, model,
                )
            else:
                print(json.dumps({
                    "info": "No LLM config found (set OPENAI_API_KEY or ~/.opencodewiki/config.json). Skipping enrichment.",
                }), flush=True)

        # Step 5: Generate wiki
        result = generate_wiki(store, output_dir, force=force)
        total = result["pages_generated"] + result["pages_updated"] + result["pages_unchanged"]

        enriched = " with LLM enrichment" if (not skip_llm and get_llm_config()[0]) else ""
        print(json.dumps({
            "success": True,
            "generated": result["pages_generated"],
            "updated": result["pages_updated"],
            "unchanged": result["pages_unchanged"],
            "total": total,
            "output_dir": str(output_dir),
            "enriched": not skip_llm and bool(get_llm_config()[0]),
        }))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
