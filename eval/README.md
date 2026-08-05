# QA Eval

API-driven QA quality test suite. Uses pytest + requests only — no backend module imports.

## Usage

./run.sh

## Structure

- test_qa.py — test cases from datasets/ and cases/
- conftest.py — backend fixture (start/stop)
- score.py — LLM-based scoring utility
- datasets/ — machine-annotated QA test data
- cases/ — human-annotated cases with reference answers
- results/ — test output

## RAG 数值指标评测

`rag_metrics.py` + `run_rag_eval.py`：对 `datasets/qa_cases.json`（25 条真实问题，含参考答案与黄金文件）
逐题调用 `/api/qa`，采集回答与检索来源，输出四个数值指标：

| 指标 | 含义 | 指引方向 |
|------|------|----------|
| context_precision | 相关结果是否排得靠前（排序加权） | 调 RRF/rerank |
| context_recall | 关键内容是否检索到（golden 覆盖） | 调 chunk/embedding/检索 |
| faithfulness | 回答是否被检索上下文支撑 | 调 prompt/上下文注入 |
| context_recall_llm | 参考答案 claims 是否被上下文覆盖 | 检索引擎整体 |

运行（后端需先启动在 8100）：

```bash
python3 eval/run_rag_eval.py --user <用户名> --password <密码>
# 只算检索侧 ID 指标（不调 LLM judge，零成本）：
python3 eval/run_rag_eval.py --user <用户名> --password <密码> --skip-llm
```

结果写入 `results/rag_baseline.json`。题集准备工具：`extract_questions.py` 从
`~/.opencodewiki/knora.db` 与 `qa.db` 抽取真实用户问题生成候选，人工挑选后补齐
参考答案与 `golden_files` 即成为正式评测题。
