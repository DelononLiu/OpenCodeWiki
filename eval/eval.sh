#!/bin/bash
# eval.sh — 自动评测 QA 回答质量
set -e
cd "$(dirname "$0")"

CONFIG_FILE="$HOME/.opencodewiki/config.json"
if [ -f "$CONFIG_FILE" ]; then
  export LLM_API_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('apiKey',''))")
  export LLM_BASE_URL=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('baseUrl','https://api.openai.com/v1'))")
  export LLM_MODEL=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('model','gpt-4o-mini'))")
else
  echo "错误：未找到 $CONFIG_FILE"; exit 1
fi

CASE_ID=$(printf "%03d" "${1:-$(ls cases/*.json | sort | tail -1 | sed 's|.*/||;s|\.json$||')}")
CASE_FILE="cases/${CASE_ID}.json"
RESULT_FILE="results/${CASE_ID}.json"
TMPDIR=$(mktemp -d)

if [ ! -f "$CASE_FILE" ]; then echo "错误：未找到 $CASE_FILE"; exit 1; fi
QUESTION=$(python3 -c "import json; print(json.load(open('$CASE_FILE'))['question'])")
echo "=== QA Eval: $CASE_ID ==="
echo "问题: $QUESTION"

# ── Step 1: 调 QA pipeline ──
echo "[1/3] 调用 QA pipeline..."
RAW_FILE="$TMPDIR/qa-raw.txt"
curl -s -X POST http://localhost:4747/codewiki/api/qa \
  -H "Content-Type: application/json" \
  -d "{\"question\":\"$QUESTION\",\"repo\":\"${REPO:-llama.cpp}\"}" \
  --max-time 120 > "$RAW_FILE" 2>/dev/null

ANSWER_TEXT=$(python3 -c "
import json
parts = []
with open('$RAW_FILE') as f:
    for line in f:
        line = line.strip()
        if line.startswith('data: '):
            try:
                d = json.loads(line[6:])
                if d.get('type') == 'token':
                    parts.append(d.get('content',''))
            except: pass
print(''.join(parts))
")

if [ -z "$ANSWER_TEXT" ] || [ ${#ANSWER_TEXT} -lt 50 ]; then
  echo "错误：回答为空或太短"; rm -rf "$TMPDIR"; exit 1
fi
echo "回答长度: ${#ANSWER_TEXT} 字符"
echo "$ANSWER_TEXT" > "$TMPDIR/answer.txt"

# ── Step 2: 评分 ──
HAS_REF=$(python3 -c "import json; print('yes' if json.load(open('$CASE_FILE')).get('reference') else 'no')")
if [ "$HAS_REF" != "yes" ]; then
  echo "跳过评分（无参考答案）"
  echo '{"skipped":true}' > "$RESULT_FILE"
  rm -rf "$TMPDIR"; exit 0
fi

echo "[2/3] 评分中..."
COMMIT_HASH=$(git log --oneline -1 2>/dev/null | awk '{print $1}')
python3 -c "import json; print(json.load(open('$CASE_FILE'))['reference'])" > "$TMPDIR/reference.txt"
echo "$QUESTION" > "$TMPDIR/question.txt"

export CASE_ID COMMIT_HASH TMPDIR
python3 score.py > "$RESULT_FILE" 2>&1 || {
  echo "评分 API 调用失败，请检查 config.json 中的 API Key"
  cat "$RESULT_FILE"
  rm -rf "$TMPDIR"
  exit 1
}

echo ""
echo "=== 评分 ==="
cat "$RESULT_FILE"

# ── Step 3: 更新 METRICS.md ──
python3 -c "
import json, datetime
with open('$RESULT_FILE') as f:
    r = json.load(f)
if 'error' in r:
    exit(0)
dim = r.get('scores', {})
row = f'| {datetime.date.today()} | $CASE_ID | $COMMIT_HASH | {r.get(\"total\",0)} | {dim.get(\"completeness\",0)} | {dim.get(\"code_refs\",0)} | {dim.get(\"structure\",0)} | {dim.get(\"depth\",0)} | {dim.get(\"actionability\",0)} |\n'
with open('METRICS.md', 'a') as f:
    f.write(row)
print('METRICS.md 已更新')
" 2>/dev/null || true

rm -rf "$TMPDIR"
