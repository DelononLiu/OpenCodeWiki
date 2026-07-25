import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { LayoutProvider } from '@/contexts/LayoutContext'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { WikiGlobalPage } from '@/pages/WikiGlobalPage'
import { QAPage } from '@/pages/QAPage'
import { AdminPage } from '@/pages/AdminPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SourcesPage } from '@/pages/SourcesPage'

/** Wraps QAPage with a key based on sessionId so React Router
 *  creates a new component instance for each unique session path. */
function QAPageRoute() {
  const { sessionId } = useParams()
  const loc = useLocation()
  const navKey = `${sessionId || 'new'}-${loc.key}`
  return <QAPage key={navKey} />
}

export default function App() {
  return (
    <LayoutProvider>
      <div className="h-screen flex overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Routes>
            <Route path="/" element={<Navigate to="/qa" replace />} />
            <Route path="/wiki/:name" element={<WikiGlobalPage />} />
            <Route path="/wiki" element={<WikiGlobalPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/qa" element={<QAPageRoute />} />
            <Route path="/qa/:sessionId" element={<QAPageRoute />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/sources" element={<SourcesPage />} />
          </Routes>
        </div>
      </div>
    </LayoutProvider>
  )
}
