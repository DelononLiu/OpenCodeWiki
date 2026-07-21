import { useState, useEffect, useCallback } from 'react'
import { useLayout } from '@/contexts/LayoutContext'

export function useSessionHistory() {
  const { setDrawerContent } = useLayout()
  const [sessionList, setSessionList] = useState<any[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')

  const fetchSessionList = useCallback(() => {
    fetch('/api/sessions').then(r => r.json()).then(d => {
      if (d.ok) setSessionList(d.data.sessions || [])
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchSessionList() }, [fetchSessionList])

  useEffect(() => {
    setDrawerContent({
      title: '历史问答',
      items: sessionList.map((sl: any) => ({
        id: sl.session_id,
        label: sl.root_question || '新对话',
        icon: undefined,
        active: sl.session_id === activeSessionId,
        onClick: () => {
          // navigate to QA page with session
          window.location.href = `/qa?session=${sl.session_id}`
        },
      })),
    })
  }, [sessionList, activeSessionId])

  return { fetchSessionList, setActiveSessionId }
}
