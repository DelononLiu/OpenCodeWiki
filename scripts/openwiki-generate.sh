#!/bin/bash
# 生成本项目的 openwiki 中文文档
# 用法: bash scripts/openwiki-generate.sh
# 依赖: npm install -g openwiki

set -e

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

echo "📖 Step 1/2: 生成英文文档..."
echo "   目录: $PROJECT_DIR"
echo ""

openwiki "$PROJECT_DIR"

echo ""
echo "📖 Step 2/2: 翻译为中文..."
echo ""

cd backend && source .venv/bin/activate && python3 ../scripts/translate-wiki.py

echo ""
echo "✅ 中文文档已生成到 $PROJECT_DIR/openwiki/"
echo "   执行 git status 查看新增文件"