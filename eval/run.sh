#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== OpenCodeWiki QA Eval ==="

# 安装依赖
pip install -q -r "$SCRIPT_DIR/requirements.txt" 2>/dev/null || true

# 确保 backend 可启动
echo "Verifying backend..."
cd "$ROOT_DIR/backend"
python3 -c "from main import app; print('Backend OK')" || { echo "Backend broken"; exit 1; }

# 跑 fast API smoke tests
echo ""
echo "[1/2] API smoke tests..."
cd "$SCRIPT_DIR"
python3 -m pytest test_qa.py -v -m "not slow" --tb=short

# 跑 QA 质量测试（需要 backend 启动）
echo ""
echo "[2/2] QA quality tests (requires backend)..."
python3 -m pytest test_qa.py -v -m "slow" --tb=short

echo ""
echo "Done. Results in eval/results/"
