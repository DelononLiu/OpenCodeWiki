export interface ApiResponse<T> {
  code: number
  data: T
  message?: string
}

export interface UploadResponse {
  fileId: string
  uploadUrl: string
}

export interface TaskCreateResponse {
  taskId: string
}
