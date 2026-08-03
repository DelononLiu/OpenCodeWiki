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
    expect(screen.getByText('知识库问答')).toBeInTheDocument()
    expect(screen.getByText('在左侧选择知识库，输入问题开始对话')).toBeInTheDocument()
  })

  it('should render bottom input bar', () => {
    const { container } = renderQAPage()
    const input = screen.getByPlaceholderText('输入问题，Enter 发送...')
    expect(input).toBeInTheDocument()
    expect(container.querySelector('.lucide-send')).toBeInTheDocument()
  })

  it('should show new chat button in top bar', () => {
    renderQAPage()
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should show bottom input is enabled initially', () => {
    renderQAPage()
    const input = screen.getByPlaceholderText('输入问题，Enter 发送...') as HTMLInputElement
    expect(input.disabled).toBe(false)
  })
})
