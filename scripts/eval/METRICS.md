# 评测指标历史

## 汇总

| 日期 | 迭代 | Recall@5 | Recall@10 | MRR | Pass@5 | 通过率 |
|------|------|----------|-----------|-----|--------|--------|
| 2026-06-19 | **baseline**（纯 FTS5） | **47.3%** | **49.3%** | **0.3957** | **8/10** | **80%** |
| 2026-06-19 | **iter1-hybrid**（FTS5 + 向量 + RRF）| **56.4%** | **66.5%** | **0.4692** | **9/10** | **90%** |
| 2026-06-19 | **iter2-rerank-tpl**（+ 重排序占位 + 模板动态选择）| 56.4% | 66.5% | 0.4692 | 9/10 | 90% |
| 2026-06-19 | **iter3-incremental**（增量索引 + 多库路由 + QA 集成）| 56.4% | 66.5% | 0.4692 | 9/10 | 90% |
| 2026-06-19 | **iter3-startup**（启动配置固化 + 内网部署支持）| 56.4% | 66.5% | 0.4692 | 9/10 | 90% |

## 失败题目

```
wiki-001     | ❌  MRR 0.042——未进入 top-5
```

### wiki-001
- 问题: How does the QA endpoint resolve file references in answers?
- 意图: how-to
- 期望符号: resolveAnswerSources, extractFileRefs, resolveCrossRepoSources
- 基线: ✅ → Iter 1: ❌ 向量搜索没找到这些符号在 top-5

## 已解决（Iter 1）

```
kcode-002    | ✅  57%（AgentManager@1, KCodeClient@3, KCodeConfig@7, KCodePlugin@9）
wiki-003     | ✅  33%（multiRepoSsearch@3, CROSS_REPO_ACP_CLIENT@7）
```
