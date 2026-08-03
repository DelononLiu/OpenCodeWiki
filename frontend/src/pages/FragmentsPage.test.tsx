import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FragmentsPage } from './FragmentsPage'

const mockFragments = [
  { id: 'it-1', title: '碎片一', content_md: 'React 18 并发特性', form: 'card', scope: 'personal', status: 'draft',
    owner_id: 'u', created_at: '2026-08-03T00:00:00', updated_at: '', published_at: null },
]

vi.mock('@/api/opencodewiki', () => ({
  fetchFragments: vi.fn(async () => mockFragments),
  createFragment: vi.fn(async () => mockFragments[0]),
  publishItem: vi.fn(async () => ({ ...mockFragments[0], scope: 'team', status: 'published' })),
  draftArticle: vi.fn(async () => ({ id: 'it-art', title: '文章', content_md: '# x', form: 'article', scope: 'personal', status: 'draft', owner_id: 'u', created_at: '', updated_at: '', published_at: null })),
  getToken: () => 't', setToken: vi.fn(),
}))

describe('FragmentsPage', () => {
  it('should render capture box and fragment list', async () => {
    render(<MemoryRouter><FragmentsPage /></MemoryRouter>)
    expect(screen.getByPlaceholderText(/随手记下/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('碎片一')).toBeInTheDocument())
  })

  it('should capture new fragment on submit', async () => {
    render(<MemoryRouter><FragmentsPage /></MemoryRouter>)
    const textarea = screen.getByPlaceholderText(/随手记下/)
    fireEvent.change(textarea, { target: { value: '新的碎片内容' } })
    fireEvent.click(screen.getByText('捕获为卡片'))
    await waitFor(() => expect(screen.getByText('碎片已捕获')).toBeInTheDocument())
  })
})
