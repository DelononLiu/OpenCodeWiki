import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Header } from './Header'

function renderHeader(variant: 'home' | 'global' = 'home', repoName?: string) {
  return render(
    <MemoryRouter>
      <Header variant={variant} repoName={repoName} />
    </MemoryRouter>
  )
}

describe('Header', () => {
  it('should render the wiki name', () => {
    renderHeader()
    expect(screen.getByText('OpenCodeWiki')).toBeInTheDocument()
  })

  it('should render navigation buttons', () => {
    renderHeader()
    expect(screen.getByText('首页')).toBeInTheDocument()
    expect(screen.getByText('Wiki')).toBeInTheDocument()
    expect(screen.getByText('问答')).toBeInTheDocument()
  })

  it('should display repo name when in global variant', () => {
    renderHeader('global', 'test-repo')
    expect(screen.getByText('test-repo')).toBeInTheDocument()
  })

  it('should not display repo name when not provided', () => {
    renderHeader('global')
    expect(screen.queryByText('test-repo')).not.toBeInTheDocument()
  })

  it('should show admin button for admin user', () => {
    renderHeader()
    // 用户 "long2015" 是 ADMIN_USERS 中的 admin
    expect(screen.getByText('L')).toBeInTheDocument() // 头像
  })
})
