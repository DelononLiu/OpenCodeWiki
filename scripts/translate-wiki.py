"""
translate-wiki.py — 将 openwiki 英文文档翻译为中文。

用法: cd backend && source .venv/bin/activate && python ../scripts/translate-wiki.py

使用已配置的 LLM（~/.opencodewiki/config.json），逐文件翻译。
保留 Markdown 结构、代码块、链接、mermaid 图表，只翻译正文文本。
"""

import json
import re
from pathlib import Path
from langchain_openai import ChatOpenAI

OPENWIKI_DIR = Path(__file__).parent.parent / "openwiki"
CONFIG_PATH = Path.home() / ".opencodewiki" / "config.json"


def load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"apiKey": "", "baseUrl": "https://api.deepseek.com", "model": "deepseek-v4-flash"}


# ── LLM ──

cfg = load_config()
llm = ChatOpenAI(
    model=cfg.get("model", "deepseek-v4-flash"),
    api_key=cfg.get("apiKey", ""),
    base_url=cfg.get("baseUrl", "https://api.deepseek.com"),
    temperature=0,
)


def translate_md(content: str, filename: str) -> str:
    """用 LLM 翻译 markdown 文档，保留结构和代码块。"""
    prompt = f"""你是一个专业的技术文档翻译，专注开源基础设施和开发者工具领域。请将以下英文 Markdown 文档翻译为中文。

翻译规则：
1. 保留所有 Markdown 格式（标题 #、列表 -、表格 |、代码块 ```、链接 []() 等）
2. 保留代码块内容不变，不翻译代码
3. 保留 mermaid 图表内容不变
4. 保留文件名、路径、命令等不变
5. 技术术语保持准确：repository=仓库、directory=目录、schema=模式/ schema、endpoint=端点、middleware=中间件、deployment=部署、integration=集成、configuration=配置、pipeline=流水线、runtime=运行时、query=查询、agent=Agent、tool=工具、node=节点
6. 首次出现的英文术语在中文后加括号保留原文，如"索引（index）"
7. 保持原文档的标题层级和结构
8. 翻译必须忠实原文，逐句翻译，不添加原文没有的内容
9. 项目名称 OpenCodeWiki 不翻译

文件: {filename}
--- 文档内容开始 ---
{content}
--- 文档内容结束 ---

请直接输出翻译后的完整 Markdown 文档，不要加额外说明。"""

    resp = llm.invoke(prompt)
    return resp.content.strip()


def main():
    md_files = sorted(OPENWIKI_DIR.glob("*.md"))
    # 排除 _plan.md 和 .last-update.json
    md_files = [f for f in md_files if f.name != "_plan.md"]

    print(f"📖 发现 {len(md_files)} 篇文档，开始翻译...\n")

    for md_file in md_files:
        content = md_file.read_text(encoding="utf-8")
        print(f"  🔄 翻译: {md_file.name} ({len(content)} 字符)")
        try:
            translated = translate_md(content, md_file.name)
            md_file.write_text(translated, encoding="utf-8")
            print(f"  ✅ 完成: {md_file.name}")
        except Exception as e:
            print(f"  ❌ 失败: {md_file.name}: {e}")

    print(f"\n✅ 全部翻译完成！总计 {len(md_files)} 篇")


if __name__ == "__main__":
    main()
