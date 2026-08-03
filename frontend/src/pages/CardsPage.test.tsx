import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CardsPage } from './CardsPage'

const mockItems = [
  { id: 'it-1', title: '团队卡', content_md: '公开内容', form: 'card', scope: 'team', status: 'published',
    owner_id: 'u', created_at: '', updated_at: '', published_at: null },
  { id: 'it-2', title: '私有卡', content_md: '私有内容', form: 'card', scope: 'personal', status: 'draft',
    owner_id: 'u', created_at: '', updated_at: '', published_at: null },
]

vi.mock('@/api/opencodewiki', () => ({
  fetchItems: vi.fn(async () => mockItems),
  fetchItem: vi.fn(async (id: string) => ({ ...mockItems.find(i => i.id === id), links: [] })),
  createItem: vi.fn(async () => mockItems[0]),
  getToken: () => 't', setToken: vi.fn(),
}))

describe('CardsPage', () => {
  it('should render team and personal cards with badges', async () => {
    render(<CardsPage />)
    await waitFor(() => {
      expect(screen.getByText('团队卡')).toBeInTheDocument()
      expect(screen.getByText('私有卡')).toBeInTheDocument()
    })
    expect(screen.getAllByText('团队').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('仅自己可见').length).toBeGreaterThanOrEqual(1)
  })

  it('should filter to team only', async () => {
    render(<CardsPage />)
    await waitFor(() => expect(screen.getByText('团队卡')).toBeInTheDocument())
    screen.getByRole('button', { name: '团队' }).click()
    await waitFor(() => expect(screen.queryByText('私有卡')).not.toBeInTheDocument())
  })
})
