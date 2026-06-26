import { mockApi } from './mock/handlers'

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

export async function uploadModel(file: File, onProgress?: (pct: number) => void) {
  if (USE_MOCK) {
    return mockApi.uploadModel(file, onProgress)
  }
  // TODO: 对接真实上传 API
  throw new Error('Real API not implemented')
}
