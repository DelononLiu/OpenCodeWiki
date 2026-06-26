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

const FW_CONFIG: Record<string, { label: string; color: string }> = {
  tensorrt: { label: 'TensorRT', color: '#9333ea' },
  openvino: { label: 'OpenVINO', color: '#f97316' },
}

export function FrameworkSwitch({ frameworks, selected, onChange }: Props) {
  if (frameworks.length <= 1) return null

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">框架</span>
      <Select value={selected} onValueChange={onChange}>
        <SelectTrigger className="w-32 h-7 text-xs bg-card border-muted">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {frameworks.map((fw) => {
            const cfg = FW_CONFIG[fw]
            return (
              <SelectItem key={fw} value={fw} className="text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg?.color }} />
                  {cfg?.label || fw}
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
