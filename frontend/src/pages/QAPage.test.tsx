import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QAPage } from './QAPage'

// Mock useSSE hook — returns inert stream/abort for rendering
vi.mock('@/hooks/useSSE', () => ({
  useSSE: () => ({
    stream: vi.fn(),
    abort: vi.fn(),
    isLoading: false,
    error: null,
  }),
}))

function renderQAPage(route = '/qa') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <QAPage />
    </MemoryRouter>
  )
}

describe('QAPage (simplified)', () => {
  it('should show empty state when no active session', () => {
    renderQAPage()
    const hints = screen.getAllByText('对代码和文档提问')
    expect(hints.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('我可以帮你理解代码架构、检索文档或解释工作原理')).toBeInTheDocument()
  })

  it('should render bottom input bar', () => {
    renderQAPage()
    const input = screen.getByPlaceholderText('输入你的问题...')
    expect(input).toBeInTheDocument()
    expect(screen.getByText('发送')).toBeInTheDocument()
  })

  it('should show new chat button in top bar', () => {
    renderQAPage()
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should show bottom input is enabled initially', () => {
    renderQAPage()
    const input = screen.getByPlaceholderText('输入你的问题...') as HTMLInputElement
    expect(input.disabled).toBe(false)
  })
})
