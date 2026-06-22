"""
重新嵌入 3 个评测仓库的向量，使用 Python sentence-transformers。

用法:
  python3 scripts/eval/reembed-vectors.py

流程:
  1. 从 codebase-memory-mcp DB 读取节点（Function/Method/Class/...）
  2. 用 all-MiniLM-L6-v2 生成 384 维嵌入
  3. 写入 ~/.opencodewiki/vectors/<short-name>.vec.db

注意:
  - 需要网络下载模型（仅首次）
  - 写入的 node_id 为 INTEGER，与 codebase-memory-mcp 一致
  - 会覆盖已有向量库
"""
import sqlite3
import json
import datetime
from pathlib import Path

from sentence_transformers import SentenceTransformer

# ── 配置 ──────────────────────────────────────────────────────────
REPOS = [
    ("home-long2015-Code-codegraph", "codegraph"),
    ("home-long2015-Code-kcode", "kcode"),
    ("home-long2015-Code-OpenCodeWiki", "OpenCodeWiki"),
]

# codebase-memory-mcp 的 label 首字母大写
LABEL_FILTER = (
    "'Function','Method','Class','Interface','Struct','Enum','TypeAlias','Module','Constant','Variable'"
)

CBM_DIR = Path.home() / ".cache" / "codebase-memory-mcp"
VEC_DIR = Path.home() / ".opencodewiki" / "vectors"
VEC_DIR.mkdir(parents=True, exist_ok=True)

# ── 主流程 ────────────────────────────────────────────────────────
print("Loading all-MiniLM-L6-v2...")
model = SentenceTransformer("all-MiniLM-L6-v2", device="cpu")

for proj_name, short_name in REPOS:
    cbm_path = CBM_DIR / f"{proj_name}.db"
    if not cbm_path.exists():
        print(f"SKIP {short_name}: CBM DB not found at {cbm_path}")
        continue

    # 1. 读取节点
    conn = sqlite3.connect(str(cbm_path))
    sql = f"""
        SELECT id, name, qualified_name
        FROM nodes
        WHERE label IN ({LABEL_FILTER})
        ORDER BY label
    """
    rows = conn.execute(sql).fetchall()
    conn.close()
    print(f"{short_name}: {len(rows)} nodes to embed")

    # 2. 生成嵌入
    texts = [f"{r[1]}\n{r[2]}" for r in rows]
    embeddings = model.encode(texts, show_progress_bar=True, normalize_embeddings=True)

    # 3. 写入向量库（短名，与 runner.mjs q.repo 匹配）
    vec_path = VEC_DIR / f"{short_name}.vec.db"
    if vec_path.exists():
        vec_path.unlink()

    vdb = sqlite3.connect(str(vec_path))
    vdb.execute("PRAGMA journal_mode=WAL")
    vdb.execute("CREATE TABLE vectors (node_id INTEGER PRIMARY KEY, embedding TEXT NOT NULL)")
    vdb.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")

    data = [(int(rows[i][0]), json.dumps(embeddings[i].tolist())) for i in range(len(rows))]
    vdb.executemany("INSERT INTO vectors(node_id, embedding) VALUES (?, ?)", data)

    vdb.execute("INSERT INTO meta(key, value) VALUES (?, ?)", ("engine", "local"))
    vdb.execute("INSERT INTO meta(key, value) VALUES (?, ?)", ("dimension", "384"))
    vdb.execute("INSERT INTO meta(key, value) VALUES (?, ?)", ("node_count", str(len(rows))))
    vdb.execute("INSERT INTO meta(key, value) VALUES (?, ?)", (
        "indexed_at", datetime.datetime.now().isoformat()
    ))
    vdb.commit()
    vdb.close()
    print(f"{short_name}: done, {len(rows)} vectors → {vec_path}")
