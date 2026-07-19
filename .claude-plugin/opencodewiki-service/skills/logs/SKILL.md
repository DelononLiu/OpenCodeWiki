---
name: logs
description: 查看项目的后端和前端服务状态（自动探测端口）
---
# 查看服务状态

自动探测端口，显示服务的运行状态。

## 执行

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
FRONTEND_PORT=$(grep -oP "port:\s*\K\d+" "$ROOT/frontend/vite.config.ts" 2>/dev/null || echo "5173")
BACKEND_PORT=$(grep -oP "http://localhost:\K\d+" "$ROOT/frontend/vite.config.ts" 2>/dev/null || echo "8000")

echo "=== 服务状态 ==="
echo "后端 (:${BACKEND_PORT}): $(curl -s -o /dev/null -w '%{http_code}' http://localhost:$BACKEND_PORT/docs || echo '未运行')"
echo "前端 (:${FRONTEND_PORT}): $(curl -s -o /dev/null -w '%{http_code}' http://localhost:$FRONTEND_PORT || echo '未运行')"
echo ""
echo "=== 进程 ==="
ps aux | grep -E "uvicorn main|vite" | grep -v grep || echo "(无相关进程)"
```
