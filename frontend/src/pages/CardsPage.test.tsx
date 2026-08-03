import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CardsPage } from './CardsPage'

const { api, mockItems, mockDrafts } = vi.hoisted(() => {
  const mockItems = [
    { id: 'it-1', title: '团队卡', content_md: '公开内容', form: 'card', scope: 'team', status: 'published',
      owner_id: 'u', created_at: '', updated_at: '', published_at: null },
    { id: 'it-2', title: '私有卡', content_md: '私有内容', form: 'card', scope: 'personal', status: 'draft',
      owner_id: 'u', created_at: '', updated_at: '', published_at: null },
  ]
  const mockDrafts = [
    { id: 'it-3', title: '草稿文章', content_md: '文章正文', form: 'article', scope: 'personal', status: 'draft',
      owner_id: 'u', created_at: '2026-07-18T00:00:00Z', updated_at: '', published_at: null },
  ]
  return {
    mockItems,
    mockDrafts,
    api: {
      fetchItems: vi.fn(async (params?: any) => (params?.form === 'article' ? mockDrafts : mockItems)),
      fetchItem: vi.fn(async (id: string) => {
        const found = [...mockItems, ...mockDrafts].find(i => i.id === id)
        return { ...found, links: [] }
      }),
      createItem: vi.fn(async () => mockItems[0]),
      submitItem: vi.fn(async (id: string) => ({ ...mockDrafts.find(d => d.id === id) })),
      getToken: () => 't',
      setToken: vi.fn(),
    },
  }
})

vi.mock('@/api/opencodewiki', () => api)

const renderPage = (highlight?: string) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/cards', state: highlight ? { highlight } : undefined }]}>
      <CardsPage />
    </MemoryRouter>
  )

describe('CardsPage', () => {
  beforeEach(() => {
    api.fetchItems.mockClear()
    api.submitItem.mockClear()
  })

  it('should render team and personal cards with badges', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('团队卡')).toBeInTheDocument()
      expect(screen.getByText('私有卡')).toBeInTheDocument()
    })
    expect(screen.getAllByText('团队').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('仅自己可见').length).toBeGreaterThanOrEqual(1)
  })

  it('should filter to team only', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('团队卡')).toBeInTheDocument())
    screen.getByRole('button', { name: '团队' }).click()
    await waitFor(() => expect(screen.queryByText('私有卡')).not.toBeInTheDocument())
  })

  it('should list article drafts with submit button and submit for review', async () => {
    renderPage()
    screen.getByRole('button', { name: '文章草稿' }).click()
    await waitFor(() => expect(screen.getByText('草稿文章')).toBeInTheDocument())
    screen.getByRole('button', { name: /提交审核/ }).click()
    await waitFor(() => expect(api.submitItem).toHaveBeenCalledWith('it-3'))
    await waitFor(() => expect(screen.getByText(/已提交审核/)).toBeInTheDocument())
  })

  it('should highlight item from location state', async () => {
    renderPage('it-2')
    await waitFor(() => expect(screen.getByText('私有卡')).toBeInTheDocument())
    const item = screen.getByText('私有卡').closest('button.text-left')!
    expect(item.className).toContain('ring-cyber-blue')
  })

  it('should switch to article drafts tab when highlight is an article', async () => {
    renderPage('it-3')
    await waitFor(() => expect(screen.getByText('草稿文章')).toBeInTheDocument())
    const item = screen.getByText('草稿文章').closest('div.text-left')!
    expect(item.className).toContain('ring-cyber-blue')
  })
})
