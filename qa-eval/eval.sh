#!/bin/bash
# qa-eval/eval.sh — 自动评测 QA 回答质量
# 以 Claude 回答为基准，用 LLM 给当前 pipeline 的回答打分
#
# Usage:
#   ./qa-eval/eval.sh                          # 跑默认问题 + 当前服务
#   ./qa-eval/eval.sh "你的问题"                # 指定问题
#   ./qa-eval/eval.sh "问题" "参考回答文件路径"  # 指定参考文件

set -e
cd "$(dirname "$0")/.."

# 读取 LLM 配置
CONFIG_FILE="$HOME/.opencodewiki/config.json"
if [ -f "$CONFIG_FILE" ]; then
  LLM_API_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('apiKey',''))")
  LLM_BASE_URL=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('baseUrl','https://api.openai.com/v1'))")
  LLM_MODEL=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('model','gpt-4o-mini'))")
else
  echo "错误：未找到 $CONFIG_FILE"
  exit 1
fi

QUESTION="${1:-kcode中小助手和任务流的区别}"
REFERENCE_FILE="${2:-qa-eval/reference-claude.md}"
RESULT_FILE=$(mktemp)
SCORE_FILE="qa-eval/score-$(date +%Y%m%d-%H%M%S).md"

echo "=== QA Eval ==="
echo "问题: $QUESTION"
echo "参考: $REFERENCE_FILE"
echo ""

# 1. 调用 pipeline 获取回答
echo "[1/3] 调用 QA pipeline..."
RAW_FILE=$(mktemp)
curl -s -X POST http://localhost:4747/api/qa \
  -H "Content-Type: application/json" \
  -d "{\"question\":\"$QUESTION\",\"repoName\":\"kcode\"}" \
  --max-time 120 2>/dev/null > "$RAW_FILE"

ANSWER_TEXT=$(python3 -c "
import json
text_parts = []
with open('$RAW_FILE') as f:
    for line in f:
        line = line.strip()
        if not line.startswith('data: '): continue
        try:
            d = json.loads(line[6:])
            # 回答以 token 类型流式输出
            if d.get('type') == 'token':
                text_parts.append(d.get('content', ''))
        except: pass
print(''.join(text_parts))
")
rm -f "$RAW_FILE"

if [ -z "$ANSWER_TEXT" ] || [ ${#ANSWER_TEXT} -lt 50 ]; then
  echo "错误：回答为空或太短，服务是否在运行？"
  echo "检查是否有 text 类型事件..."
  curl -s -X POST http://localhost:4747/api/qa \
    -H "Content-Type: application/json" \
    -d "{\"question\":\"test\",\"repoName\":\"kcode\"}" \
    --max-time 10 2>/dev/null | grep 'data: ' | python3 -c "import sys,json; [print(json.loads(l[6:]).get('type','?')) for l in sys.stdin if l.strip().startswith('data:')]" | head -10
  exit 1
fi

echo "回答长度: ${#ANSWER_TEXT} 字符"
echo ""

# 2. 读取参考回答
REFERENCE_TEXT=$(python3 -c "
import re
with open('$REFERENCE_FILE', 'r') as f:
    content = f.read()
# 提取 --- 之后的内容（回答部分）
parts = content.split('---', 1)
if len(parts) > 1:
    print(parts[1].strip())
else:
    print(content.strip())
" 2>/dev/null)

echo "[2/3] 参考长度: ${#REFERENCE_TEXT} 字符"

# 3. LLM 评分
echo "[3/3] LLM 评分中..."

SCORE=$(python3 << PYEOF
import json, os, urllib.request

reference = """$REFERENCE_TEXT"""
answer = """$ANSWER_TEXT"""
question = """$QUESTION"""

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
    "model": "$LLM_MODEL",
    "messages": [
        {"role": "system", "content": "你是一个严格的代码问答质量评估专家。评分要客观，好的地方肯定，差的地方明确指出。"},
        {"role": "user", "content": prompt}
    ],
    "max_tokens": 500,
    "temperature": 0,
    "response_format": {"type": "json_object"}
}).encode()

req = urllib.request.Request(
    "$LLM_BASE_URL/chat/completions",
    data=body,
    headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer $LLM_API_KEY"
    }
)
try:
    resp = urllib.request.urlopen(req, timeout=30)
    data = json.loads(resp.read())
    text = data["choices"][0]["message"]["content"]
    result = json.loads(text)
    print(json.dumps(result, indent=2, ensure_ascii=False))
except Exception as e:
    print(f'{{"error":"{str(e)}"}}')
PYEOF
)

echo ""
echo "=== 评分结果 ==="
echo "$SCORE"

# 保存到文件
cat > "$SCORE_FILE" << EOF
# QA Eval Score

**时间**: $(date '+%Y-%m-%d %H:%M:%S')
**问题**: $QUESTION
**提交**: $(git log --oneline -1 2>/dev/null || echo '-')

---

## 评分

\`\`\`
$SCORE
\`\`\`

---

## 回答全文

$ANSWER_TEXT

---

## 参考全文

$REFERENCE_TEXT
EOF

rm -f "$RESULT_FILE"
echo ""
echo "Saved: $SCORE_FILE"
