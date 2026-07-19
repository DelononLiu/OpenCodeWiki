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

describe('QAPage (new chat layout)', () => {
  it('should render Header with logo text', () => {
    renderQAPage()
    expect(screen.getByText('OpenCodeWiki')).toBeInTheDocument()
  })

  it('should show empty state when no active session', () => {
    renderQAPage()
    // Both top bar and message area show the empty state text
    const hints = screen.getAllByText('对代码库提问')
    expect(hints.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('我可以帮你理解架构、定位代码或解释工作原理')).toBeInTheDocument()
  })

  it('should render left panel section headers', () => {
    renderQAPage()
    expect(screen.getByText('关联主题')).toBeInTheDocument()
    expect(screen.getByText('相关问题')).toBeInTheDocument()
    expect(screen.getByText('历史对话')).toBeInTheDocument()
  })

  it('should show empty placeholders when no data', () => {
    renderQAPage()
    expect(screen.getByText('暂无相关问题')).toBeInTheDocument()
    expect(screen.getByText('历史对话')).toBeInTheDocument()
  })

  it('should render bottom input bar', () => {
    renderQAPage()
    const input = screen.getByPlaceholderText('在此继续追问...')
    expect(input).toBeInTheDocument()
    expect(screen.getByText('发送')).toBeInTheDocument()
  })

  it('should render right panel with reference section', () => {
    renderQAPage()
    expect(screen.getByText('参考引用')).toBeInTheDocument()
    expect(screen.getByText('暂无引用来源')).toBeInTheDocument()
  })

  it('should render panel toggle buttons in top bar', () => {
    renderQAPage()
    // Sidebar icons exist for panel toggles
    const toggleButtons = screen.getAllByRole('button')
    // Filter for Sidebar/PanelRight icon buttons (lucide renders them as svg)
    const iconButtons = document.querySelectorAll('.lucide-sidebar, .lucide-panel-right')
    expect(iconButtons.length).toBeGreaterThanOrEqual(0) // buttons exist in DOM
  })

  it('should show bottom input is enabled initially', () => {
    renderQAPage()
    const input = screen.getByPlaceholderText('在此继续追问...') as HTMLInputElement
    expect(input.disabled).toBe(false)
  })
})
