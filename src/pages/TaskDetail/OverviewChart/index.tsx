import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts'
import type { FrameworkResult } from '@/types'
import { getFrameworkColor } from '@/utils/color'

interface Props {
  comparisons: FrameworkResult[]
}

export function OverviewChart({ comparisons }: Props) {
  const barData = comparisons.map((c) => ({
    name: c.framework.name,
    通过层数: c.overallMetrics.passedLayers,
    失败层数: c.overallMetrics.failedLayers,
  }))

  const radarData = [
    {
      metric: '余弦相似度',
      ...Object.fromEntries(
        comparisons.map((c) => [c.framework.name, c.overallMetrics.avgCosineSimilarity])
      ),
    },
    {
      metric: '通过率',
      ...Object.fromEntries(
        comparisons.map((c) => [
          c.framework.name,
          c.overallMetrics.totalLayers > 0
            ? c.overallMetrics.passedLayers / c.overallMetrics.totalLayers
            : 0,
        ])
      ),
    },
  ]

  if (comparisons.length === 0) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">层数对比</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData}>
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="通过层数" fill="#52c41a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="失败层数" fill="#ff4d4f" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">精度维度雷达图</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="metric" fontSize={12} />
              <PolarRadiusAxis angle={30} domain={[0.9, 1]} fontSize={10} />
              <Tooltip />
              {comparisons.map((c) => (
                <Radar
                  key={c.framework.id}
                  name={c.framework.name}
                  dataKey={c.framework.name}
                  stroke={getFrameworkColor(c.framework.id)}
                  fill={getFrameworkColor(c.framework.id)}
                  fillOpacity={0.2}
                />
              ))}
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
