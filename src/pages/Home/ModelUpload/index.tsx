import { useState, useRef, useCallback } from 'react'
import { Upload, Typography, Progress } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import type { ModelFile, UploadProgress } from '@/types'
import { uploadModel } from '@/api/model'

const { Dragger } = Upload
const { Text } = Typography

interface Props {
  onUploaded: (model: ModelFile) => void
}

export function ModelUpload({ onUploaded }: Props) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const cancelRef = useRef(false)

  const handleUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.onnx')) {
      // Allow .onnx only for MVP
      return
    }

    cancelRef.current = false
    setUploading(true)
    setProgress({ percent: 0, fileName: file.name, status: 'uploading' })

    try {
      const model = await uploadModel(file, (pct) => {
        if (!cancelRef.current) {
          setProgress({ percent: pct, fileName: file.name, status: 'uploading' })
        }
      })
      setProgress({ percent: 100, fileName: file.name, status: 'done' })
      onUploaded(model)
    } catch {
      setProgress({ percent: 0, fileName: file.name, status: 'error' })
    } finally {
      setUploading(false)
    }
  }, [onUploaded])

  return (
    <div>
      <Dragger
        accept=".onnx"
        showUploadList={false}
        beforeUpload={(file) => {
          handleUpload(file)
          return false
        }}
        disabled={uploading}
        style={{ background: '#fafafa', borderRadius: 8 }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">拖拽 ONNX 模型到此处，或点击选择</p>
        <p className="ant-upload-hint" style={{ color: '#999' }}>
          支持 .onnx 格式
        </p>
      </Dragger>

      {progress && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text ellipsis style={{ maxWidth: 300 }}>{progress.fileName}</Text>
            <Text type={progress.status === 'error' ? 'danger' : 'secondary'}>
              {progress.status === 'done' ? '✅ 上传完成' : progress.status === 'error' ? '上传失败' : '上传中...'}
            </Text>
          </div>
          <Progress
            percent={progress.percent}
            status={progress.status === 'error' ? 'exception' : 'active'}
            strokeColor={progress.status === 'done' ? '#52c41a' : undefined}
            size="small"
          />
        </div>
      )}
    </div>
  )
}
