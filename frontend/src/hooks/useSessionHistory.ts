import { useState, useEffect, useCallback } from 'react'

export function useSessionHistory() {
  const [sessionList, setSessionList] = useState<any[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')

  const fetchSessionList = useCallback(() => {
    fetch('/api/sessions').then(r => r.json()).then(d => {
      if (d.ok) setSessionList(d.data.sessions || [])
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchSessionList() }, [fetchSessionList])

  return { sessionList, activeSessionId, setActiveSessionId, fetchSessionList }
}
