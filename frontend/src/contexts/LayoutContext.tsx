import { createContext, useContext, useState, ReactNode } from 'react'

export type TabType = 'read' | 'qa' | 'wiki' | 'manage' | null

interface DrawerContent {
  title: string
  items: { id: string; label: string; icon?: string; onClick?: () => void; active?: boolean }[]
}

interface LayoutContextValue {
  activeTab: TabType
  setActiveTab: (tab: TabType) => void
  drawerOpen: boolean
  toggleDrawer: () => void
  closeDrawer: () => void
  drawerContent: DrawerContent
  setDrawerContent: (content: DrawerContent) => void
}

const LayoutContext = createContext<LayoutContextValue>({
  activeTab: null,
  setActiveTab: () => {},
  drawerOpen: false,
  toggleDrawer: () => {},
  closeDrawer: () => {},
  drawerContent: { title: '', items: [] },
  setDrawerContent: () => {},
})

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabType>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerContent, setDrawerContent] = useState<DrawerContent>({ title: '', items: [] })

  const toggleDrawer = () => setDrawerOpen(o => !o)
  const closeDrawer = () => setDrawerOpen(false)

  return (
    <LayoutContext.Provider value={{
      activeTab, setActiveTab,
      drawerOpen, toggleDrawer, closeDrawer,
      drawerContent, setDrawerContent,
    }}>
      {children}
    </LayoutContext.Provider>
  )
}

export const useLayout = () => useContext(LayoutContext)
