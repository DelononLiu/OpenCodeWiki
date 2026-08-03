import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ReviewPanel } from './ReviewPanel'

const mockTasks = [
  { id: 'rev-1', item_id: 'it-1', title: '待审文章一', owner_id: 'u', action: 'pending', reason: '', created_at: '2026-08-03T00:00:00' },
]

vi.mock('@/api/opencodewiki', () => ({
  fetchReviews: vi.fn(async () => mockTasks),
  fetchItem: vi.fn(async () => ({ id: 'it-1', title: '待审文章一', content_md: '# 正文内容', form: 'article', scope: 'personal', status: 'pending', owner_id: 'u', created_at: '', updated_at: '', published_at: null, links: [] })),
  reviewItem: vi.fn(async () => ({})),
  getToken: () => 't', setToken: vi.fn(),
}))

describe('ReviewPanel', () => {
  it('should render pending tasks', async () => {
    render(<ReviewPanel />)
    await waitFor(() => expect(screen.getByText('待审文章一')).toBeInTheDocument())
  })

  it('should open detail and approve', async () => {
    render(<ReviewPanel />)
    await waitFor(() => expect(screen.getByText('待审文章一')).toBeInTheDocument())
    screen.getByText('审阅').click()
    await waitFor(() => expect(screen.getByText('# 正文内容')).toBeInTheDocument())
    screen.getByText('批准发布').click()
    await waitFor(() => expect(screen.getByText('已批准并发布')).toBeInTheDocument())
  })
})
