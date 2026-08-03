#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "OpenCodeWiki 启动"

# 启动后端（backend.main 以包方式导入，须从仓库根目录启动，且使用 venv 内 python）
echo "[1/2] 启动后端 (FastAPI :8100)..."
cd "$ROOT_DIR"
"$ROOT_DIR/backend/.venv/bin/python" -m uvicorn backend.main:app --host 0.0.0.0 --port 8100 --reload --reload-dir backend &
BACKEND_PID=$!

# 启动前端 dev server
echo "[2/2] 启动前端 (Vite :5180)..."
cd "$ROOT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "后端: http://localhost:8100"
echo "前端: http://localhost:5180"
echo ""

# Ctrl+C 或终端关闭时自动清理两个服务
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
