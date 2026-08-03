import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SedimentMenu } from './SedimentMenu'

vi.mock('@/api/opencodewiki', () => ({
  sedimentSession: vi.fn(async () => ({ id: 'it-1', title: '沉淀卡', content_md: 'c', form: 'card', scope: 'personal', status: 'draft', owner_id: 'u', created_at: '', updated_at: '', published_at: null })),
  getToken: () => 't', setToken: vi.fn(),
}))

describe('SedimentMenu', () => {
  it('should render menu items after click', async () => {
    render(<SedimentMenu sessionId="ses-1" />)
    fireEvent.click(screen.getByTitle('沉淀为知识'))
    expect(screen.getByText('沉淀为卡片')).toBeInTheDocument()
    expect(screen.getByText('沉淀为文章（草稿）')).toBeInTheDocument()
  })

  it('should call sediment on card click', async () => {
    render(<SedimentMenu sessionId="ses-1" />)
    fireEvent.click(screen.getByTitle('沉淀为知识'))
    fireEvent.click(screen.getByText('沉淀为卡片'))
    await waitFor(() => expect(screen.getByText(/已沉淀为卡片/)).toBeInTheDocument())
  })
})
