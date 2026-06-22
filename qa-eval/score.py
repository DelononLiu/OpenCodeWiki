#!/usr/bin/env python3
"""qa-eval/score.py — LLM 评分器，被 eval.sh 调用。
从 TMPDIR 环境变量读取临时目录，其下有 question.txt/reference.txt/answer.txt。"""
import json, os, urllib.request, datetime

tmpdir = os.environ['TMPDIR']
with open(os.path.join(tmpdir, 'question.txt')) as f: question = f.read()
with open(os.path.join(tmpdir, 'reference.txt')) as f: reference = f.read()
with open(os.path.join(tmpdir, 'answer.txt')) as f: answer = f.read()

prompt = f"""你是一个代码问答质量评估专家。比较参考答案和待评估回答，从以下维度打分（1-5分）：

## 问题
{question}

## 参考答案（黄金标准）
{reference}

## 待评估回答
{answer}

## 评分维度
1. **完整性**（1-5）：覆盖了多少关键维度？是否遗漏了重要的对比点？
2. **代码引用准确性**（1-5）：引用的文件路径和行号是否正确、具体？
3. **结构清晰度**（1-5）：是否有对比表格/分层结构？还是段落堆砌？
4. **深度**（1-5）：是表面概括还是深入到具体实现细节（如协议解析、session管理）？
5. **可执行性**（1-5）：读者看完能否理解两者的区别并知道如何使用？

返回 JSON 格式，不要额外解释：
{{"scores":{{"completeness":3,"code_refs":3,"structure":3,"depth":3,"actionability":3}},"total":15,"strengths":["..."],"weaknesses":["..."],"suggestions":["..."]}}"""

body = json.dumps({
    "model": os.environ.get('LLM_MODEL', 'gpt-4o-mini'),
    "messages": [
        {"role": "system", "content": "你是一个严格的代码问答质量评估专家。评分要客观，好的地方肯定，差的地方明确指出。"},
        {"role": "user", "content": prompt}
    ],
    "max_tokens": 1000,
    "temperature": 0,
    "thinking": {"type": "disabled"}
}).encode()

req = urllib.request.Request(
    os.environ.get('LLM_BASE_URL', 'https://api.openai.com/v1') + '/chat/completions',
    data=body,
    headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + os.environ.get('LLM_API_KEY', '')
    }
)
try:
    resp = urllib.request.urlopen(req, timeout=30)
    raw_body = resp.read().decode()
    data = json.loads(raw_body)
    msg = data.get("choices", [{}])[0].get("message", {})
    # deepseek reasoning 模型把输出放 reasoning_content，content 为空
    text = msg.get("content", "") or msg.get("reasoning_content", "") or ""
    # 提取 JSON（兼容 LLM 输出前后有额外文字）
    start = text.find('{')
    end = text.rfind('}')
    if start >= 0 and end > start:
        text = text[start:end+1]
    result = json.loads(text)
    result["case"] = os.environ.get('CASE_ID', '')
    result["date"] = datetime.datetime.now().isoformat()
    result["commit"] = os.environ.get('COMMIT_HASH', '')
    result["answer_len"] = len(answer)
    print(json.dumps(result, indent=2, ensure_ascii=False))
except json.JSONDecodeError as e:
    print(json.dumps({"error": f"JSON parse failed: {e}", "raw": text[:300], "raw_body": raw_body[:500], "case": os.environ.get('CASE_ID', '')}))
except Exception as e:
    print(json.dumps({"error": str(e), "case": os.environ.get('CASE_ID', '')}))
