import { useState, useCallback, useRef } from 'react'
import type { QASource } from '@/types/opencodewiki'

interface UseCodeKnoraSSEReturn {
  answer: string
  sources: QASource[]
  streaming: boolean
  error: string | null
  sessionId: string | null
  ask: (kbId: string, question: string) => Promise<void>
  reset: () => void
}

export function useCodeKnoraSSE(): UseCodeKnoraSSEReturn {
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<QASource[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    setAnswer('')
    setSources([])
    setError(null)
  }, [])

  const ask = useCallback(async (kbId: string, question: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    reset()
    setStreaming(true)
    setError(null)

    try {
      const response = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kb_id: kbId, question }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))
            switch (eventType) {
              case 'token':
                setAnswer(prev => prev + data.text)
                break
              case 'sources':
                setSources(data)
                break
              case 'done':
                setSessionId(data.session_id)
                break
              case 'error':
                setError(data.message)
                break
            }
            eventType = ''
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setStreaming(false)
    }
  }, [reset])

  return { answer, sources, streaming, error, sessionId, ask, reset }
}
