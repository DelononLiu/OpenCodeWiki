# 评测指标历史

## 汇总

| 日期 | 迭代 | Recall@5 | Recall@10 | MRR | Pass@5 | 通过率 |
|------|------|----------|-----------|-----|--------|--------|
| 2026-06-19 | **baseline** | **47.3%** | **49.3%** | **0.3957** | **8/10** | **80%** |

## 失败题目

```
kcode-002    | ❌  golden symbols 不匹配索引
wiki-003     | ❌  NL 问题 → FTS5 搜不到符号
```

### kcode-002
- 问题: What tools does kcode expose to agents?
- 意图: what-structure
- 期望符号: ToolItem, ToolGroup, getTaskToolGroups
- 失败原因: golden symbols 在 codegraph 索引中不存在或不匹配

### wiki-003
- 问题: How are cross-repo queries searched across multiple repositories?
- 意图: how-to
- 期望符号: isCrossRepo, listRepos, repoBaseMap, crossRepoNames
- 失败原因: 自然语言问题 → FTS5 无法匹配到代码符号名，需向量语义搜索解决
