import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AppSidebar } from './AppSidebar'
import { LayoutProvider } from '@/contexts/LayoutContext'
import { fetchSessions, fetchWikiTree } from '@/api/opencodewiki'

vi.mock('@/api/client', () => ({
  fetchWikiModules: vi.fn().mockResolvedValue([]),
  fetchTopics: vi.fn().mockResolvedValue([]),
  fetchSettings: vi.fn().mockResolvedValue({ general: { site_name: '' }, model: {} }),
  saveSettings: vi.fn().mockResolvedValue({ saved: true }),
}))

vi.mock('@/api/opencodewiki', () => ({
  fetchKBs: vi.fn().mockResolvedValue([]),
  fetchWikiTree: vi.fn().mockResolvedValue([]),
  fetchSessions: vi.fn().mockResolvedValue([]),
  fetchItems: vi.fn().mockResolvedValue([]),
  fetchFragments: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'tester', role: 'admin' },
    token: 'test-token',
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

function Shell() {
  return (
    <>
      <AppSidebar />
      <Routes>
        <Route path="/qa" element={<div data-testid="page-qa">问答页</div>} />
        <Route path="/wiki" element={<div data-testid="page-wiki">知识页</div>} />
        <Route path="/fragments" element={<div data-testid="page-fragments">碎片页</div>} />
        <Route path="/cards" element={<div data-testid="page-cards">卡片页</div>} />
        <Route path="/sources" element={<div data-testid="page-sources">知识库管理页</div>} />
        <Route path="/admin" element={<div data-testid="page-admin">审批页</div>} />
      </Routes>
    </>
  )
}

function renderSidebar(route = '/qa') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LayoutProvider>
        <Shell />
      </LayoutProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AppSidebar 重构', () => {
  it('主导航只包含 问答/Wiki/我的碎片/知识卡片，不显示管理入口', () => {
    renderSidebar('/qa')
    expect(screen.getByRole('button', { name: '问答' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wiki' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '我的碎片' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '知识卡片' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '我的' })).not.toBeInTheDocument()
    expect(screen.queryByText('知识沉淀')).not.toBeInTheDocument()
    expect(screen.queryByText('知识库')).not.toBeInTheDocument()
    expect(screen.queryByText('新问题')).not.toBeInTheDocument()
  })

  it('点击“新建问答”跳转到 /qa', async () => {
    const user = userEvent.setup()
    renderSidebar('/wiki')
    const cta = await screen.findByRole('button', { name: /新建问答/ })
    await user.click(cta)
    expect(await screen.findByTestId('page-qa')).toBeInTheDocument()
  })

  it('问答模式显示历史会话列表', async () => {
    vi.mocked(fetchSessions).mockResolvedValue([{ id: 's1', title: '测试会话', created_at: '2026-08-01' }])
    renderSidebar('/qa')
    expect(await screen.findByText('测试会话')).toBeInTheDocument()
    expect(vi.mocked(fetchSessions)).toHaveBeenCalled()
  })

  it('问答模式无历史会话时显示空态提示', async () => {
    vi.mocked(fetchSessions).mockResolvedValue([])
    renderSidebar('/qa')
    expect(await screen.findByText('暂无问答记录')).toBeInTheDocument()
  })

  it('知识模式显示 Wiki 目录树', async () => {
    vi.mocked(fetchWikiTree).mockResolvedValue([
      { id: 'n1', name: '根节点', item_id: null, file_path: '', children: [] },
    ])
    renderSidebar('/wiki')
    expect(await screen.findByText('根节点')).toBeInTheDocument()
    expect(vi.mocked(fetchWikiTree)).toHaveBeenCalled()
  })

  it('导航中的 我的碎片/知识卡片 可跳转到对应页面', async () => {
    const user = userEvent.setup()
    renderSidebar('/qa')
    await user.click(screen.getByRole('button', { name: '我的碎片' }))
    expect(await screen.findByTestId('page-fragments')).toBeInTheDocument()

    const cards = screen.getByRole('button', { name: '知识卡片' })
    await user.click(cards)
    expect(await screen.findByTestId('page-cards')).toBeInTheDocument()
  })

  it('我的碎片/知识卡片页面侧边栏回落问答历史内容', async () => {
    vi.mocked(fetchSessions).mockResolvedValue([{ id: 's1', title: '测试会话', created_at: '2026-08-01' }])
    renderSidebar('/fragments')
    expect(await screen.findByText('测试会话')).toBeInTheDocument()
  })

  it('用户菜单包含设置/知识库管理/审批台并可跳转', async () => {
    const user = userEvent.setup()
    renderSidebar('/qa')
    await user.click(screen.getByText('tester'))
    expect(await screen.findByText('知识库管理')).toBeInTheDocument()
    expect(screen.getByText('审批台')).toBeInTheDocument()
    expect(screen.getByText('设置')).toBeInTheDocument()
    await user.click(screen.getByText('知识库管理'))
    expect(await screen.findByTestId('page-sources')).toBeInTheDocument()
  })
})
