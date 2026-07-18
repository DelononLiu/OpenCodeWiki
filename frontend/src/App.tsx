import { Routes, Route } from 'react-router-dom'
import { HomePage } from '@/pages/HomePage'
import { WikiGlobalPage } from '@/pages/WikiGlobalPage'
import { WikiPage } from '@/pages/WikiPage'
import { QAPage } from '@/pages/QAPage'
import { AdminPage } from '@/pages/AdminPage'

export default function App() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/wiki" element={<WikiGlobalPage />} />
        <Route path="/:repo" element={<WikiPage />} />
        <Route path="/qa" element={<QAPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </div>
  )
}
