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
    shift 2 2>/dev/null
    if [ -z "$repo_dir" ]; then
      echo "用法: $0 generate <repo_dir> [概念名...]"
      echo "示例: $0 generate /home/long2015/Code/llama.cpp                  # 全生成"
      echo "      $0 generate /home/long2015/Code/llama.cpp 批量推理 量化    # 指定"
      exit 1
    fi
    project=$(echo "$repo_dir" | sed 's|^/||;s|/|-|g')
    target_dir="$repo_dir/.codegraph/wiki/entities"
    mkdir -p "$target_dir"

    # 默认实体列表（按仓库匹配）
    concepts=("$@")
    if [ ${#concepts[@]} -eq 0 ]; then
      case "$repo_dir" in
        *llama*)   concepts=("批量推理" "推理引擎" "量化方案" "KV Cache" "Tokenizer 处理" "模型加载") ;;
        *kcode*)   concepts=("任务流" "插件系统" "ACP 协议" "WebView 渲染" "设备管理") ;;
        *OpenCodeWiki*) concepts=("问答引擎" "Wiki 系统" "评测框架" "Agent 路由" "源码引用解析") ;;
        *)         echo "未知仓库，请指定概念名"; exit 1 ;;
      esac
      echo "将生成 ${#concepts[@]} 个实体: ${concepts[*]}"
    fi

    cd "$PY_DIR"
    source .venv/bin/activate
    for concept in "${concepts[@]}"; do
      python3 -c "
import json, sys, os
sys.path.insert(0, '.')
from wiki_entity_builder import generate_skeleton
result = generate_skeleton('$project', '$concept')
fp = os.path.join('$target_dir', result['slug'] + '.json')
with open(fp, 'w') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print(f'✅ {result[\"name\"]} → {result[\"slug\"]}.json  ({result[\"definition\"]})')
"
    done
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
