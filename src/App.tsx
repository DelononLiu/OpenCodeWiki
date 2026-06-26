import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import HomePage from '@/core/pages/HomePage'
import TaskPage from '@/core/pages/TaskPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/tasks/:id" element={<TaskPage />} />
        {/* 旧入口兼容 */}
        <Route path="/tool" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
