import { useState, useRef, useCallback } from 'react'

export interface SSEMessage {
  type: 'token' | 'session' | 'sources' | 'error' | 'done'
  [key: string]: unknown
}

export function useSSE() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stream = useCallback(async (
    url: string,
    body: unknown,
    onMessage: (msg: SSEMessage) => void,
  ) => {
    setIsLoading(true)
    setError(null)
    abortRef.current = new AbortController()

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      })

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(errBody.error || `HTTP ${resp.status}`)
      }

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          try {
            const data = JSON.parse(trimmed.slice(6))
            onMessage(data)
          } catch { /* skip malformed */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
        onMessage({ type: 'error', message: err.message })
      }
    } finally {
      setIsLoading(false)
      abortRef.current = null
    }
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { stream, abort, isLoading, error }
}
