import { api } from './client'
import { mockApi } from './mock/handlers'
import type { ModelFile } from '@/types'

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

export async function uploadModel(file: File, onProgress?: (pct: number) => void): Promise<ModelFile> {
  if (USE_MOCK) {
    return mockApi.uploadModel(file, onProgress)
  }

  const token = localStorage.getItem('token')
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files/upload')

    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        reject(new Error('Upload failed'))
      }
    }

    xhr.onerror = () => reject(new Error('Network error'))
    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}
