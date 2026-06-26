import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { FRAMEWORKS } from '@/types'
import { cn } from '@/lib/utils'

interface Props {
  selected: string[]
  onChange: (frameworks: string[]) => void
}

export function FrameworkSelector({ selected, onChange }: Props) {
  const handleChange = (value: string, checked: boolean) => {
    if (checked) {
      onChange([...selected, value])
    } else {
      onChange(selected.filter((v) => v !== value))
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">选择推理框架</h3>
      <div className="space-y-2">
        {FRAMEWORKS.map((fw) => {
          const isBaseline = fw.isBaseline
          const checked = selected.includes(fw.value)
          return (
            <div
              key={fw.id}
              className={cn(
                'flex items-center gap-3 px-4 py-3 border rounded-md transition-colors',
                checked ? 'border-primary bg-primary/5' : 'border-border',
                isBaseline ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
              )}
              onClick={() => !isBaseline && handleChange(fw.value, !checked)}
            >
              <Checkbox
                checked={checked}
                disabled={isBaseline}
                onCheckedChange={(val) => handleChange(fw.value, val === true)}
              />
              <div className="flex-1 flex items-center gap-2">
                <span className="text-sm font-medium">{fw.name}</span>
                {isBaseline && <Badge variant="default">基准</Badge>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
