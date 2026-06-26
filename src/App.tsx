import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import HomePage from '@/core/pages/HomePage'
import TaskPage from '@/core/pages/TaskPage'
import { AuthPage } from '@/core/components/AuthPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/tasks/:id" element={<TaskPage />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
