# 调研07：AI 应用侧边栏 UI 模式分析

> 日期：2026-08-04　用途：为 OpenCodeWiki 侧边栏重构提供行业依据

## 背景问题

OpenCodeWiki 当前侧边栏承载了 6 个平铺导航项（新问题/我的碎片/Wiki/知识沉淀/知识卡片/知识库）+ 知识库下拉 + Wiki 文档树 + 主题列表 + 历史问答 + 设置/用户，观感接近管理后台而非 AI 应用。调研主流 AI 应用（ChatGPT / Claude / Perplexity / Notion / Obsidian）的侧边栏常规做法，提炼可落地的原则。

## 主流产品模式对比

| 产品 | 侧边栏主体 | 导航策略 | 来源 |
|------|-----------|---------|------|
| ChatGPT | 会话历史（Recents） | 顶部"New Chat"主按钮；设置/账户收敛在角落；功能入口极少 | OpenAI 官方帮助中心 |
| Claude | 会话历史 + Projects | 官方设计指南要求"最小化框架元素、用可折叠侧边栏"；Projects 作为知识/工作区入口放侧边栏 | Claude 官方设计指南 / Help Center |
| Perplexity | Library（历史）+ Spaces | Spaces 作为独立工作区（含自定义指令）放侧边栏 | Perplexity Help Center |
| Notion | 页面树（内容本身） | 2026-03 官方更新专门处理"侧边栏太挤"：改为四个可开关的 tab | Notion 官方发布说明 |
| Obsidian | 文件树（内容） | 左栏=内容标签（文件浏览器），右栏=上下文面板；功能入口图标化 | Obsidian 官方帮助 |

## 2026 年各产品现状（补充核实）

| 产品 | 2026 年现状 | 来源 |
|------|-----------|------|
| ChatGPT 桌面版（2026-07） | Chat/Work/Codex 合一，顶部切换；官方发布说明强调"更易找到对话与 Projects"；库/项目按钮移出侧边栏主体 | OpenAI Release Notes |
| Claude Cowork（2026） | 项目 = 侧边栏中的工作区（挂载文件夹 + 指令 + 记忆），"Select a project in the sidebar" | Claude 官方文档 |
| Perplexity（2025-12） | 官方 changelog：Library（历史会话）移到侧边栏菜单顶部，hover 展开书签与最近对话 | Perplexity 官方 changelog |
| Gemini（2026-05 重设计） | 导航抽屉改为全屏界面，仅 New chat / Search chats / Library / Gems 四项；账户切换器移到抽屉底部 | 9to5Google（媒体） |
| Cursor（2026） | Agent 集中在侧边栏；右面板可全屏，聊天可折叠为浮动提示栏 | Cursor 官方 changelog/blog |
| Notion（2026-03） | 侧边栏重设计为四个可开关的 tab，官方明说"sidebar was getting far too crowded" | Notion 官方发布说明 |

## 知识型 AI 产品（QA × 知识库）的侧边栏模式

本项目不是纯聊天应用，而是"QA 问答 → Topic 聚合 → Wiki 固化"的混合形态，需参考知识型 AI 产品：

| 产品 | 布局 | 核心机制 | 来源 |
|------|------|---------|------|
| NotebookLM | 左=Sources 面板，中=Chat，右=Studio | 知识容器（来源）就是左侧栏内容；对话是主内容区；输出/生成在右侧面板 | Google 官方帮助 |
| Onyx（原 Danswer） | ChatGPT 式聊天 + 企业知识库 | "Think ChatGPT if it had access to your team's unique knowledge"；知识作为问答上下文而非导航 | 官方 GitHub |
| Mem | 笔记 + Chat，右侧上下文面板 | 问答自动聚合相关笔记，上下文以右侧面板呈现 | Mem 官方博客/帮助 |
| Glean | 搜索为入口，侧边栏按需唤起（Cmd+J） | 搜索/问答从任意页面侧边栏唤起，不占常驻导航 | Glean 官方文档 |
| Coda AI | 文档树为主体，AI 对话在文档侧面板 | 知识（文档）是主体，对话是伴随面板 | Coda 官方指南 |

结论：**知识容器（来源/文件树/项目）就是侧边栏内容，对话是主内容区或伴随面板，管理功能不占侧边栏主体。** NotebookLM 的"左 Sources + 中 Chat + 右 Studio"与本项目的业务闭环形态最接近。

## 行业常规结论

1. **侧边栏放"内容"，不放"功能导航"。** ChatGPT/Claude 的侧边栏主体是会话历史，Notion/Obsidian 是页面/文件树。导航是手段，内容才是侧边栏存在的理由。
2. **全局功能入口收敛到 3 个以内，管理功能下沉。** 核心场景（问答、知识浏览、个人沉淀）平级展示；设置、账户、管理类功能收到底部图标或用户菜单（ChatGPT 的 Settings 在角落、Notion 的回收站/设置收在底部）。
3. **主场景要有明确 CTA。** 对话类应用普遍在侧边栏顶部放"新建对话"（New Chat）按钮，视觉权重高于普通导航项（OpenAI 帮助中心：start a new chat by selecting New Chat）。
4. **上下文相关的内容用可折叠面板/抽屉承载。** Claude 官方设计指南明确："Use collapsible sidebars, tabs or pagination to disclose details"，避免常驻面板占据主内容区。
5. **输入框是 AI 应用的视觉中心。** NN/g 对 GenAI 聊天界面的分析把 prompt 控件定义为"环绕输入框的 UI"，说明设计重心在输入与对话本身，而非导航框架。

