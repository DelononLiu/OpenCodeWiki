# ModelDiff — UI 设计方案

> 神经网络模型精度差异分析平台（MVP）

---

## Context

项目原为 OpenCodeWiki（代码问答），最新 commit 已清空。现在转型为 **ModelDiff**：用户上传 ONNX 模型，以 ONNX Runtime 为基准，比对 TensorRT 和 OpenVINO 的推理精度差异。

MVP 版本不做用户登录和历史任务管理，聚焦核心比对流程。

**设计核心原则：模块化。** AI Coding 在无边界的大文件/全局作用域中容易生成冲突代码。通过组件/页面/API 等明确分层，每个模块职责清晰、类型导出精准，AI 生成代码时只会影响自己的模块，不会污染其他地方。

---

## 1. 技术栈

| 层 | 技术 | 理由 |
|---|---|---|
| 框架 | React 18 + TypeScript | AI 对 React + JSX 最熟悉，出错率最低 |
| 构建 | Vite 5 | 零配置 TS/React 支持，HMR 极快 |
| UI 组件库 | Ant Design 5 | 中后台完备度最高（Table/Upload/Form/Progress 等直接覆盖 MVP 需求） |
| 图表 | ECharts 5 + echarts-for-react | 精度对比（柱状图/散点图/热力图/雷达图）开箱即用 |
| 状态管理 | Zustand | 最轻量的 React 状态库，TS 类型推导好，AI 写的代码模式稳定 |
| 路由 | React Router 6 | 标准方案 |
| HTTP | Axios | 拦截器/进度事件/取消请求支持完善 |

---

## 2. 路由设计

```
/                 → HomePage     模型上传 + 框架选择 + 开始任务
/task/:id         → TaskPage     任务详情（精度对比核心页）
```

MVP 只有 2 个路由。后续扩展（用户登录 → `/login`，历史任务 → `/history`）在现有结构上加路由即可，不影响已有模块。

---

## 3. 模块化目录结构

```
src/
├── types/                    # 类型定义（AI 生成的骨架，全局共享）
│   ├── model.ts              # ModelFile, ModelFormat, UploadProgress
│   ├── task.ts               # ComparisonTask, TaskStatus, TaskSummary
│   ├── framework.ts          # Framework, FrameworkResult
│   ├── layer.ts              # LayerDiff, LayerMetric, ComparisonDetail
│   ├── metric.ts             # AccuracyMetric, MetricType, MetricValue
│   └── api.ts                # API 请求/响应类型
│
├── api/                      # API 层（与后端解耦，可 mock）
│   ├── client.ts             # Axios 实例（baseURL/拦截器）
│   ├── model.ts              # 模型上传 API
│   ├── task.ts               # 任务创建/查询 API
│   └── mock/                 # Mock 数据（后端就绪前使用）
│       ├── handlers.ts       # MSW 或简易 mock 处理
│       └── fixtures.ts       # 示例数据
│
├── pages/                    # 页面级组件（每个页面一个独立模块）
│   ├── Home/
│   │   ├── index.tsx          # 页面容器
│   │   ├── ModelUpload/       # 模型上传模块
│   │   │   ├── index.tsx
│   │   │   └── types.ts
│   │   ├── FrameworkSelector/ # 框架选择模块
│   │   │   ├── index.tsx
│   │   │   └── constants.ts   # 框架列表
│   │   └── TaskStarter/       # 启动任务模块
│   │       └── index.tsx
│   │
│   └── TaskDetail/            # 核心页面模块
│       ├── index.tsx          # 页面容器（布局 + 状态管理）
│       ├── SummaryBar/        # 顶部概览指标卡模块
│       │   ├── index.tsx
│       │   └── MetricCard.tsx # 单个指标卡
│       ├── OverviewChart/     # 整体精度对比图模块
│       │   ├── index.tsx
│       │   ├── MetricRadar.tsx # 雷达图（多维指标）
│       │   └── MetricBar.tsx   # 柱状图（框架间对比）
│       ├── LayerTable/        # 层精度列表模块
│       │   ├── index.tsx      # Ant Design Table + 排序/筛选
│       │   ├── LayerRow.tsx   # 自定义行渲染（展开/收起）
│       │   └── columns.tsx    # 表格列定义
│       ├── LayerDetail/       # 层详情面板模块
│       │   ├── index.tsx      # Drawer 展示
│       │   ├── MetricGrid.tsx # 该层的多维指标
│       │   ├── WeightChart.tsx # 权重分布直方图
│       │   └── OutputChart.tsx # 输出值散点图对比
│       └── FrameworkSwitch/   # 框架切换模块
│           └── index.tsx
│
├── components/                # 跨页面通用组件
│   ├── Layout/
│   │   ├── index.tsx          # 整体布局（Header + Content + Footer）
│   │   ├── Header.tsx         # 顶栏（logo + 导航 + 主题切换）
│   │   └── Footer.tsx
│   ├── StatusTag/             # 任务状态标签
│   │   └── index.tsx
│   └── EmptyState/            # 空状态展示
│       └── index.tsx
│
├── hooks/                     # 自定义 hooks（可复用逻辑）
│   ├── useUpload.ts           # 模型上传逻辑（进度/取消）
│   ├── useTask.ts             # 任务轮询/查询
│   └── useLayerDetail.ts      # 层详情加载
│
├── stores/                    # Zustand 全局状态
│   ├── taskStore.ts           # 当前任务状态（taskId / status / results）
│   └── uiStore.ts             # UI 状态（侧边栏/主题等）
│
├── utils/                     # 纯函数工具
│   ├── metric.ts              # 精度指标计算/格式化
│   └── color.ts               # 差异程度→颜色映射
│
├── App.tsx                    # 根组件（路由定义）
└── main.tsx                   # 入口
```

