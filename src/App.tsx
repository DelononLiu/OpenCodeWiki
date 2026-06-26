import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import HomePage from '@/core/pages/HomePage'
import TaskPage from '@/core/pages/TaskPage'
import { AuthPage } from '@/core/components/AuthPage'
import { AuthGuard } from '@/core/components/AuthGuard'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/" element={<AuthGuard><HomePage /></AuthGuard>} />
        <Route path="/tasks/:id" element={<AuthGuard><TaskPage /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
