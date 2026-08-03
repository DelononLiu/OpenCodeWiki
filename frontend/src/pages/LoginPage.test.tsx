import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { LoginPage } from './LoginPage'

vi.mock('@/api/opencodewiki', () => ({
  getToken: () => null,
  setToken: vi.fn(),
  // 空用户名提交时登录失败（模拟后端校验拒绝）
  login: vi.fn(async (username: string) => {
    if (!username) throw new Error('登录失败')
    return { token: 't', user: { id: 'u', username: 'alice', role: 'admin', active: true } }
  }),
  register: vi.fn(),
  fetchMe: vi.fn(async () => { throw new Error('no token') }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

describe('LoginPage', () => {
  it('should render form fields', () => {
    render(<MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>)
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('密码')).toBeInTheDocument()
    expect(screen.getByText('登录')).toBeInTheDocument()
  })

  it('should show error on empty submit', async () => {
    render(<MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>)
    fireEvent.click(screen.getByText('登录'))
    await waitFor(() => expect(screen.getByText(/登录失败|用户名|密码/)).toBeInTheDocument())
  })
})
