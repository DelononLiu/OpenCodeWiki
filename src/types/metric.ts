export type MetricType =
  | 'cosine_similarity'
  | 'max_abs_error'
  | 'mean_abs_error'
  | 'relative_error'
  | 'snr'

export interface MetricDefinition {
  type: MetricType
  label: string
  unit?: string
  higherIsBetter: boolean
  threshold: number
}

export const METRIC_DEFINITIONS: Record<MetricType, MetricDefinition> = {
  cosine_similarity: { type: 'cosine_similarity', label: '余弦相似度', higherIsBetter: true, threshold: 0.99 },
  max_abs_error: { type: 'max_abs_error', label: '最大绝对误差', higherIsBetter: false, threshold: 0.01 },
  mean_abs_error: { type: 'mean_abs_error', label: '平均绝对误差', higherIsBetter: false, threshold: 0.005 },
  relative_error: { type: 'relative_error', label: '相对误差', higherIsBetter: false, threshold: 0.05 },
  snr: { type: 'snr', label: '信噪比', unit: 'dB', higherIsBetter: true, threshold: 20 },
}
