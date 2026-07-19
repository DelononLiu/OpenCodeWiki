---
name: install
description: 将服务管理 plugin 安装到另一个项目
---
# 安装 Service Plugin 到其他项目

本 plugin 是通用的，可安装到任何 "backend + frontend/vite" 结构的项目。

## 手动安装

```bash
# 在目标项目根目录执行
cd /path/to/target-project

# 从本 plugin 拷过去
cp -r /path/to/source-project/.claude-plugin/service-mgmt/ .claude-plugin/

# 创建注册文件
cat > .claude/settings.json <<'EOF'
{
  "extraKnownMarketplaces": {
    "service-mgmt": {
      "source": {
        "source": "directory",
        "path": ".claude-plugin/service-mgmt"
      }
    }
  }
}
EOF
```

## 用安装脚本

```bash
# 脚本在 plugin 目录内
bash .claude-plugin/service-mgmt/template-install.sh /path/to/target-project

# 或从源项目直接指定路径
bash /path/to/source-project/.claude-plugin/service-mgmt/template-install.sh /path/to/target-project
```

## 安装后

`cd` 到目标项目启动 Claude，即可使用 `/start` `/stop` `/logs`。
