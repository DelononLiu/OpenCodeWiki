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

const chartTheme = {
  text: '#a1a1aa',
  grid: '#27272a',
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card className="border-muted">
        <CardHeader className="pb-2 pt-3.5 px-3.5">
          <CardTitle className="text-xs font-medium text-muted-foreground">层数对比</CardTitle>
        </CardHeader>
        <CardContent className="p-0 px-2 pb-2">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={barData}>
              <XAxis dataKey="name" fontSize={11} tick={{ fill: chartTheme.text }} axisLine={false} tickLine={false} />
              <YAxis fontSize={11} tick={{ fill: chartTheme.text }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#e4e4e7' }}
              />
              <Bar dataKey="通过层数" fill="#22c55e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="失败层数" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardHeader className="pb-2 pt-3.5 px-3.5">
          <CardTitle className="text-xs font-medium text-muted-foreground">精度维度雷达图</CardTitle>
        </CardHeader>
        <CardContent className="p-0 px-2 pb-2">
          <ResponsiveContainer width="100%" height={210}>
            <RadarChart data={radarData}>
              <PolarGrid stroke={chartTheme.grid} />
              <PolarAngleAxis dataKey="metric" fontSize={11} tick={{ fill: chartTheme.text }} />
              <PolarRadiusAxis angle={30} domain={[0.9, 1]} fontSize={10} tick={{ fill: chartTheme.text }} />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 6, fontSize: 12 }}
              />
              {comparisons.map((c) => (
                <Radar
                  key={c.framework.id}
                  name={c.framework.name}
                  dataKey={c.framework.name}
                  stroke={getFrameworkColor(c.framework.id)}
                  fill={getFrameworkColor(c.framework.id)}
                  fillOpacity={0.15}
                />
              ))}
            </RadarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