### 模块化原则

1. **每个模块一个文件夹**，index.tsx 导出公共接口，内部组件不对外暴露
2. **类型独立**：types/ 目录集中管理，任何模块引用类型都从 types/ import，不让 AI 在各模块重复定义
3. **API 隔离**：api/ 层统一处理请求，页面组件不直接调 axios/fetch
4. **Mock 驱动**：后端还没实现时，api/mock/ 提供完整示例数据，UI 完全可运行和调试

---

## 4. 核心类型定义

### types/model.ts

```typescript
export type ModelFormat = 'onnx'

export interface ModelFile {
  id: string
  name: string
  format: ModelFormat
  size: number         // bytes
  uploadTime: string   // ISO
}
```

### types/framework.ts

```typescript
export interface Framework {
  id: string
  name: string           // 显示名称
  value: string          // 枚举值 'onnxruntime' | 'tensorrt' | 'openvino'
  version?: string
  isBaseline?: boolean   // ONNX Runtime = baseline
}
```

### types/task.ts

```typescript
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface ComparisonTask {
  id: string
  model: ModelFile
  frameworks: string[]    // 要比对的框架 value 列表
  status: TaskStatus
  progress?: number       // 0-100
  createdAt: string
  completedAt?: string
  baseline: FrameworkResult
  comparisons: FrameworkResult[]
}
```

### types/layer.ts

```typescript
export interface LayerDiff {
  layerName: string
  layerType: string       // Conv, Relu, Gemm, etc.
  inputShape: number[]
  outputShape: number[]
  metrics: LayerMetric[]  // 每个框架 vs 基准的指标
}

export interface LayerMetric {
  frameworkId: string
  cosineSimilarity: number     // 余弦相似度
  maxAbsError: number          // 最大绝对误差
  meanAbsError: number         // 平均绝对误差
  relativeError: number        // 相对误差
  snr: number                  // 信噪比
  passed: boolean              // 是否通过阈值
}
```

### types/metric.ts

```typescript
export type MetricType =
  | 'cosine_similarity'
  | 'max_abs_error'
  | 'mean_abs_error'
  | 'relative_error'
  | 'snr'

export interface MetricDefinition {
  type: MetricType
  label: string           // "余弦相似度"
  unit?: string           // "%", "dB"
  higherIsBetter: boolean // true=越大越好, false=越小越好
  threshold: number       // 合格阈值
}

export interface OverallMetrics {
  totalLayers: number
  passedLayers: number
  failedLayers: number
  avgCosineSimilarity: number
  maxAbsError: number
  frameworkId: string
}
```

### types/api.ts

```typescript
export interface ApiResponse<T> {
  code: number
  data: T
  message?: string
}

export interface UploadResponse {
  fileId: string
  uploadUrl: string
}
```

---

## 5. 页面设计

### 5.1 首页 - HomePage (`/`)

布局：Header (logo + 导航) + 居中内容区

