import { Outlet } from 'react-router-dom'
import { Header } from './Header'

export function Layout() {
  return (
    <div className="min-h-screen bg-muted/30">
      <Header />
      <main className="p-6 max-w-7xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
