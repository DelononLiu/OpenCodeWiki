import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QAPage } from './QAPage'

function renderQAPage() {
  return render(
    <MemoryRouter initialEntries={['/qa']}>
      <QAPage />
    </MemoryRouter>
  )
}

describe('QAPage', () => {
  it('should render Header', () => {
    renderQAPage()
    expect(screen.getByText('OpenCodeWiki')).toBeInTheDocument()
  })

  it('should render search input', () => {
    renderQAPage()
    const input = screen.getByPlaceholderText('搜索 QA...')
    expect(input).toBeInTheDocument()
  })

  it('should render the welcome message', () => {
    renderQAPage()
    expect(screen.getByText('对代码库提问')).toBeInTheDocument()
  })

  it('should render the question input', () => {
    renderQAPage()
    const input = screen.getByPlaceholderText('对代码库提问...')
    expect(input).toBeInTheDocument()
  })

  it('should show QA entries after loading', async () => {
    renderQAPage()
    // MSW 返回了 QA 条目，应该能看到
    const qaEntry = await screen.findByText('如何配置数据库')
    expect(qaEntry).toBeInTheDocument()
  })
})