```
┌─────────────────────────────────────┐
│  [Logo] ModelDiff      [主题切换]    │  ← Header
├─────────────────────────────────────┤
│                                     │
│   ┌─ 上传模型 ──────────────────┐   │
│   │                             │   │
│   │   📦 拖拽上传或点击选择      │   │  ← ModelUpload
│   │   支持的格式: .onnx          │   │
│   │                             │   │
│   │   [已上传: resnet50.onnx ✓] │   │
│   └─────────────────────────────┘   │
│                                     │
│   ┌─ 选择推理框架 ─────────────┐   │
│   │                             │   │
│   │  ☑ ONNX Runtime (基准)     │   │  ← FrameworkSelector
│   │  ☑ TensorRT                 │   │
│   │  ☑ OpenVINO                 │   │
│   │                             │   │
│   └─────────────────────────────┘   │
│                                     │
│   [🚀 开始精度比对]                  │  ← TaskStarter
│                                     │
└─────────────────────────────────────┘
```

交互逻辑：
- 拖拽/点击上传模型 → 显示文件名、格式、大小
- ONNX Runtime 自动勾选且不可取消（基准强制）
- TensorRT/OpenVINO 可勾选 1 个或 2 个
- 点击"开始精度比对" → 跳转到任务详情页
- 上传中有进度条

### 5.2 任务详情页 - TaskPage (`/task/:id`)

#### 5.2.1 顶部概览区

```
┌─────────────────────────────────────────────┐
│  🔄 任务运行中 (65%)        [重新比对] [导出] │
│                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │ 总层数 │ │ 通过 │ │ 失败 │ │ 平均  │       │  ← SummaryBar
│  │  128  │ │  120 │ │  8   │ │0.997 │       │
│  └──────┘ └──────┘ └──────┘ └──────┘       │
└─────────────────────────────────────────────┘
```

#### 5.2.2 框架精度概览

```
┌─────────────────────────────────────────────┐
│  精度概览                                     │
│                                              │
│    ┌─────────────────────────────────┐      │
│    │    雷达图/柱状图                  │      │  ← OverviewChart
│    │    TensorRT ── OpenVINO          │      │
│    │    在余弦相似度等维度上的对比      │      │
│    └─────────────────────────────────┘      │
│                                              │
│  ┌──────────────┐  ┌──────────────┐          │
│  │ TensorRT     │  │ OpenVINO     │          │  ← Framework cards
│  │ 通过: 120/128│  │ 通过: 115/128│          │
│  │ 平均: 0.997  │  │ 平均: 0.982  │          │
│  │ 最差层: ...  │  │ 最差层: ...  │          │
│  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────┘
```

交互：点击框架卡片 → 切换表格数据为该框架视角

#### 5.2.3 层精度对比表格

```
┌─────────────────────────────────────────────┐
│  层精度对比  [框架: TensorRT ▼]              │
│                                              │
│  ┌────────┬──────┬──────┬──────┬──────┬────┐│
│  │ 层名    │ 类型  │ 余弦  │ 最大   │ 结果 │ ││  ← LayerTable
│  ├────────┼──────┼──────┼──────┼──────┼────┤│
│  │ conv1  │ Conv │0.9999│1.2e-5│ ✅   │ ││
│  │ conv2  │ Conv │0.8921│4.5e-2│ ❌   │ ││  ← 点击行展开详情
│  │ relu1  │ Relu │1.0000│0.0   │ ✅   │ ││
│  │ fc_out │ Gemm │0.7211│0.123 │ ❌   │ ││
│  └────────┴──────┴──────┴──────┴──────┴────┘│
│                                              │
│  ⚠ conv2: 余弦相似度 0.89，低于阈值 0.99     │
└─────────────────────────────────────────────┘
```

交互逻辑：
- 每行代表一个层
- 列可排序（按余弦相似度升序/降序快速定位差异层）
- 点击行 → 右侧 Drawer 展开层详情
- 差异较大的行自动标红
- 顶部的框架切换下拉 → 切换查看不同框架的层结果

#### 5.2.4 层详情面板 (Drawer)

```
┌──────────────────┐
│ conv2 详情     ✕ │
├──────────────────┤
│ 类型: Conv2d    │
│ 输入: [1,3,224]│
│ 输出: [1,64,112]│
│                  │
│ ─ 精度指标 ─     │
│                  │
│ 余弦相似度  │0.892│  ← MetricGrid
│ 最大绝对误差 │0.045│      (红色不合格)
│ 平均绝对误差 │0.012│
│ 信噪比      │18.3dB│
│                  │
│ ─ 框架对比 ─     │
│                  │
│ ┌────┬────────┐ │
│ │框架│余弦相似度│ │
│ ├────┼────────┤ │
│ │TRT │ 0.892  │ │
│ │OV  │ 0.914  │ │
│ └────┴────────┘ │
│                  │
│ ─ 输出分布 ─     │
│                  │
│  [直方图对比]    │  ← OutputChart
│  蓝: ONNX RT    │
│  红: TensorRT   │
└──────────────────┘
```

