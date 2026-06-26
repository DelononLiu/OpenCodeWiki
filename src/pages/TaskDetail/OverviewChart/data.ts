import type { LayerDiff } from '@/types'

export function getScatterData(layers: LayerDiff[], frameworkId: string) {
  return layers
    .map((l) => {
      const m = l.metrics.find((m) => m.frameworkId === frameworkId)
      return m ? { name: l.layerName, cosine: m.cosineSimilarity, error: m.maxAbsError } : null
    })
    .filter(Boolean)
}
