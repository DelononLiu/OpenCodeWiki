import { Outlet } from 'react-router-dom'
import { ConfigProvider, Layout as AntLayout, theme } from 'antd'
import { Header } from './Header'
import { useUIStore } from '@/stores/uiStore'

const { Content } = AntLayout

export function Layout() {
  const uiTheme = useUIStore((s) => s.theme)

  return (
    <ConfigProvider
      theme={{
        algorithm: uiTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
        },
      }}
    >
      <AntLayout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <Header />
        <Content style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <Outlet />
        </Content>
      </AntLayout>
    </ConfigProvider>
  )
}
