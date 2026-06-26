import { Drawer, Typography, Descriptions, Tag, Table } from 'antd'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ScatterChart, Scatter, Legend,
} from 'recharts'
import type { LayerDiff, LayerMetric } from '@/types'
import { METRIC_DEFINITIONS } from '@/types'
import { getFrameworkColor, diffToColor } from '@/utils/color'
import { formatMetricValue } from '@/utils/metric'

const { Text, Title } = Typography

interface Props {
  layer: LayerDiff | null
  open: boolean
  onClose: () => void
}

export function LayerDetail({ layer, open, onClose }: Props) {
  if (!layer) return null

  // Framework comparison table data
  const fwCompareColumns = [
    {
      title: '框架',
      dataIndex: 'frameworkId',
      key: 'frameworkId',
      render: (id: string) => (
        <Tag color={getFrameworkColor(id)}>{id === 'tensorrt' ? 'TensorRT' : id === 'openvino' ? 'OpenVINO' : id}</Tag>
      ),
    },
    {
      title: '余弦相似度',
      dataIndex: 'cosineSimilarity',
      key: 'cosine',
      render: (v: number) => (
        <Text style={{ color: diffToColor(v, 0.99), fontFamily: 'monospace' }}>
          {v.toFixed(6)}
        </Text>
      ),
    },
    {
      title: '最大绝对误差',
      dataIndex: 'maxAbsError',
      key: 'maxError',
      render: (v: number) => (
        <Text style={{ fontFamily: 'monospace' }}>{v.toExponential(4)}</Text>
      ),
    },
    {
      title: '信噪比',
      dataIndex: 'snr',
      key: 'snr',
      render: (v: number) => (
        <Text style={{ fontFamily: 'monospace' }}>{v.toFixed(1)} dB</Text>
      ),
    },
    {
      title: '结果',
      dataIndex: 'passed',
      key: 'passed',
      render: (v: boolean) => v ? <Tag color="success">通过</Tag> : <Tag color="error">失败</Tag>,
    },
  ]

  // Scatter data for output comparison (simulated)
  const generateComparisonData = (metric: LayerMetric) => {
    return Array.from({ length: 50 }, (_, i) => ({
      x: i,
      baseline: Math.sin(i * 0.3) + 0.5,
      compare: Math.sin(i * 0.3 + (1 - metric.cosineSimilarity) * 2) + 0.5,
    }))
  }

  const mainMetric = layer.metrics[0]
  const scatterData = mainMetric ? generateComparisonData(mainMetric) : []

  return (
    <Drawer
      title={
        <div>
          <Text strong style={{ fontSize: 16 }}>{layer.layerName}</Text>
          <Tag style={{ marginLeft: 8 }} color="default">{layer.layerType}</Tag>
        </div>
      }
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
    >
      {/* Layer info */}
      <Descriptions column={2} size="small" bordered style={{ marginBottom: 24 }}>
        <Descriptions.Item label="输入形状">[{layer.inputShape.join(', ')}]</Descriptions.Item>
        <Descriptions.Item label="输出形状">[{layer.outputShape.join(', ')}]</Descriptions.Item>
      </Descriptions>

      {/* Accuracy metrics for this layer */}
      <Title level={5}>精度指标</Title>
      {layer.metrics.map((m) => (
        <div key={m.frameworkId} style={{ marginBottom: 20 }}>
          <Text strong style={{ color: getFrameworkColor(m.frameworkId) }}>
            {m.frameworkId === 'tensorrt' ? 'TensorRT' : m.frameworkId === 'openvino' ? 'OpenVINO' : m.frameworkId}
          </Text>
          <br /><br />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {Object.entries(METRIC_DEFINITIONS).map(([key, def]) => {
              const value = (m as any)[key] as number
              const passed = def.higherIsBetter ? value >= def.threshold : value <= def.threshold
              return (
                <div key={key} style={{
                  padding: '8px 12px',
                  background: passed ? '#f6ffed' : '#fff2f0',
                  borderRadius: 6,
                  border: `1px solid ${passed ? '#b7eb8f' : '#ffccc7'}`,
                }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{def.label}</Text>
                  <div>
                    <Text style={{
                      fontFamily: 'monospace',
                      fontSize: 16,
                      fontWeight: 600,
                      color: passed ? '#52c41a' : '#ff4d4f',
                    }}>
                      {formatMetricValue(key as any, value)}
                    </Text>
                    {def.unit && (
                      <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>{def.unit}</Text>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Framework comparison table */}
      <Title level={5} style={{ marginTop: 24 }}>框架对比</Title>
      <Table
        dataSource={layer.metrics.map((m) => ({ ...m, key: m.frameworkId }))}
        columns={fwCompareColumns}
        pagination={false}
        size="small"
      />

      {/* Output comparison chart */}
      {scatterData.length > 0 && (
        <>
          <Title level={5} style={{ marginTop: 24 }}>输出值对比（采样）</Title>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="x" />
              <YAxis domain={[-0.5, 1.5]} />
              <Tooltip />
              <Legend />
              <Scatter name="ONNX Runtime (基准)" data={scatterData} dataKey="baseline" fill="#1677ff" line />
              <Scatter name="对比框架" data={scatterData} dataKey="compare" fill="#ff4d4f" line />
            </ScatterChart>
          </ResponsiveContainer>
        </>
      )}
    </Drawer>
  )
}
