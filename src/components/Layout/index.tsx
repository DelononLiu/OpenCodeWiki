import { Outlet } from 'react-router-dom'
import { Header } from './Header'

export function Layout() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-5 max-w-7xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
