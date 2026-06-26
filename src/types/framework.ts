export interface Framework {
  id: string
  name: string
  value: 'onnxruntime' | 'tensorrt' | 'openvino'
  version?: string
  isBaseline?: boolean
}

export const FRAMEWORKS: Framework[] = [
  { id: 'onnxruntime', name: 'ONNX Runtime', value: 'onnxruntime', isBaseline: true },
  { id: 'tensorrt', name: 'TensorRT', value: 'tensorrt' },
  { id: 'openvino', name: 'OpenVINO', value: 'openvino' },
]

export const BASELINE_FRAMEWORK = FRAMEWORKS[0]

export interface FrameworkResult {
  framework: Framework
  overallMetrics: OverallMetrics
}

export interface OverallMetrics {
  totalLayers: number
  passedLayers: number
  failedLayers: number
  avgCosineSimilarity: number
  maxAbsError: number
  worstLayer: string | null
}
