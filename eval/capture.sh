#!/bin/bash
# 捕获 QA 回答到文件
# ./capture.sh "问题" 版本名

QUESTION="${1:-kcode中小助手和任务流的区别}"
VERSION="${2:-v$(date +%Y%m%d-%H%M%S)}"
OUTFILE="qa-eval/${VERSION}.md"
TMPFILE=$(mktemp)

echo "=== Capture QA: $VERSION ==="
echo "Q: $QUESTION"
echo "Saving to: $OUTFILE"

# 先写头部
cat > "$OUTFILE" <<EOF
# QA Eval: $VERSION

**时间**: $(date '+%Y-%m-%d %H:%M:%S')
**问题**: $QUESTION
**提交**: $(git log --oneline -1 2>/dev/null || echo '(unknown)')

---

## 回答

EOF

# 发起请求，提取回答文本部分
curl -s -N -X POST http://localhost:4747/api/qa \
  -H "Content-Type: application/json" \
  -d "{\"question\":\"$QUESTION\",\"repoName\":\"kcode\"}" \
  --max-time 120 2>/dev/null | while IFS= read -r line; do
  case "$line" in
    data:*)
      data="${line#data: }"
      # 提取 text 类型的内容
      text=$(echo "$data" | python3 -c "
import sys,json
try:
    d=json.loads(sys.stdin.read())
    if d.get('type')=='text': print(d.get('text',''),end='')
except: pass
" 2>/dev/null)
      if [ -n "$text" ]; then
        printf "%s" "$text" >> "$OUTFILE"
      fi
      # sources 类型
      srcs=$(echo "$data" | python3 -c "
import sys,json
try:
    d=json.loads(sys.stdin.read())
    if d.get('type')=='sources':
        for s in d.get('sources',[]): print(f\"  {s.get('filePath','')}:{s.get('startLine','')}\")
except: pass
" 2>/dev/null)
      if [ -n "$srcs" ]; then
        echo "" >> "$OUTFILE"
        echo "" >> "$OUTFILE"
        echo "---" >> "$OUTFILE"
        echo "**来源文件**: $srcs" >> "$OUTFILE"
      fi
      # done 类型
      done_type=$(echo "$data" | python3 -c "
import sys,json
try:
    d=json.loads(sys.stdin.read())
    if d.get('type')=='done': print('done')
except: pass
" 2>/dev/null)
      if [ "$done_type" = "done" ]; then
        echo "" >> "$OUTFILE"
        echo "" >> "$OUTFILE"
        echo "---" >> "$OUTFILE"
        echo "_响应结束_" >> "$OUTFILE"
        exit 0
      fi
      ;;
  esac
done

echo "Done: $OUTFILE"
