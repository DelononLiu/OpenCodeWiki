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

  it('should render the page title', () => {
    renderQAPage()
    expect(screen.getByText('OpenCodeWiki 问答')).toBeInTheDocument()
  })

  it('should render new question button', () => {
    renderQAPage()
    expect(screen.getByText('新问题')).toBeInTheDocument()
  })

  it('should render history button', () => {
    renderQAPage()
    expect(screen.getByText('历史')).toBeInTheDocument()
  })

  it('should show QA entries after loading', async () => {
    renderQAPage()
    const qaEntry = await screen.findByText('如何配置数据库')
    expect(qaEntry).toBeInTheDocument()
  })
})
