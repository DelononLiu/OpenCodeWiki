---
name: start
description: 启动项目的后端和前端开发服务（自动探测端口）
---
# 启动开发服务

自动探测项目的后端端口和前端端口，然后启动服务。

## 自动探测逻辑

```bash
# 1. 找到项目根目录（git root）
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

# 2. 探测前端端口（从 vite.config.ts 读取）
FRONTEND_PORT=$(grep -oP "port:\s*\K\d+" "$ROOT/frontend/vite.config.ts" 2>/dev/null || echo "5173")

# 3. 探测后端端口（从 vite.config.ts proxy 读取）
BACKEND_PORT=$(grep -oP "http://localhost:\K\d+" "$ROOT/frontend/vite.config.ts" 2>/dev/null || echo "8000")

echo "前端端口: $FRONTEND_PORT"
echo "后端端口: $BACKEND_PORT"
```

## 执行步骤

1. **启动后端**：
   ```bash
   cd "$ROOT/backend"
   source .venv/bin/activate 2>/dev/null
   uvicorn main:app --port $BACKEND_PORT --reload &
   ```

2. **启动前端**：
   ```bash
   cd "$ROOT/frontend"
   npm run dev &
   ```

3. **验证**：
   ```bash
   sleep 3
   curl -s -o /dev/null -w "后端 (%{http_code})" http://localhost:$BACKEND_PORT/docs
   curl -s -o /dev/null -w "前端 (%{http_code})" http://localhost:$FRONTEND_PORT
   ```
