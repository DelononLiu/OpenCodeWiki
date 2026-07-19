#!/bin/bash
# OpenCodeWiki 服务管理 Plugin 安装脚本
# 用法: bash template-install.sh /path/to/target-project

set -e

TARGET="${1:-.}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_NAME="opencodewiki-service"

if [ ! -d "$TARGET" ]; then
  echo "❌ 目标目录不存在: $TARGET"
  echo "用法: bash template-install.sh /path/to/project"
  exit 1
fi

cd "$TARGET"

# 创建目录
mkdir -p .claude-plugin .claude

# 拷贝 plugin
if [ -d ".claude-plugin/$PLUGIN_NAME" ]; then
  echo "⚠️  目标已存在 .claude-plugin/$PLUGIN_NAME，跳过"
else
  cp -r "$SCRIPT_DIR" ".claude-plugin/$PLUGIN_NAME"
  echo "✅ 已安装 plugin 到 .claude-plugin/$PLUGIN_NAME"
fi

# 写入 settings.json（如果不存在或不包含该 marketplace）
if [ ! -f ".claude/settings.json" ]; then
  cat > .claude/settings.json <<EOF
{
  "extraKnownMarketplaces": {
    "opencodewiki-service": {
      "source": {
        "source": "directory",
        "path": ".claude-plugin/opencodewiki-service"
      }
    }
  }
}
EOF
  echo "✅ 已创建 .claude/settings.json"
elif ! grep -q "opencodewiki-service" .claude/settings.json 2>/dev/null; then
  echo "⚠️  .claude/settings.json 已存在但未注册，请手动添加 opencodewiki-service marketplace"
else
  echo "✅ .claude/settings.json 已注册"
fi

echo "🎉 安装完成！进入 $TARGET 启动 Claude 即可使用 /start /stop /logs"
