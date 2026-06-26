import { Card, Statistic, Row, Col, Spin } from 'antd'
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PercentageOutlined,
} from '@ant-design/icons'
import type { OverallMetrics } from '@/types'

interface Props {
  metrics: OverallMetrics | null
  loading: boolean
}

export function SummaryBar({ metrics, loading }: Props) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin size="large" />
        <p style={{ marginTop: 12, color: '#999' }}>正在分析精度数据...</p>
      </div>
    )
  }

  if (!metrics) return null

  const passRate = metrics.totalLayers > 0
    ? ((metrics.passedLayers / metrics.totalLayers) * 100).toFixed(1)
    : '0'

  return (
    <Row gutter={16}>
      <Col span={6}>
        <Card>
          <Statistic
            title="总层数"
            value={metrics.totalLayers}
            prefix={<ApartmentOutlined style={{ color: '#1677ff' }} />}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="通过"
            value={metrics.passedLayers}
            valueStyle={{ color: '#52c41a' }}
            prefix={<CheckCircleOutlined />}
            suffix={`/ ${metrics.totalLayers}`}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="失败"
            value={metrics.failedLayers}
            valueStyle={{ color: metrics.failedLayers > 0 ? '#ff4d4f' : '#52c41a' }}
            prefix={<CloseCircleOutlined />}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="平均余弦相似度"
            value={metrics.avgCosineSimilarity}
            valueStyle={{ color: metrics.avgCosineSimilarity >= 0.99 ? '#52c41a' : '#faad14' }}
            prefix={<PercentageOutlined />}
            precision={4}
          />
        </Card>
      </Col>
    </Row>
  )
}
