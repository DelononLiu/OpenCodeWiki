import asyncio
from backend.sediment import refine_qa_to_card, draft_article


class _FakeCompletions:
    def __init__(self, reply: str):
        self._reply = reply

    async def create(self, **kwargs):
        class Msg:
            content = self._reply
        class Choice:
            message = Msg()
        class Resp:
            choices = [Choice()]
        return Resp()


class _FakeChat:
    def __init__(self, reply: str):
        self.completions = _FakeCompletions(reply)


class FakeLLM:
    """返回预置 JSON 的假客户端，模拟 AsyncOpenAI 的 client.chat.completions.create。"""
    def __init__(self, reply: str):
        self.reply = reply
        self.chat = _FakeChat(reply)


class _BrokenCompletions:
    async def create(self, **kwargs):
        raise RuntimeError("llm down")


class _BrokenChat:
    def __init__(self):
        self.completions = _BrokenCompletions()


class BrokenLLM:
    """每次调用都抛异常的假客户端（LLM 宕机场景）。"""
    def __init__(self):
        self.chat = _BrokenChat()


def test_refine_qa_to_card():
    llm = FakeLLM('{"title": "卡片标题", "content": "卡片正文"}')
    result = asyncio.run(refine_qa_to_card(llm, "model", "问题", "回答"))
    assert result == {"title": "卡片标题", "content": "卡片正文"}


def test_refine_qa_to_card_fallback():
    result = asyncio.run(refine_qa_to_card(BrokenLLM(), "model", "问题", "回答"))
    assert result["title"] == "问题"[:40]
    assert result["content"] == "回答"


def test_refine_qa_to_card_malformed_json():
    llm = FakeLLM("不是 JSON 的回复")
    result = asyncio.run(refine_qa_to_card(llm, "model", "问题", "回答"))
    assert result["content"] == "回答"


def test_draft_article():
    llm = FakeLLM('{"title": "聚合文章", "content": "# 文章\\n\\n正文"}')
    cards = [{"title": "卡1", "content_md": "c1"}, {"title": "卡2", "content_md": "c2"}]
    result = asyncio.run(draft_article(llm, "model", cards, "标题提示"))
    assert result["title"] == "聚合文章"


def test_draft_article_fallback():
    cards = [{"title": "卡1", "content_md": "c1"}]
    result = asyncio.run(draft_article(BrokenLLM(), "model", cards))
    assert "卡1" in result["title"] and "c1" in result["content"]
