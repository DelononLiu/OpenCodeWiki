import type { MetricType } from '@/types'

export function formatMetricValue(type: MetricType, value: number): string {
  switch (type) {
    case 'cosine_similarity':
      return value.toFixed(6)
    case 'max_abs_error':
    case 'mean_abs_error':
    case 'relative_error':
      return value.toExponential(4)
    case 'snr':
      return `${value.toFixed(1)} dB`
    default:
      return String(value)
  }
}

export function getPassColor(passed: boolean, higherIsBetter: boolean, value: number, threshold: number): string {
  if (passed) return '#52c41a'
  return higherIsBetter && value < threshold ? '#ff4d4f' : '#faad14'
}
