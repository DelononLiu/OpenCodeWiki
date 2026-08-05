# RAG 评测方法（精度基线 · 迭代驱动）

> 本文件记录 OpenCodeWiki 的 QA/RAG 质量评测方法：怎么跑、怎么读、当前基线、已知问题。
> 后续所有"提升精度"的工作都以此为准绳：**改一处 → 复跑 → 对比 → 提交**。

---

## 1. 评测体系（三层）

| 层 | 内容 | 成本 | 何时跑 |
|---|------|------|--------|
| 单元测试 | `eval/test_rag_metrics.py`（23 用例，纯函数 + mock） | 零（无网络） | 每次改 `rag_metrics.py` / 评测代码 |
| 冒烟评测 | `--limit 2` 全链路验证（后端 + LLM judge） | 分钟级 | 环境变更、权限变更后 |
| 全量评测 | 25 题 ×（1 次 QA + 2 次 LLM judge） | ~13 分钟 | 每次精度迭代 |

三者关系：单测保证指标计算正确，冒烟保证链路通，全量才是真正打分。

---

## 2. 前置条件与权限（踩坑实录）

以下坑全部实际踩过，务必先看：

1. **沙箱网络隔离**：`CODEX_SANDBOX_NETWORK_DISABLED=0` 只影响宿主环境，**不放开沙箱内命令的网络**。
   沙箱内 `curl example.com` / `api.deepseek.com` 一律 `000`，只有沙箱外（批准后）才有网络。
2. **数据目录只读**：`~/.opencodewiki/` 对沙箱只读，沙箱内起后端会报
   `sqlite3.OperationalError: attempt to write a readonly database`。
3. **真实评测命令必须在沙箱外执行**（需用户批准）；后端若已由宿主跑在 8100，直接复用即可，
   无需重复启动（沙箱内看不到宿主进程，但沙箱外能看到）。
4. **LLM judge 配置**：`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` 优先，回退 `LLM_*`；
   默认 `gpt-4o-mini` / `https://api.openai.com/v1`。
5. **登录响应无 `ok` 字段**：`/api/auth/register` 与 `/api/auth/login` 直接返回
   `{"token": ..., "user": ...}`。

---

## 3. 操作流程

### 3.1 单元测试（无网络，随便跑）

```bash
# 仓库根执行
backend/.venv/bin/python -m pytest eval/test_rag_metrics.py -v
```

### 3.2 准备账号（沙箱外）

```bash
curl -s -X POST http://localhost:8100/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"evalrun2026","password":"evalrun2026pw"}'
# 返回 {"token": "...", "user": {...}}，直接用返回的 token
```

### 3.3 全量评测（沙箱外）

```bash
# 必须用 -m 模块方式运行（脚本内 from eval import rag_metrics，直接跑 .py 会 ModuleNotFoundError）
backend/.venv/bin/python -m eval.run_rag_eval --token "$TOKEN"

# 冒烟验证：只跑前 2 题
backend/.venv/bin/python -m eval.run_rag_eval --token "$TOKEN" --limit 2

# 零 LLM 成本：只算检索侧 ID 指标（不调 LLM judge）
backend/.venv/bin/python -m eval.run_rag_eval --token "$TOKEN" --skip-llm
```

结果写入 `eval/results/rag_baseline.json`，控制台打印记分卡。

> ⚠️ 当前 `--user/--password` 登录路径有 bug（见 §7.1），必须先注册拿 token 再 `--token`。

---

## 4. 指标理论方法（RAGAS 对齐）

四个指标分两类：

- **检索侧（ID 版）**：context_precision / context_recall —— 确定性、零 LLM 成本、可复现；
- **生成侧（LLM judge）**：faithfulness / context_recall_llm —— 陈述拆解 + 逐条判定。

### 4.1 核心思想：把文本拆成原子陈述（claims）

RAGAS 的 faithfulness / context_recall 都基于**陈述拆解**（TRUE / textual entailment 思路）：
整段回答无法归因，但拆成相互独立的原子陈述后，就能逐条判断"这条是否被检索上下文支撑 / 覆盖"。
judge 一次调用同时返回 `claims` 与 `supported` 两个等长列表（见 `rag_metrics._CLAIMS_PROMPT`），
可解释、可归因，而不是给整段打一个模糊分。

### 4.2 Faithfulness（忠实度）

步骤：

1. 把回答 A 拆成 n 条独立陈述 {a₁ … aₙ}；
2. 逐条判定 aᵢ 能否被检索上下文直接支撑（允许合理推断，不允许上下文之外的事实）；
3. 公式：

```
Faithfulness = Σᵢ [aᵢ 被支撑] / n
```

- 1.0 = 回答完全由检索上下文支撑；0 = 完全无支撑（编造）。
- 用途：定位"幻觉"——回答是否超出了检索到的内容。
- 对应函数：`faithfulness(answer, context_text, judge)`。

### 4.3 Context Recall（上下文召回，LLM 版）

步骤与 faithfulness 相同，只是对象换成**参考答案** R：

1. 把参考答案拆成 m 条陈述 {r₁ … rₘ}；
2. 逐条判定 rᵢ 是否被检索上下文覆盖；
3. 公式：

```
Context Recall = Σᵢ [rᵢ 被覆盖] / m
```

- 衡量"检索到底把该给的内容给了没有"，比 ID 版更细：不要求精确命中文件，内容覆盖即可。
- 对应函数：`context_recall_llm(reference, context_text, judge)`。

### 4.4 Context Precision（上下文精确率，排序加权）

