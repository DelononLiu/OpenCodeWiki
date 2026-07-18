#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "OpenCodeWiki 启动"

# 启动后端
echo "[1/2] 启动后端 (FastAPI :8000)..."
cd "$ROOT_DIR/backend"
source .venv/bin/activate 2>/dev/null || true
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# 启动前端 dev server
echo "[2/2] 启动前端 (Vite :5173)..."
cd "$ROOT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "后端: http://localhost:8000"
echo "前端: http://localhost:5173"
echo ""
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
