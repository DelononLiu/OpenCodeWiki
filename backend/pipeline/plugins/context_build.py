from backend.pipeline.events import PipelineEvent
from backend.pipeline.pipeline import BasePlugin


class ContextBuildPlugin(BasePlugin):
    def __init__(self, system_prompt_template: str, context_template: str):
        self.system_prompt_template = system_prompt_template
        self.context_template = context_template

    # Simple prompts for non-search intents
    GREETING_PROMPT = "You are a friendly assistant. Respond to greetings naturally and concisely. ALWAYS respond in Chinese."
    GENERAL_PROMPT = "You are a helpful assistant. Answer the user's question directly using your knowledge. ALWAYS respond in Chinese."

    async def process(self, event: PipelineEvent) -> PipelineEvent:
        # For non-search intents, use simple prompts without retrieval context
        if event.intent == "greeting":
            event.system_prompt = self.GREETING_PROMPT
            event.context_text = event.question
            return event
        if event.intent == "general":
            event.system_prompt = self.GENERAL_PROMPT
            event.context_text = event.question
            return event
        if event.intent == "system":
            # 系统元数据问答：只用注入的系统信息回答，不检索文档
            event.system_prompt = (
                "You are the OpenCodeWiki system assistant. Answer questions about the "
                "system's knowledge bases and documents based ONLY on the provided system "
                "information. If the information is incomplete, say so honestly. "
                "ALWAYS respond in Chinese."
            )
            event.context_text = f"{event.system_context}\n\n问题：{event.question}"
            return event

        # Take reranked or search results
        results = event.reranked_results if event.reranked_results else event.search_results

        # Build context text from retrieved chunks
        chunks_text = ""
        for i, r in enumerate(results[:5]):
            chunks_text += f"\n[Source {i+1}: {r.doc_title}]\n{r.content}\n"

        # Fill templates
        event.context_text = self.context_template.replace("{{contexts}}", chunks_text).replace("{{query}}", event.question)
        event.system_prompt = self.system_prompt_template.replace("{{contexts}}", chunks_text).replace("{{language}}", "Chinese")

        return event
