import { Button, Alert, Typography } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'

const { Text } = Typography

interface Props {
  modelUploaded: boolean
  hasFrameworks: boolean
  disabled: boolean
  loading: boolean
  onClick: () => void
}

export function TaskStarter({ modelUploaded, hasFrameworks, disabled, loading, onClick }: Props) {
  if (!modelUploaded) {
    return (
      <Alert
        message="请先上传模型"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
    )
  }

  return (
    <div>
      {!hasFrameworks && (
        <Alert
          message="请至少选择一个推理框架（ONNX Runtime 基准已自动选择）"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Button
        type="primary"
        size="large"
        icon={<ThunderboltOutlined />}
        disabled={disabled}
        loading={loading}
        onClick={onClick}
        block
        style={{ height: 48, fontSize: 16 }}
      >
        开始精度比对
      </Button>
    </div>
  )
}
