export type ModelFormat = 'onnx'

export interface ModelFile {
  id: string
  name: string
  format: ModelFormat
  size: number
  uploadTime: string
}

export interface UploadProgress {
  percent: number
  fileName: string
  status: 'uploading' | 'done' | 'error'
}
