import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { BottomInput } from './BottomInput'

function renderBottomInput(overrides?: { placeholder?: string; contextTag?: string; visible?: boolean }) {
  return render(
    <MemoryRouter>
      <BottomInput
        visible={overrides?.visible ?? true}
        placeholder={overrides?.placeholder}
        contextTag={overrides?.contextTag}
      />
    </MemoryRouter>
  )
}

describe('BottomInput', () => {
  it('should render input and send button', () => {
    renderBottomInput()
    expect(screen.getByPlaceholderText('提出新疑问...')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should render custom placeholder', () => {
    renderBottomInput({ placeholder: '自定义占位符' })
    expect(screen.getByPlaceholderText('自定义占位符')).toBeInTheDocument()
  })

  it('should be hidden when visible is false', () => {
    const { container } = renderBottomInput({ visible: false })
    expect(container.innerHTML).toBe('')
  })

  it('should display context tag when provided', () => {
    renderBottomInput({ contextTag: 'open-code-wiki' })
    expect(screen.getByText('#open-code-wiki')).toBeInTheDocument()
  })

  it('should update input value on typing', async () => {
    const user = userEvent.setup()
    renderBottomInput()

    const input = screen.getByPlaceholderText('提出新疑问...')
    await user.type(input, '测试问题')
    expect(input).toHaveValue('测试问题')
  })
})
