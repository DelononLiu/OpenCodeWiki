#!/bin/bash
set -e
echo "Wiki 生成: $1"
cd "$(dirname "$0")/.."
python3 scripts/crg-wiki.py "$@"
