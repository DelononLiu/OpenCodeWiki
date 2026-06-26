import type { LayerDiff, ComparisonTask } from '@/types'

export const MOCK_TASKS = [
  { id: 'task-001', name: 'resnet50_v1',   model: 'resnet50.onnx',      date: '2026-06-26 14:30', status: 'completed' as const, accuracy: '✓ 完美通过', progress: 100 },
  { id: 'task-002', name: 'yolov8_test',    model: 'yolov8s.onnx',       date: '2026-06-26 11:20', status: 'completed' as const, accuracy: '⚠ 精度超标', progress: 100 },
  { id: 'task-003', name: 'bert_base_eval', model: 'bert_base.onnx',     date: '2026-06-25 09:15', status: 'failed' as const,    accuracy: '✗ 推理失败', progress: 62 },
]
export const MOCK_RECENT = MOCK_TASKS

export const MOCK_LAYERS_ALL_PASS: LayerDiff[] = [
  { layerName: 'conv_1', layerType: 'Conv', inputShape: [1,3,224,224], outputShape: [1,64,112,112], metrics: [
    { frameworkId: 'tensorrt', cosineSimilarity: 0.999998, maxAbsError: 0.000012, meanAbsError: 0.000003, relativeError: 0.000005, snr: 42.3, passed: true },
    { frameworkId: 'openvino', cosineSimilarity: 0.999997, maxAbsError: 0.000018, meanAbsError: 0.000004, relativeError: 0.000007, snr: 41.1, passed: true },
  ]},
  { layerName: 'conv_2', layerType: 'Conv', inputShape: [1,64,112,112], outputShape: [1,64,112,112], metrics: [
    { frameworkId: 'tensorrt', cosineSimilarity: 0.999999, maxAbsError: 0.000008, meanAbsError: 0.000002, relativeError: 0.000003, snr: 44.8, passed: true },
    { frameworkId: 'openvino', cosineSimilarity: 0.999998, maxAbsError: 0.000011, meanAbsError: 0.000003, relativeError: 0.000004, snr: 43.2, passed: true },
  ]},
  { layerName: 'fc_output', layerType: 'Gemm', inputShape: [1,2048], outputShape: [1,1000], metrics: [
    { frameworkId: 'tensorrt', cosineSimilarity: 0.999996, maxAbsError: 0.000021, meanAbsError: 0.000005, relativeError: 0.000008, snr: 40.5, passed: true },
    { frameworkId: 'openvino', cosineSimilarity: 0.999995, maxAbsError: 0.000025, meanAbsError: 0.000006, relativeError: 0.000010, snr: 39.8, passed: true },
  ]},
]

export const MOCK_LAYERS_HAS_FAIL: LayerDiff[] = [
  { layerName: 'conv_1', layerType: 'Conv', inputShape: [1,3,224,224], outputShape: [1,64,112,112], metrics: [
    { frameworkId: 'tensorrt', cosineSimilarity: 0.999998, maxAbsError: 0.000012, meanAbsError: 0.000003, relativeError: 0.000005, snr: 42.3, passed: true },
    { frameworkId: 'openvino', cosineSimilarity: 0.999997, maxAbsError: 0.000018, meanAbsError: 0.000004, relativeError: 0.000007, snr: 41.1, passed: true },
  ]},
  { layerName: 'conv_23', layerType: 'Conv', inputShape: [1,512,14,14], outputShape: [1,512,14,14], metrics: [
    { frameworkId: 'tensorrt', cosineSimilarity: 0.912300, maxAbsError: 0.215000, meanAbsError: 0.087600, relativeError: 0.123400, snr: 3.2, passed: false },
    { frameworkId: 'openvino', cosineSimilarity: 0.895600, maxAbsError: 0.242000, meanAbsError: 0.094300, relativeError: 0.135700, snr: 2.8, passed: false },
  ]},
  { layerName: 'fc_output', layerType: 'Gemm', inputShape: [1,2048], outputShape: [1,1000], metrics: [
    { frameworkId: 'tensorrt', cosineSimilarity: 0.999996, maxAbsError: 0.000021, meanAbsError: 0.000005, relativeError: 0.000008, snr: 40.5, passed: true },
    { frameworkId: 'openvino', cosineSimilarity: 0.999995, maxAbsError: 0.000025, meanAbsError: 0.000006, relativeError: 0.000010, snr: 39.8, passed: true },
  ]},
]

export function buildMockTask(name: string, status: 'completed' | 'failed', passed: number, total: number): ComparisonTask {
  const allPass = total === passed
  return {
    id: `mock-${name}`, frameworks: ['onnxruntime', 'tensorrt', 'openvino'], status, progress: status === 'completed' ? 100 : 62,
    createdAt: '2026-06-26T14:30:00Z',
    model: { id: 'mock-model', name: `${name}.onnx`, format: 'onnx', size: 47185920, uploadTime: '2026-06-26T14:30:00Z' },
    baseline: null,
    comparisons: [
      { framework: { id: 'tensorrt', name: 'TensorRT', value: 'tensorrt' },
        overallMetrics: { totalLayers: total, passedLayers: passed, failedLayers: total - passed, avgCosineSimilarity: allPass ? 0.999997 : 0.956, maxAbsError: allPass ? 0.000015 : 0.215, worstLayer: allPass ? null : 'conv_23' } },
      { framework: { id: 'openvino', name: 'OpenVINO', value: 'openvino' },
        overallMetrics: { totalLayers: total, passedLayers: passed, failedLayers: total - passed, avgCosineSimilarity: allPass ? 0.999996 : 0.943, maxAbsError: allPass ? 0.000018 : 0.242, worstLayer: allPass ? null : 'conv_23' } },
    ],
  }
}
