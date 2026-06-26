const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export class ApiError extends Error {
  constructor(public code: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`
  const { headers: optHeaders, ...rest } = options || {}
  const res = await fetch(url, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(optHeaders as Record<string, string>) },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.message || `Request failed: ${res.status}`)
  }

  return res.json()
}

export const api = {
  get: <T>(path: string, options?: RequestInit) => request<T>(path, { method: 'GET', ...options }),
  post: <T>(path: string, body?: unknown, options?: RequestInit) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, ...options }),
  upload: <T>(path: string, file: File, onProgress?: (pct: number) => void) => {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE_URL}${path}`)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          reject(new ApiError(xhr.status, 'Upload failed'))
        }
      }

      xhr.onerror = () => reject(new ApiError(0, 'Network error'))
      const formData = new FormData()
      formData.append('file', file)
      xhr.send(formData)
    })
  },
}
