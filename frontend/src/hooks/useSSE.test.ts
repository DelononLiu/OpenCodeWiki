import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSSE } from './useSSE'

function createMockStream(chunks: string[]) {
  let index = 0
  const reader = {
    read: vi.fn().mockImplementation(() => {
      if (index < chunks.length) {
        const chunk = chunks[index]
        index++
        return Promise.resolve({ done: false, value: new TextEncoder().encode(chunk) })
      }
      return Promise.resolve({ done: true, value: undefined })
    }),
  }
  return {
    body: { getReader: () => reader },
    ok: true,
    json: () => Promise.resolve({}),
  }
}

describe('useSSE', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should start with idle state', () => {
    const { result } = renderHook(() => useSSE())
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should handle SSE stream messages', async () => {
    const mockResp = createMockStream([
      'data: {"type":"token","content":"Hello"}\n',
      'data: {"type":"done"}\n',
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResp as unknown as Response)

    const { result } = renderHook(() => useSSE())
    const messages: unknown[] = []

    act(() => {
      result.current.stream('/api/qa', { question: 'test' }, (msg) => {
        messages.push(msg)
      })
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(messages.length).toBe(2)
    expect(messages[0]).toMatchObject({ type: 'token', content: 'Hello' })
    expect(messages[1]).toMatchObject({ type: 'done' })
    expect(result.current.error).toBeNull()
  })

  it('should set error on failed response', async () => {
    const mockResp = {
      ok: false,
      json: () => Promise.resolve({ error: 'Server error' }),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResp as unknown as Response)

    const { result } = renderHook(() => useSSE())
    const messages: unknown[] = []

    act(() => {
      result.current.stream('/api/qa', { question: 'test' }, (msg) => {
        messages.push(msg)
      })
    })

    await waitFor(() => {
      expect(result.current.error).toBe('Server error')
    })
  })

  it('should abort stream', async () => {
    const abortSpy = vi.fn()
    const mockResp = {
      body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
      ok: true,
      json: () => Promise.resolve({}),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResp as unknown as Response)
    vi.spyOn(AbortController.prototype, 'abort').mockImplementation(abortSpy)

    const { result } = renderHook(() => useSSE())

    act(() => {
      result.current.stream('/api/qa', { question: 'test' }, () => {})
    })

    act(() => {
      result.current.abort()
    })

    expect(abortSpy).toHaveBeenCalled()
  })

  it('should handle malformed SSE lines', async () => {
    const mockResp = createMockStream([
      'data: {"type":"token","content":"OK"}\n',
      'not data line\n',
      'data: malformed json\n',
      'data: {"type":"done"}\n',
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResp as unknown as Response)

    const { result } = renderHook(() => useSSE())
    const messages: unknown[] = []

    act(() => {
      result.current.stream('/api/qa', { question: 'test' }, (msg) => {
        messages.push(msg)
      })
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Should have 2 valid messages, skip malformed ones
    expect(messages.filter((m: any) => m.type === 'token').length).toBe(1)
    expect(messages.filter((m: any) => m.type === 'done').length).toBe(1)
  })
})
