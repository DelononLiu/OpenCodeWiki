#!/usr/bin/env bash
set -e

cleanup() {
  echo ""
  echo "  Stopping..."
  kill $BACKEND_PID 2>/dev/null
  wait $BACKEND_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "  Starting Taskit..."
echo ""

# 启动后端
cd backend
npx tsx src/index.ts &
BACKEND_PID=$!
cd ..

# 启动前端
npx vite &
FRONTEND_PID=$!

echo "  Backend  → http://localhost:8000"
echo "  Frontend → http://localhost:5173"
echo "  Ctrl+C to stop"

wait $FRONTEND_PID
