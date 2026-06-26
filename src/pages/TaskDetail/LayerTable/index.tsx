import { Table, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { LayerDiff } from '@/types'
import { getFrameworkColor, diffToColor } from '@/utils/color'

const { Text } = Typography

interface Props {
  layers: LayerDiff[]
  frameworkId: string
  loading: boolean
  onSelectLayer: (layer: LayerDiff) => void
  selectedLayerName: string | null
}

export function LayerTable({ layers, frameworkId, loading, onSelectLayer, selectedLayerName }: Props) {
  const columns = [
    {
      title: '层名',
      dataIndex: 'layerName',
      key: 'layerName',
      width: 200,
      render: (name: string, record: LayerDiff) => (
        <div>
          <Text style={{ fontWeight: 500 }}>{name}</Text>
          <Tag style={{ marginLeft: 8 }} color="default">{record.layerType}</Tag>
        </div>
      ),
    },
    {
      title: '输入形状',
      dataIndex: 'inputShape',
      key: 'inputShape',
      width: 140,
      render: (shape: number[]) => `[${shape.join(', ')}]`,
      responsive: ['lg' as const],
    },
    {
      title: '输出形状',
      dataIndex: 'outputShape',
      key: 'outputShape',
      width: 140,
      render: (shape: number[]) => `[${shape.join(', ')}]`,
      responsive: ['lg' as const],
    },
    {
      title: '余弦相似度',
      key: 'cosine',
      width: 130,
      sorter: (a: LayerDiff, b: LayerDiff) => {
        const ma = a.metrics.find((m) => m.frameworkId === frameworkId)
        const mb = b.metrics.find((m) => m.frameworkId === frameworkId)
        return (ma?.cosineSimilarity ?? 0) - (mb?.cosineSimilarity ?? 0)
      },
      render: (_: unknown, record: LayerDiff) => {
        const m = record.metrics.find((m) => m.frameworkId === frameworkId)
        if (!m) return '-'
        return (
          <Text style={{ color: diffToColor(m.cosineSimilarity, 0.99), fontFamily: 'monospace' }}>
            {m.cosineSimilarity.toFixed(6)}
          </Text>
        )
      },
    },
    {
      title: '最大绝对误差',
      key: 'maxError',
      width: 140,
      sorter: (a: LayerDiff, b: LayerDiff) => {
        const ma = a.metrics.find((m) => m.frameworkId === frameworkId)
        const mb = b.metrics.find((m) => m.frameworkId === frameworkId)
        return (ma?.maxAbsError ?? 0) - (mb?.maxAbsError ?? 0)
      },
      render: (_: unknown, record: LayerDiff) => {
        const m = record.metrics.find((m) => m.frameworkId === frameworkId)
        if (!m) return '-'
        return (
          <Text style={{ fontFamily: 'monospace', color: m.maxAbsError > 0.01 ? '#ff4d4f' : undefined }}>
            {m.maxAbsError.toExponential(4)}
          </Text>
        )
      },
    },
    {
      title: '信噪比',
      key: 'snr',
      width: 100,
      responsive: ['lg' as const],
      render: (_: unknown, record: LayerDiff) => {
        const m = record.metrics.find((m) => m.frameworkId === frameworkId)
        if (!m) return '-'
        return <Text style={{ fontFamily: 'monospace' }}>{m.snr.toFixed(1)} dB</Text>
      },
    },
    {
      title: '结果',
      key: 'passed',
      width: 80,
      render: (_: unknown, record: LayerDiff) => {
        const m = record.metrics.find((m) => m.frameworkId === frameworkId)
        if (!m) return '-'
        return m.passed
          ? <Tag color="success">通过</Tag>
          : <Tag color="error">失败</Tag>
      },
    },
  ]

  return (
    <Table
      dataSource={layers}
      columns={columns}
      rowKey="layerName"
      loading={loading}
      size="small"
      pagination={{ pageSize: 20, showSizeChanger: false }}
      rowClassName={(record) =>
        record.layerName === selectedLayerName ? 'ant-table-row-selected' : ''
      }
      onRow={(record) => ({
        onClick: () => onSelectLayer(record),
        style: {
          cursor: 'pointer',
          background: record.layerName === selectedLayerName ? '#e6f4ff' : undefined,
        },
      })}
      scroll={{ y: 480 }}
    />
  )
}
