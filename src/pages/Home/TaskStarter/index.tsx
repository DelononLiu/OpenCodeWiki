import { AlertCircle, Info, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

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
      <Alert variant="info">
        <Info className="h-4 w-4" />
        <AlertDescription>请先上传模型</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-3">
      {!hasFrameworks && (
        <Alert variant="warning">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            请至少选择一个推理框架（ONNX Runtime 基准已自动选择）
          </AlertDescription>
        </Alert>
      )}
      <Button
        size="lg"
        disabled={disabled || loading}
        onClick={onClick}
        className="w-full h-12 text-base gap-2"
      >
        {loading ? (
          <>
            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
            正在创建任务...
          </>
        ) : (
          <>
            <Zap className="h-5 w-5" />
            开始精度比对
          </>
        )}
      </Button>
    </div>
  )
}
