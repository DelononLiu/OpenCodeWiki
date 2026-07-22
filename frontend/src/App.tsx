import { Routes, Route } from 'react-router-dom'
import { LayoutProvider } from '@/contexts/LayoutContext'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { HomePage } from '@/pages/HomePage'
import { WikiGlobalPage } from '@/pages/WikiGlobalPage'
import { QAPage } from '@/pages/QAPage'
import { AdminPage } from '@/pages/AdminPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SourcesPage } from '@/pages/SourcesPage'

export default function App() {
  return (
    <LayoutProvider>
      <div className="h-screen flex overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/wiki/:name" element={<WikiGlobalPage />} />
            <Route path="/wiki" element={<WikiGlobalPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/qa/*" element={<QAPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/sources" element={<SourcesPage />} />
          </Routes>
        </div>
      </div>
    </LayoutProvider>
  )
}
