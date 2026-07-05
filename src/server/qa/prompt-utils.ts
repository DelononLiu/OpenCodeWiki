/**
 * Prompt 工具模块。
 *
 * 提供问题分类、模板选择、翻译等共享工具函数。
 */

import type { Domain } from './types.js';

// ── Domain classification ─────────────────────────────────────

export function classifyDomain(question: string): Domain {
  const q = question.trim().toLowerCase();
  if (/(编译|构建|构建失败|编译错误|build|compile|make\b|cmake|gradle|maven|bazel|link error|链接错误|依赖|dependency|链接|ld\b|ar\b|objdump|nm\b)/.test(q)) return 'build-issue';
  if (/(lint|eslint|sonar|tslint|prettier|代码质量|code smell|bug|缺陷|漏洞|格式检查|代码规范|规范检查|代码分析|循环复杂度|cyclomatic|复杂度|安全漏洞|安全分析)/.test(q)) return 'bug-analysis';
  if (/(堆栈|栈回溯|stack trace|call stack|segfault|段错误|null pointer|空指针|crash dump|core dump|异常退出|panic|crash|崩溃|OOM|内存泄漏|死锁|deadlock|线程|thread|并发|concurrent)/.test(q)) return 'stack-analysis';
  if (/(程序分析|数据流|控制流|data flow|control flow|program analysis|运行时|runtime behavior|调用链|调用图|call graph)/.test(q)) return 'program-analysis';
  if (/(日志|日志分析|异常日志|服务日志|access log|nginx log|application log|syslog|日志文件|log\b)/.test(q)) return 'log-analysis';
  return 'general';
}

/** Backward compatible alias */
export function classifyQuestion(question: string): Domain {
  return classifyDomain(question);
}

// ── Domain processing flows ──────────────────────────────────

export function domainProcessingFlow(domain: Domain): string {
  const flows: Record<Domain, string> = {
    general: `## 领域处理流程

采用通用搜索策略：
1. search_graph 语义搜索定位问题相关的符号
2. get_code_snippet 获取关键符号的完整定义
3. 综合搜索到的信息组织回答`,

    'build-issue': `## 领域处理流程

这是一个 **编译构建** 问题，按以下方式处理：
1. **先确认是否真的是编译问题**：检查错误信息是否指向代码本身的语法/链接/配置问题
   - 如果是环境配置、版本不匹配、外部依赖问题，说明原因并给出修复方向
   - 如果是代码层面的编译错误，继续以下步骤
2. 提取错误信息中的关键标识符（函数名、宏、链接符号、目标名）
3. search_graph 搜索这些关键词，优先命中构建文件（CMakeLists.txt、Makefile、package.json、Cargo.toml 等）
4. get_code_snippet 查看关键符号的完整定义
5. 重点分析：编译选项配置、依赖版本约束、链接脚本、条件编译宏`,

    'bug-analysis': `## 领域处理流程

这是一个 **缺陷分析** 问题，按以下方式处理：
1. **先确认是否真的是缺陷**：阅读代码逻辑，判断用户描述的现象是否符合预期行为
   - 如果行为符合预期（设计如此、配置问题、用户误解），说明原因并结束
   - 如果确实不符合预期，继续以下步骤
2. 用问题中涉及的符号名进行 search_graph
3. get_code_snippet 获取函数/类的完整定义
4. 从以下维度审查代码：
   - 类型安全（类型转换、空指针、未初始化变量）
   - 资源管理（内存泄漏、句柄未释放）
   - 逻辑正确性（边界条件、竞态、空集合操作）
   - 可维护性（命名、复杂度、重复代码）
   - 安全漏洞（注入、越界、权限绕过）`,

    'stack-analysis': `## 领域处理流程

这是一个 **堆栈 / 崩溃分析** 问题，按以下方式处理：
1. **先确认崩溃是否由代码逻辑引起**：检查堆栈帧是否指向项目自有代码，排除第三方库/系统调用误报
   - 如果崩溃在第三方库或系统调用中且无项目代码参与，说明外部原因并结束
   - 如果指向项目代码，继续以下步骤
2. 从堆栈中提取关键帧的函数名——从应用程序代码层开始，过滤掉框架/库层
3. 用 search_graph 定位每个关键函数
4. 用 get_code_snippet 查看函数完整定义
5. 用 trace_path 追溯调用来源
6. 分析根因方向：空指针访问、缓冲区越界、未初始化变量、资源耗尽、断言失败`,

    'program-analysis': `## 领域处理流程

这是一个 **程序分析 / 运行时行为** 问题，按以下方式处理：
1. 用问题中的核心符号或概念进行 search_graph
2. get_code_snippet 获取关键定义
3. 用 trace_path 分析影响范围
4. 用 trace_path / trace_path 追踪调用链
5. 说明数据流转路径和关键控制节点`,

    'log-analysis': `## 领域处理流程

这是一个 **日志分析** 问题，按以下方式处理：
1. **先判断日志级别和性质**：区分是报错（error/fatal）还是警告/信息，确认是否需要关注
   - 如果是 INFO/WARN 级别的例行日志且无异常模式，说明无需处理并结束
   - 如果是 ERROR/FATAL 或明显异常模式，继续以下步骤
2. 提取日志中的关键信息：错误码、异常类型、时间戳、关键词
3. 用提取到的错误关键词进行 search_graph
4. 定位日志输出点附近的逻辑处理代码
5. 分析：什么条件下产生该日志、后续处理流程是什么、是否有已知的问题模式`,
  };
  return flows[domain] || flows.general;
}

