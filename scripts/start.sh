#!/bin/bash
# OpenCodeWiki 启动脚本
# 自动设置环境变量，无需手动 export

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── 环境变量配置 ──────────────────────────────────────────────

# 嵌入引擎: hash | local | ollama | api
export EMBED_ENGINE="${EMBED_ENGINE:-local}"

# sharp 的 libvips 路径
SHARP_VENDOR="$ROOT_DIR/node_modules/sharp/vendor/8.14.5/lib"
if [ -d "$SHARP_VENDOR" ]; then
  export LD_LIBRARY_PATH="$SHARP_VENDOR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Ollama（如使用）
export OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
export OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"

# ── 启动 ──────────────────────────────────────────────────────

echo "OpenCodeWiki"
echo "  嵌入引擎: $EMBED_ENGINE"
echo "  工作目录: $ROOT_DIR"
echo ""

cd "$ROOT_DIR"

# Check for --watch flag (stripped from $@ before passing to tsx)
WATCH=""
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--watch" ]; then
    WATCH="watch"
  else
    ARGS+=("$arg")
  fi
done

if [ "$WATCH" = "watch" ]; then
  echo "  监听模式：代码变更自动重启"
  exec npx tsx watch src/server/codegraph-bridge.ts "${ARGS[@]}"
else
  exec npx tsx src/server/codegraph-bridge.ts "${ARGS[@]}"
fi