2026 年各产品迭代后，上述原则不仅没变，反而更极端：ChatGPT 桌面版把库/项目入口移出侧边栏主体，Gemini 抽屉收敛到 4 项且账户下沉到底部，Perplexity 把历史提到侧边栏顶部。即"导航收敛 + 内容侧栏 + 管理下沉"是 2026 年仍在强化的方向。

## 对 OpenCodeWiki 的启示

现状对照：

- 6 个平铺导航项中，`/admin`（知识沉淀/审批）和 `/sources`（知识库）是管理/配置功能，与核心 AI 场景平级——违反原则 2。
- 没有主 CTA："新问题"只是普通 tab，且在 `/qa` 时点击不动作——违反原则 3。
- 会话历史、文档树挤在导航下方的狭小空间——违反原则 1/4。

建议的最小改动方向（不改路由、不改页面，只改 `AppSidebar.tsx`）：

1. 导航收敛为：问答（历史会话）/ Wiki（知识库+文档树+主题）/ 我的碎片 / 知识卡片（个人沉淀独立入口，不再有"我的"分组）。
2. 顶部加"新建问答"主按钮（视觉权重高于普通导航项）。
3. `/admin`、`/sources` 下沉到侧边栏底部用户菜单或设置弹窗。
4. 侧边栏主体按模式切换内容：QA 模式显示历史会话，知识模式显示文档树（现有分支逻辑已具备，导航变少后获得全部空间）。
5. 保留右侧 `ContentRightPanel`（Wiki 页目录/关联问答/来源引用）——已接近 NotebookLM 右侧面板模式。
6. 加分项（后续）：Cmd+K 命令面板、侧边栏宽度可调。

## 来源链接

- ChatGPT 首页（New Chat / 侧边栏历史）：https://help.openai.com/en/articles/9125172-the-chatgpt-home-page
- ChatGPT iOS FAQ（侧边栏 = Recents 历史列表）：https://help.openai.com/en/articles/7885016-chatgpt-ios-app-faq
- ChatGPT 删除/归档聊天（历史在侧边栏、设置单独入口）：https://help.openai.com/en/articles/8809935-how-to-delete-and-archive-chats-in-chatgpt
- Claude 设计指南（可折叠侧边栏、最小化框架）：https://claude.com/docs/connectors/building/mcp-apps/design-guidelines
- Claude Projects（侧边栏内的知识/工作区）：https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects
- Claude Cowork Projects 文档：https://claude.com/docs/cowork/guide/projects
- Perplexity Spaces：https://www.perplexity.ai/help-center/en/articles/10352961-what-are-spaces
- Notion 3.4 发布说明（侧边栏去拥挤化）：https://www.notion.com/releases/2026-03-26
- Obsidian 侧边栏帮助：https://obsidian.md/help/sidebar
- NN/g：Prompt Controls in GenAI Chatbots：https://www.nngroup.com/articles/prompt-controls-genai/
- OpenAI Release Notes（ChatGPT 桌面版 Chat/Work/Codex 整合，2026-07）：https://help.openai.com/en/articles/11391654-chatgpt-business
- Claude Cowork Projects 文档（侧边栏选择项目）：https://claude.com/docs/cowork/guide/projects
- Perplexity 官方 changelog（Library 移到侧边栏顶部，2025-12-05）：https://www.perplexity.ai/changelog/what-we-shipped---december-5th
- Gemini 2026 重设计（抽屉全屏、账户下沉底部）：https://9to5google.com/2026/05/03/gemini-full-redesign/
- Cursor 3.4 changelog（右侧面板全屏、聊天折叠为浮动提示栏）：https://cursor.com/zh-Hant/changelog/3-4
- Cursor 官方博客（Agent 集中在侧边栏）：https://cursor.com/en-US/blog/cursor-3
- NotebookLM 官方帮助（Chat/Studio 面板）：https://support.google.com/notebooklm/answer/16206563
- NotebookLM 官方帮助（Source 面板选择来源）：https://support.google.com/notebooklm/answer/16215270
- Onyx（原 Danswer）官方 GitHub：https://github.com/onyx-dot-app/onyx
- Mem 官方博客（Chat 聚合知识）：https://get.mem.ai/blog/mem-2-0-dev-update-smarter-chat
- Mem Help Center（右侧上下文面板）：https://help.mem.ai/features/heads-up
- Glean 官方文档（扩展侧边栏）：https://docs.glean.com/user-guide/apps/extension-sidebar
- Coda 官方指南（文档侧面板 AI 对话）：https://coda.io/resources/guides/how-to-get-started-with-coda-ai
