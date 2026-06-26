import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { FRAMEWORKS } from '@/types'
import { cn } from '@/lib/utils'

interface Props {
  selected: string[]
  onChange: (frameworks: string[]) => void
}

const FW_COLORS: Record<string, string> = {
  onnxruntime: 'border-framework-onnx/30 data-[checked=true]:border-framework-onnx',
  tensorrt: 'border-framework-tensorrt/30 data-[checked=true]:border-framework-tensorrt',
  openvino: 'border-framework-openvino/30 data-[checked=true]:border-framework-openvino',
}

export function FrameworkSelector({ selected, onChange }: Props) {
  const handleChange = (value: string, checked: boolean) => {
    if (checked) onChange([...selected, value])
    else onChange(selected.filter((v) => v !== value))
  }

  return (
    <div className="space-y-2">
      {FRAMEWORKS.map((fw) => {
        const isBaseline = fw.isBaseline
        const checked = selected.includes(fw.value)
        return (
          <div
            key={fw.id}
            data-checked={checked}
            className={cn(
              'flex items-center gap-3 px-3.5 py-2.5 rounded-md border transition-all',
              FW_COLORS[fw.value],
              checked ? 'bg-accent' : 'bg-card',
              isBaseline ? 'cursor-default' : 'cursor-pointer hover:bg-accent/80'
            )}
            onClick={() => !isBaseline && handleChange(fw.value, !checked)}
          >
            <Checkbox
              checked={checked}
              disabled={isBaseline}
              onCheckedChange={(val) => handleChange(fw.value, val === true)}
            />
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <span className="text-sm">{fw.name}</span>
              {isBaseline && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-primary/40 text-primary">基准</Badge>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