// ── Answer templates ─────────────────────────────────────────

const TEMPLATES: Record<string, string> = {
  A: `### 模板 A：故障排查
适用于编译错误、运行时崩溃、段错误、日志异常、链接错误等排查类问题。

- **1 句话直接指出错误或异常（不加标题）。**
- ## 错误信息 — 关键错误输出放在代码块中；如有堆栈只需关键帧。
- ## 原因分析 — 用 bullet list 说明触发条件和根因，避免长篇大论。
- ## 解决方案 — 可操作的具体步骤，按推荐程度列出。`,

  B: `### 模板 B：代码解释
适用于"这段代码做了什么"、"这个函数功能是什么"、"逻辑是怎么走的"等解释类问题。

- **1 句话概括代码行为（不加标题）。**
- ## 功能说明 — 用自然语言解释作用，说明输入/输出/核心逻辑。
- ## 源码走读 — 沿关键路径逐段分析，配合代码片段标注行号。
- ## 影响范围 — 调用方/被调用方/边界情况/副作用。`,

  C: `### 模板 C：代码审查
适用于"这样写有什么问题"、"有优化空间吗"、"哪里可能出 bug"等审查类问题。

- **1 句话指出问题或改进点（不加标题）。**
- ## 问题分析 — 按正确性/性能/可维护性/安全维度分析，解释为什么是问题。
- ## 代码位置 — 文件:行号，涉及多处分别列出。
- ## 改进建议 — 最好有 before/after 对比，多方案时简述 trade-off。`,

  D: `### 模板 D：配置用法
适用于"这个配置项什么意思"、"API 怎么调"、"参数怎么设"等用法类问题。

- **1 句话说明配置或用法的目标（不加标题）。**
- ## 步骤 — numbered list 列出操作顺序。
- ## 参数说明 — 表格：参数名 | 类型 | 默认值 | 说明，只列关键参数。
- ## 示例 — 完整配置或调用示例（代码块），必要时加注释。`,

  E: `### 模板 E：模块分析
适用于"整体架构是什么"、"模块间怎么交互"、"数据流怎么走"等设计类问题。

- **1 句话概括整体设计（不加标题）。**
- ## 结构设计 — 优先使用 mermaid 图，说明分层或核心组件。
- ## 核心流程 — 关键数据流或调用链，说明数据流转和关键节点。
- ## 模块关系 — 依赖关系或通信方式，跨边界时注意接口约定。`,
};

function selectTemplate(intent?: string, domain?: string): string {
  const map: Record<string, string> = {
    'what-is_general': 'B', 'where-is_general': 'B', 'how-to_general': 'D',
    'why-error_general': 'A', 'what-structure_general': 'E', 'what-impact_general': 'E',
    'why-error_stack-analysis': 'A', 'why-error_build-issue': 'A', 'why-error_bug-analysis': 'C',
    'what-is_bug-analysis': 'C', 'log-analysis': 'A',
  };
  const key = intent && domain ? `${intent}_${domain}` : `${domain || 'general'}`;
  const selected = map[key] || map[`${intent}_general`] || map[domain || ''] || 'B';
  return TEMPLATES[selected] || TEMPLATES.B;
}

export function structureGuide(intent?: string, domain?: Domain): string {
  const tpl = selectTemplate(intent, domain);
  return `## 回答模板

请参考以下模板来组织回答。**答复的第一句话必须加粗，作为摘要。**

${tpl}`;
}

// ── Language helpers ─────────────────────────────────────────

export function hasChinese(text: string): boolean {
  return /[一-鿿]/.test(text);
}

export function buildSearchQuery(question: string, translation: string): string {
  return question + ' ' + translation;
}

export async function translateToEnglish(question: string, llmConfig: any): Promise<string> {
  try {
    const baseUrl = llmConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const authHeaders =
      llmConfig.provider === 'azure'
        ? { 'api-key': llmConfig.apiKey }
        : { Authorization: 'Bearer ' + llmConfig.apiKey };
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: 'Translate Chinese to English search keywords for code. Keep English names unchanged. Return ONLY keywords.' },
          { role: 'user', content: question },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
    });
    if (!res.ok) return '';
    const data = (await res.json()) as any;
    return data?.choices?.[0]?.message?.content?.trim() || '';
  } catch {
    return '';
  }
}
