#!/bin/bash
# wiki-entity.sh — 生成/列出 wiki 实体
#
# 用法:
#   bash scripts/wiki-entity.sh generate <repo_dir> <概念名>
#   bash scripts/wiki-entity.sh list
#
# 示例:
#   bash scripts/wiki-entity.sh generate /home/long2015/Code/llama.cpp 批量推理
#   bash scripts/wiki-entity.sh generate /home/long2015/Code/OpenCodeWiki 问答引擎
#   bash scripts/wiki-entity.sh list

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENTITIES_DIR="$HOME/.opencodewiki/entities"
PY_DIR="$ROOT_DIR/src/python-agent"

cmd="$1"
shift || true

case "$cmd" in
  generate)
    repo_dir="$1"
    concept="$2"
    if [ -z "$repo_dir" ] || [ -z "$concept" ]; then
      echo "用法: $0 generate <repo_dir> <概念名>"
      echo "示例: $0 generate /home/long2015/Code/llama.cpp 批量推理"
      exit 1
    fi
    # 自动推导 project 名（去掉首 /，替换 / 为 -）
    project=$(echo "$repo_dir" | sed 's|^/||;s|/|-|g')
    # 实体写入 repo 的 .codegraph/wiki/entities/
    target_dir="$repo_dir/.codegraph/wiki/entities"
    mkdir -p "$target_dir"
    cd "$PY_DIR"
    source .venv/bin/activate
    python3 -c "
import json, sys, os
sys.path.insert(0, '.')
from wiki_entity_builder import generate_skeleton
result = generate_skeleton('$project', '$concept')
fp = os.path.join('$target_dir', result['slug'] + '.json')
with open(fp, 'w') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print(f'✅ {result[\"name\"]} → {fp}')
print(f'   定义: {result[\"definition\"]}')
print(f'   文件: {len(result[\"files\"])} 个, 关联: {len(result[\"relations\"])} 个')
"
    ;;
  list)
    if [ -d "$ENTITIES_DIR" ]; then
      echo "实体列表 ($ENTITIES_DIR):"
      for f in "$ENTITIES_DIR"/*.json; do
        name=$(python3 -c "import json; print(json.load(open('$f')).get('name','?'))" 2>/dev/null)
        slug=$(basename "$f" .json)
        echo "  $slug  ← $name"
      done
    else
      echo "(暂无实体)"
    fi
    ;;
  *)
    echo "用法: $0 {generate|list} [参数...]"
    exit 1
    ;;
esac
