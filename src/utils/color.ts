const FRAMEWORK_COLORS: Record<string, string> = {
  onnxruntime: '#1677ff',
  tensorrt: '#722ed1',
  openvino: '#fa8c16',
}

export function getFrameworkColor(frameworkId: string): string {
  return FRAMEWORK_COLORS[frameworkId] || '#666'
}

export function diffToColor(value: number, threshold: number): string {
  if (value >= threshold) return '#52c41a'
  if (value >= threshold * 0.9) return '#faad14'
  return '#ff4d4f'
}
