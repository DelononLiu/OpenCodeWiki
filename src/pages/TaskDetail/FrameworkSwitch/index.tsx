import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  frameworks: string[]
  selected: string
  onChange: (fw: string) => void
}

const FW_LABELS: Record<string, string> = {
  tensorrt: 'TensorRT',
  openvino: 'OpenVINO',
}

export function FrameworkSwitch({ frameworks, selected, onChange }: Props) {
  if (frameworks.length <= 1) return null

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">框架：</span>
      <Select value={selected} onValueChange={onChange}>
        <SelectTrigger className="w-36 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {frameworks.map((fw) => (
            <SelectItem key={fw} value={fw} className="text-xs">
              {FW_LABELS[fw] || fw}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
