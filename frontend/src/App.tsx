import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { LayoutProvider } from '@/contexts/LayoutContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { WikiGlobalPage } from '@/pages/WikiGlobalPage'
import { WikiNodePage } from '@/pages/WikiNodePage'
import { QAPage } from '@/pages/QAPage'
import { AdminPage } from '@/pages/AdminPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SourcesPage } from '@/pages/SourcesPage'
import { CardsPage } from '@/pages/CardsPage'
import { FragmentsPage } from '@/pages/FragmentsPage'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'

/** Wraps QAPage with a key based on sessionId so React Router
 *  creates a new component instance for each unique session path. */
function QAPageRoute() {
  const { sessionId } = useParams()
  const loc = useLocation()
  const navKey = `${sessionId || 'new'}-${loc.key}`
  return <QAPage key={navKey} />
}

/**
 * 壳分为两态：
 * - 未登录（或访问 /login、/register）：只渲染登录/注册页，不渲染侧边栏 ——
 *   避免无 token 时 AppSidebar 挂载并发出一批 401 请求。
 * - 已登录：完整壳（侧边栏 + 受保护路由）。
 */
function Shell() {
  const { token, loading } = useAuth()
  const location = useLocation()

  if (location.pathname === '/login' || location.pathname === '/register') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Routes>
    )
  }

  // 未登录：不渲染任何内容，直接重定向登录页
  if (loading) return null
  if (!token) return <Navigate to="/login" replace />

  return (
    <LayoutProvider>
      <div className="h-screen flex overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Routes>
            <Route path="/" element={<Navigate to="/qa" replace />} />
            <Route path="/wiki/:name" element={<WikiGlobalPage />} />
            <Route path="/wiki/node/:nodeId" element={<WikiNodePage />} />
            <Route path="/wiki" element={<WikiGlobalPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/qa" element={<QAPageRoute />} />
            <Route path="/qa/:sessionId" element={<QAPageRoute />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/cards" element={<CardsPage />} />
            <Route path="/fragments" element={<FragmentsPage />} />
          </Routes>
        </div>
      </div>
    </LayoutProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
