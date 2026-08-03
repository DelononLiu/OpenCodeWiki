import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WikiTree } from './WikiTree'

const nodes = [
  { id: 'wn-1', name: '默认知识库', item_id: null, file_path: '', children: [
    { id: 'wn-2', name: 'readme', item_id: 'it-1', file_path: '', children: [] },
  ]},
]

describe('WikiTree', () => {
  it('should render nested tree', () => {
    render(<WikiTree nodes={nodes} onSelect={() => {}} />)
    expect(screen.getByText('默认知识库')).toBeInTheDocument()
    expect(screen.getByText('readme')).toBeInTheDocument()
  })

  it('should call onSelect on leaf click', () => {
    const onSelect = vi.fn()
    render(<WikiTree nodes={nodes} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('readme'))
    expect(onSelect).toHaveBeenCalledWith(nodes[0].children[0])
  })
})
