import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HomePage } from './HomePage'

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  )
}

describe('HomePage', () => {
  it('should render the wiki name', () => {
    renderHomePage()
    const elements = screen.getAllByText('OpenCodeWiki')
    expect(elements.length).toBeGreaterThanOrEqual(1)
  })

  it('should render search input', () => {
    renderHomePage()
    const input = screen.getByPlaceholderText('搜索文档、主题或问答...')
    expect(input).toBeInTheDocument()
  })

  it('should render sections with correct titles', async () => {
    renderHomePage()

    // 等待 API 数据加载完成
    await waitFor(() => {
      expect(screen.getByText('代码库')).toBeInTheDocument()
    })

    expect(screen.getByText('最新文档')).toBeInTheDocument()
    expect(screen.getByText('最新问答')).toBeInTheDocument()
    expect(screen.getByText('最热问答')).toBeInTheDocument()
  })

  it('should render the wiki name in Header', () => {
    renderHomePage()
    expect(screen.getAllByText('OpenCodeWiki').length).toBeGreaterThanOrEqual(1)
  })

  it('should show "提交代码库" button', async () => {
    renderHomePage()
    // 等待 API 数据加载
    await waitFor(() => {
      expect(screen.getByText('提交代码库')).toBeInTheDocument()
    })
  })
})
