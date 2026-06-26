import { Select, Typography } from 'antd'

const { Text } = Typography

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Text type="secondary">框架：</Text>
      <Select
        value={selected}
        onChange={onChange}
        style={{ width: 140 }}
        options={frameworks.map((fw) => ({
          value: fw,
          label: FW_LABELS[fw] || fw,
        }))}
      />
    </div>
  )
}
