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
cp -r /path/to/opencodewiki/.claude-plugin/opencodewiki-service/ .claude-plugin/

# 创建注册文件
cat > .claude/settings.json <<'EOF'
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
```

## 用安装脚本

```bash
bash .claude-plugin/opencodewiki-service/template-install.sh /path/to/target-project
```

## 安装后

`cd` 到目标项目启动 Claude，即可使用 `/start` `/stop` `/logs`。
