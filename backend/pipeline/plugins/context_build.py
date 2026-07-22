from backend.pipeline.events import PipelineEvent
from backend.pipeline.pipeline import BasePlugin


class ContextBuildPlugin(BasePlugin):
    def __init__(self, system_prompt_template: str, context_template: str):
        self.system_prompt_template = system_prompt_template
        self.context_template = context_template

    async def process(self, event: PipelineEvent) -> PipelineEvent:
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
