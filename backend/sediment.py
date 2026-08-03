"""AI 沉淀服务：QA → 卡片提炼、卡片组 → 文章起草。LLM 失败时降级为原始内容。"""
import json

_CARD_PROMPT = """你是知识库整理助手。把下面的问答提炼成一张知识卡片。
要求：标题 10-30 字；正文 100-300 字，结构清晰，只保留可复用的事实与结论。
只输出 JSON：{{"title": "标题", "content": "正文"}}

问题：{question}
回答：{answer}"""

_ARTICLE_PROMPT = """你是团队知识库编辑。基于以下知识卡片起草一篇 markdown 文章。
要求：
- 用 # 作为一级标题，内容 500-1000 字；
- 组织成一个连贯的整体，不要逐卡罗列；
- 在末尾以「参考卡片」小节列出卡片标题。
只输出 JSON：{{"title": "文章标题", "content": "markdown 正文"}}

{cards}"""


async def _chat_json(client, model: str, prompt: str) -> dict:
    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    content = resp.choices[0].message.content or ""
    return json.loads(content)


async def refine_qa_to_card(client, model: str, question: str, answer: str) -> dict[str, str]:
    try:
        data = await _chat_json(client, model, _CARD_PROMPT.format(question=question, answer=answer))
        return {"title": str(data["title"])[:80], "content": str(data["content"])}
    except Exception:
        return {"title": question[:40], "content": answer}


async def draft_article(client, model: str, cards: list[dict], title_hint: str = "") -> dict[str, str]:
    card_text = "\n\n".join(
        f"### {c.get('title', '')}\n{c.get('content_md', '')}" for c in cards
    )
    try:
        data = await _chat_json(client, model, _ARTICLE_PROMPT.format(cards=card_text))
        return {"title": str(data["title"])[:80], "content": str(data["content"])}
    except Exception:
        joined = "\n\n".join(f"### {c.get('title', '')}\n{c.get('content_md', '')}" for c in cards)
        return {"title": title_hint or (cards[0]["title"] + " 等" if cards else "新文章"),
                "content": joined}