RAGAS 排序加权定义（Top-K 检索列表，vᵢ ∈ {0,1} 表示第 i 位是否相关）：

```
Precision@k = (Σ_{i≤k} vᵢ) / k
Context Precision@K = Σₖ (Precision@k × vₖ) / Σₖ vₖ
```

- 含义：相关结果越靠前分越高。同样只有 1 个相关项，排第 1 得 1.0，排第 2 得 0.5。
- 举例（来自单测）：retrieved = [x.md, y.md]、golden = [y.md] →
  Precision@1 = 0，Precision@2 = 1/2 → (0 + 0.5) / 1 = **0.5**；若 y.md 排第 1 → **1.0**。
- 对应函数：`context_precision_ranked(retrieved_titles, golden_files)`。

### 4.5 落地简化：ID 版（用 golden 文件代替相关性标注）

RAGAS 官方用人工 / LLM 标注每位的相关性；本仓库为可复现、零成本，改用
**golden_files 子串匹配**判定相关（不区分大小写）：

- 命中 = 检索到的 `doc_title` 包含某个 golden 文件路径（子串）；
- `context_recall_id` = 命中 golden 数 / golden 总数；
- `context_precision_id` = 命中检索项 / 总检索项（不加权的简单版）。

对应函数：`match_retrieved` / `context_recall_id` / `context_precision_id`。

**代价**：ID 版精度取决于 golden 标注与 `doc_title` 的格式一致性 —— 这正是 §7.2 匹配失真的根源。

### 4.6 聚合与 None

- `aggregate()` 忽略 None 求均值（全 None 返回 None）；
- None 来源：无检索结果 / 无 golden（如 real-006）、LLM judge 解析失败（§7.3）；
- 报告时必须同时给 None 率，否则均值会被高估。

---

## 5. 指标定义与读法（速查表，理论见 §4）

| 指标 | 计算方式 | 含义 | 提升抓手 |
|---|------|------|---------|
| context_precision | 排序加权精度（§4.4，golden 子串匹配） | 相关结果是否排得靠前 | RRF / rerank 排序 |
| context_recall | 命中 golden 数 / golden 总数（§4.5） | 关键内容是否检索到 | chunk / embedding / 检索 |
| faithfulness | 回答 claims 被上下文支撑比例（§4.2） | 回答是否忠实于检索上下文 | prompt / 上下文注入 |
| context_recall_llm | 参考 claims 被上下文覆盖比例（§4.3） | 检索引擎整体覆盖能力 | 检索引擎 |

读法要点：

- 四个指标相互独立，**低 precision/recall 不等于检索差**——先排除 §7.2 的匹配失真。
- `None` = 该题没算出来（无检索结果 / judge 解析失败），聚合时被忽略；对比时还要统计 None 率。
- 只看相对变化：单次绝对值受题目集、模型、匹配方式影响，迭代时只对比同配置下的复跑结果。

---

## 6. 当前基线（2026-08-05 · DeepSeek LLM judge）

| 指标 | 值 | 备注 |
|---|------|------|
| context_precision | 0.019 | 受 §7.2 匹配失真影响，系统性低估 |
| context_recall | 0.042 | 同上 |
| faithfulness | 0.850 | 12/25 题为 None |
| context_recall_llm | 0.221 | 12/25 题为 None |

> 该基线来自首次全量运行。修复 §7 的已知问题后应重跑更新基线。

---

## 7. 已知问题（精度提升的主攻方向）

### 7.1 `login()` 检查不存在的 `ok` 字段

`eval/run_rag_eval.py` 的 `login()` 检查 `data["ok"]`，但后端登录/注册响应没有该字段
（`{"token", "user"}`），导致 `--user/--password` 必然报"登录失败"。

- 临时绕过：注册接口直接拿 token，用 `--token`。
- 修复方向：`login()` 直接取 `data["token"]`，配 mock 登录响应的单测。

### 7.2 golden 全路径 vs doc_title 文件名 匹配失真

golden_files 是全路径（如 `docs/ARCHITECTURE.md`、`backend/requirements.txt`），
检索返回的 `doc_title` 是文件名或显示标题（如 `architecture.md`、
`OpenCodeWiki：团队知识库问答系统核心功能与架构`）。子串匹配 23/25 题 miss，
导致 precision/recall 接近 0——**不代表检索真的差**。

- 修复方向：匹配时同时比较 `os.path.basename(golden)`，或让检索侧返回相对路径。
- 验证方法：修复后 real-001 的 recall 应保持 1.0，其余题 recall 应从 0 上升。

### 7.3 LLM judge 长 prompt 下返回散文而非 JSON

简单 prompt 时模型返回合法 JSON；真实 prompt（长上下文 + 长回答）约半数返回
散文式推理（复述上下文、逐条讨论），`parse_claims_response` 解析失败 → 指标为 None。

- 修复方向：强化 prompt（"只输出 JSON，禁止解释/复述"）、加大 `max_tokens`、
  或换非推理模型；修复后 None 率应显著下降。
- 验证方法：`faithfulness` / `context_recall_llm` 的 None 数从 12/25 下降。

---

## 8. 精度提升迭代工作流

1. 跑全量，保存当前 `eval/results/rag_baseline.json` 作为基线。
2. 只改一处（检索 / 排序 / prompt / chunk / embedding）。
3. 复跑全量，对比四个指标 + None 率。
4. 只信同配置下的前后对比，不看单次绝对值。
5. 达标后提交；按仓库铁律，每处改动必须带测试（含 mock，无网络依赖）。
