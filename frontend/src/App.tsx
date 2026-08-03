import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { LayoutProvider } from '@/contexts/LayoutContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { WikiGlobalPage } from '@/pages/WikiGlobalPage'
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth()
  if (loading) return null
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function Shell() {
  return (
    <LayoutProvider>
      <div className="h-screen flex overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={<RequireAuth><Navigate to="/qa" replace /></RequireAuth>} />
            <Route path="/wiki/:name" element={<RequireAuth><WikiGlobalPage /></RequireAuth>} />
            <Route path="/wiki" element={<RequireAuth><WikiGlobalPage /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
            <Route path="/qa" element={<RequireAuth><QAPageRoute /></RequireAuth>} />
            <Route path="/qa/:sessionId" element={<RequireAuth><QAPageRoute /></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
            <Route path="/sources" element={<RequireAuth><SourcesPage /></RequireAuth>} />
            <Route path="/cards" element={<RequireAuth><CardsPage /></RequireAuth>} />
            <Route path="/fragments" element={<RequireAuth><FragmentsPage /></RequireAuth>} />
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
