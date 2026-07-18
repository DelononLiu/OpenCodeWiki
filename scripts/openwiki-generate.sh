#!/bin/bash
# 生成本项目的 openwiki 中文文档
# 用法: bash scripts/openwiki-generate.sh
# 依赖: npm install -g openwiki

set -e

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

echo "📖 正在为 OpenCodeWiki 生成中文文档..."
echo "   目录: $PROJECT_DIR"
echo ""

openwiki "$PROJECT_DIR"

echo ""
echo "✅ 文档已生成到 $PROJECT_DIR/openwiki/"
echo "   执行 git status 查看新增文件"