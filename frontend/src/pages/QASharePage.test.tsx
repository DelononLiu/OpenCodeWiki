import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QASharePage } from './QASharePage'

const mockShareData = {
  qid: 42,
  question: '如何配置数据源？',
  answer: '在 Sources 页面添加 Git 仓库或上传 ZIP。',
  sources: [
    { file: 'docs/setup.md', line: '10', snippet: '添加数据源的步骤' },
  ],
  created_at: '2026-07-20T10:00:00',
  tags: ['配置', '数据源', '入门'],
}

function renderSharePage(qid = '42') {
  return render(
    <MemoryRouter initialEntries={[`/qa/q/${qid}`]}>
      <Routes>
        <Route path="/qa/q/:qid" element={<QASharePage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('QASharePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should show loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}) // never resolves — keeps loading
    )
    renderSharePage()
    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('should render shared QA content when fetch succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve(mockShareData),
    } as Response)

    renderSharePage()

    await waitFor(() => {
      expect(screen.getByText('如何配置数据源？')).toBeInTheDocument()
    })

    // Answer rendered as markdown
    expect(screen.getByText(/在 Sources 页面添加/)).toBeInTheDocument()

    // Tags
    expect(screen.getByText('#配置')).toBeInTheDocument()
    expect(screen.getByText('#数据源')).toBeInTheDocument()
    expect(screen.getByText('#入门')).toBeInTheDocument()

    // Sources
    expect(screen.getByText('docs/setup.md')).toBeInTheDocument()
    expect(screen.getByText('添加数据源的步骤')).toBeInTheDocument()
  })

  it('should show error when entry not found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({}), // empty object, no qid
    } as Response)

    renderSharePage()

    await waitFor(() => {
      expect(screen.getByText('该问答不存在')).toBeInTheDocument()
    })
  })

  it('should show error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    renderSharePage()

    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeInTheDocument()
    })
  })

  it('should handle missing answer gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({ ...mockShareData, answer: '' }),
    } as Response)

    renderSharePage()

    await waitFor(() => {
      expect(screen.getByText('暂无回答')).toBeInTheDocument()
    })
  })

  it('should handle missing tags gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({ ...mockShareData, tags: [] }),
    } as Response)

    renderSharePage()

    await waitFor(() => {
      expect(screen.getByText('如何配置数据源？')).toBeInTheDocument()
    })
  })

  it('should show Q# id in footer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve(mockShareData),
    } as Response)

    renderSharePage()

    await waitFor(() => {
      expect(screen.getByText(/Q#42/)).toBeInTheDocument()
    })
  })
})
