export interface LayerDiff {
  layerName: string
  layerType: string
  inputShape: number[]
  outputShape: number[]
  metrics: LayerMetric[]
}

export interface LayerMetric {
  frameworkId: string
  cosineSimilarity: number
  maxAbsError: number
  meanAbsError: number
  relativeError: number
  snr: number
  passed: boolean
}
