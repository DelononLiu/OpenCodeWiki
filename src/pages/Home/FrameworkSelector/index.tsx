import { Checkbox, Typography, Tag } from 'antd'
import { FRAMEWORKS } from '@/types'

const { Title } = Typography

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
      <Title level={5} style={{ marginBottom: 12 }}>选择推理框架</Title>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {FRAMEWORKS.map((fw) => {
          const isBaseline = fw.isBaseline
          const checked = selected.includes(fw.value)
          return (
            <div
              key={fw.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                border: `1px solid ${checked ? '#1677ff' : '#d9d9d9'}`,
                borderRadius: 6,
                background: checked ? '#f0f5ff' : '#fff',
                cursor: isBaseline ? 'not-allowed' : 'pointer',
                opacity: isBaseline ? 0.85 : 1,
              }}
              onClick={() => !isBaseline && handleChange(fw.value, !checked)}
            >
              <Checkbox
                checked={checked}
                disabled={isBaseline}
                onChange={(e) => handleChange(fw.value, e.target.checked)}
              />
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 500 }}>{fw.name}</span>
                {isBaseline && (
                  <Tag color="blue" style={{ marginLeft: 8 }}>基准</Tag>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