---

## 6. 状态管理设计

### taskStore (Zustand)

```typescript
interface TaskState {
  // 当前任务
  currentTaskId: string | null
  task: ComparisonTask | null
  status: TaskStatus
  
  // 层数据
  layers: LayerDiff[]
  selectedLayer: string | null
  selectedFramework: string // 当前查看的框架
  
  // 操作
  createTask: (modelId: string, frameworks: string[]) => Promise<void>
  pollTask: (taskId: string) => Promise<void>
  setSelectedLayer: (layerName: string) => void
  setSelectedFramework: (framework: string) => void
  reset: () => void
}
```

### uiStore (Zustand)

```typescript
interface UIState {
  sidebarCollapsed: boolean
  theme: 'light' | 'dark'
  toggleSidebar: () => void
  toggleTheme: () => void
}
```

---

## 7. API 层设计

```typescript
POST /api/upload          → 上传模型文件
POST /api/tasks           → 创建精度比对任务 { modelId, frameworks }
GET  /api/tasks/:id       → 查询任务状态/结果
GET  /api/tasks/:id/layers → 获取层级别精度数据
```

API 模块结构：

```typescript
// api/model.ts
export async function uploadModel(
  file: File,
  onProgress?: (pct: number) => void
): Promise<ModelFile>

// api/task.ts
export async function createTask(
  params: CreateTaskParams
): Promise<ComparisonTask>

export async function getTask(
  taskId: string
): Promise<ComparisonTask>

export async function getTaskLayers(
  taskId: string,
  framework?: string
): Promise<LayerDiff[]>
```

---

## 8. 视觉风格

| 属性 | 值 |
|---|---|
| 主色 | #1677ff (Ant Design 蓝) |
| 通过色 | #52c41a (绿) |
| 警告/失败色 | #ff4d4f (红) |
| 基准线 | #1677ff （ONNX Runtime） |
| TensorRT 色 | #722ed1 (紫) |
| OpenVINO 色 | #fa8c16 (橙) |
| 字体 | Inter / system-ui |
| 圆角 | 6-8px |

---

## 9. 状态与异常处理

| 状态 | 展示 |
|---|---|
| 空状态 | 首页：引导上传模型的插图+文字 |
| 上传中 | 进度条 + 文件 Chip（可取消） |
| 运行中 | 顶部进度条 + skeleton loading |
| 完成 | 数字/图表正常展示 |
| 失败 | Alert 展示失败原因 + 重试按钮 |
| 空数据 | "该层无输出数据" 提示 |
| 网络错误 | 全局 ErrorBoundary fallback |

---

## 10. 实施步骤

### Phase 1: 项目初始化
1. `npm create vite model-diff -- --template react-ts`
2. 安装 Ant Design, ECharts, React Router, Zustand, Axios
3. 搭建 types/ 目录（所有类型定义）
4. 搭建 api/mock/ 目录（mock 数据 + 延迟模拟）
5. 搭建 Layout 组件（Header + 内容区）

### Phase 2: 首页模块
1. ModelUpload 组件（拖拽上传 + 进度条）
2. FrameworkSelector 组件（复选框列表）
3. TaskStarter 组件（启动按钮 + 跳转）
4. 路由配置

### Phase 3: 任务详情页模块
1. SummaryBar（4 个指标卡）
2. OverviewChart（雷达图 + 柱状图）
3. LayerTable（可排序/展开的表格）
4. FrameworkSwitch（框架切换下拉）

### Phase 4: 层详情模块
1. LayerDetail Drawer
2. MetricGrid（该层各指标列表）
3. OutputChart（输出分布直方图对比）

### Phase 5: 联调打磨
1. API 对接真实后端
2. 异常状态完善
3. 视觉微调

---

## 11. 验证方式

1. **开发阶段**：`npm run dev` 启动，mock 数据驱动，所有 UI 可交互操作
2. **类型安全**：`npx tsc --noEmit` 确保类型正确
3. **模块隔离验证**：修改某个组件的 props，其他组件不报错
4. **路由验证**：访问 `/` 显示上传页，mock 创建任务后跳转到 `/task/:id` 显示详情页
5. **AI 生成验证**：在模块边界清晰的前提下，让 AI 生成新组件，检查是否只影响本模块
