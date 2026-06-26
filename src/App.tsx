import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import HomePage from '@/pages/Home'
import TaskDetailPage from '@/pages/TaskDetail'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/task/:id" element={<TaskDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
