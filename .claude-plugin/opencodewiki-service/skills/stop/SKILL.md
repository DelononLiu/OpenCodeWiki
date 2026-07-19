---
name: stop
description: 停止项目的后端和前端服务（自动探测端口）
---
# 停止服务

自动探测端口，然后关闭对应的服务。

## 自动探测端口

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
FRONTEND_PORT=$(grep -oP "port:\s*\K\d+" "$ROOT/frontend/vite.config.ts" 2>/dev/null || echo "5173")
BACKEND_PORT=$(grep -oP "http://localhost:\K\d+" "$ROOT/frontend/vite.config.ts" 2>/dev/null || echo "8000")
```

## 执行

```bash
kill $(lsof -ti:$BACKEND_PORT) 2>/dev/null && echo "后端 (:${BACKEND_PORT}) 已停止" || echo "后端未运行"
kill $(lsof -ti:$FRONTEND_PORT) 2>/dev/null && echo "前端 (:${FRONTEND_PORT}) 已停止" || echo "前端未运行"
```
