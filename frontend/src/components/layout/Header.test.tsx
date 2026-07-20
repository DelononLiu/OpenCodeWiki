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

  it('should display user avatar', () => {
    renderHeader()
    expect(screen.getByText('L')).toBeInTheDocument()
  })

  it('should display repo name when in global variant', () => {
    renderHeader('global', 'test-repo')
    expect(screen.getByText('test-repo')).toBeInTheDocument()
  })

  it('should not display repo name when not provided', () => {
    renderHeader('global')
    expect(screen.queryByText('test-repo')).not.toBeInTheDocument()
  })

  it('should have user menu button', () => {
    renderHeader()
    const avatar = screen.getByText('L')
    expect(avatar.closest('button')).toBeInTheDocument()
  })
})
