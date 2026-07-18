import { Routes, Route } from 'react-router-dom'
import { HomePage } from '@/pages/HomePage'
import { WikiGlobalPage } from '@/pages/WikiGlobalPage'
import { WikiPage } from '@/pages/WikiPage'
import { QAPage } from '@/pages/QAPage'
import { AdminPage } from '@/pages/AdminPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SourcesPage } from '@/pages/SourcesPage'

export default function App() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/wiki" element={<WikiGlobalPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/:repo" element={<WikiPage />} />
        <Route path="/qa" element={<QAPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/sources" element={<SourcesPage />} />
      </Routes>
    </div>
  )
}
