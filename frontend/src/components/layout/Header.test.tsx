import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Header } from './Header'

describe('Header', () => {
  it('should display repo name when in global variant', () => {
    render(<Header variant="global" repoName="test-repo" />)
    expect(screen.getByText('test-repo')).toBeInTheDocument()
  })

  it('should not display repo name when not provided', () => {
    render(<Header variant="global" />)
    expect(screen.queryByText('test-repo')).not.toBeInTheDocument()
  })

  it('should render empty for home variant', () => {
    const { container } = render(<Header variant="home" />)
    expect(container.querySelector('header')).toBeInTheDocument()
  })
})
