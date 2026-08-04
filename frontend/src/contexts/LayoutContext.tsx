import { createContext, useContext, useState, ReactNode } from 'react'

export type TabType = 'qa' | 'knowledge' | 'fragments' | 'cards' | null

interface LayoutContextValue {
  activeTab: TabType
  setActiveTab: (tab: TabType) => void
}

const LayoutContext = createContext<LayoutContextValue>({
  activeTab: null,
  setActiveTab: () => {},
})

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabType>(null)

  return (
    <LayoutContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </LayoutContext.Provider>
  )
}

export const useLayout = () => useContext(LayoutContext)
