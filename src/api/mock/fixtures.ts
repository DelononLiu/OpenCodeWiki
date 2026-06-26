import type { ComparisonTask, LayerDiff, OverallMetrics, ModelFile } from '@/types'

export const MOCK_MODEL: ModelFile = {
  id: 'model-001',
  name: 'resnet50.onnx',
  format: 'onnx',
  size: 102_761_024,
  uploadTime: new Date().toISOString(),
}

export const MOCK_TENSORRT_METRICS: OverallMetrics = {
  totalLayers: 128,
  passedLayers: 120,
  failedLayers: 8,
  avgCosineSimilarity: 0.997,
  maxAbsError: 0.123,
  worstLayer: 'fc_out',
}

export const MOCK_OPENVINO_METRICS: OverallMetrics = {
  totalLayers: 128,
  passedLayers: 115,
  failedLayers: 13,
  avgCosineSimilarity: 0.982,
  maxAbsError: 0.156,
  worstLayer: 'fc_out',
}

function generateMockLayerDiffs(): LayerDiff[] {
  const layerTypes = ['Conv', 'Relu', 'BatchNorm', 'MaxPool', 'Gemm', 'Add', 'Flatten', 'Softmax']
  const names: string[] = []
  for (let i = 0; i < 128; i++) {
    const type = layerTypes[Math.floor(Math.random() * layerTypes.length)]
    names.push(`${type.toLowerCase()}_${type}_${i}`)
  }

  return names.map((name, i) => {
    const cosineSimilarity = i < 120
      ? 0.995 + Math.random() * 0.005
      : 0.7 + Math.random() * 0.25
    const maxAbsError = i < 120
      ? Math.random() * 0.01
      : 0.01 + Math.random() * 0.12
    const meanAbsError = maxAbsError * (0.3 + Math.random() * 0.4)

    return {
      layerName: name,
      layerType: name.split('_')[0],
      inputShape: [1, 64, 56, 56],
      outputShape: [1, 64, 56, 56],
      metrics: [
        {
          frameworkId: 'tensorrt',
          cosineSimilarity,
          maxAbsError,
          meanAbsError,
          relativeError: maxAbsError / 2,
          snr: 20 + Math.random() * 30,
          passed: cosineSimilarity >= 0.99,
        },
        {
          frameworkId: 'openvino',
          cosineSimilarity: Math.max(0.7, cosineSimilarity - Math.random() * 0.03),
          maxAbsError: maxAbsError * (1 + Math.random() * 0.5),
          meanAbsError: meanAbsError * (1 + Math.random() * 0.5),
          relativeError: maxAbsError / 2 * (1 + Math.random() * 0.5),
          snr: 15 + Math.random() * 25,
          passed: cosineSimilarity >= 0.97,
        },
      ],
    }
  })
}

export const MOCK_LAYER_DIFFS = generateMockLayerDiffs()

export const MOCK_TASK: ComparisonTask = {
  id: 'task-001',
  model: MOCK_MODEL,
  frameworks: ['tensorrt', 'openvino'],
  status: 'completed',
  progress: 100,
  createdAt: new Date(Date.now() - 60000).toISOString(),
  completedAt: new Date().toISOString(),
  baseline: null,
  comparisons: [
    { framework: { id: 'tensorrt', name: 'TensorRT', value: 'tensorrt' }, overallMetrics: MOCK_TENSORRT_METRICS },
    { framework: { id: 'openvino', name: 'OpenVINO', value: 'openvino' }, overallMetrics: MOCK_OPENVINO_METRICS },
  ],
}
