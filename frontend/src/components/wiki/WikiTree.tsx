import { useState } from 'react'
import type { WikiNode } from '@/types/opencodewiki'
import { ChevronDown, FileText, Folder } from 'lucide-react'

function TreeNode({ node, depth, onSelect }: {
  node: WikiNode
  depth: number
  onSelect: (n: WikiNode) => void
}) {
  const isLeaf = node.children.length === 0 && (node.item_id !== null || node.file_path !== '')
  const [open, setOpen] = useState(true)
  const indent = { paddingLeft: `${depth * 16 + 8}px` }

  if (isLeaf) {
    return (
      <button onClick={() => onSelect(node)} style={indent}
        className="w-full flex items-center gap-1.5 text-left py-1 pr-2 rounded-md text-sm text-sidebar-text/60 hover:bg-white/5 hover:text-sidebar-active transition-colors truncate">
        <FileText className="w-3.5 h-3.5 shrink-0 text-sidebar-text/40" />
        <span className="truncate">{node.name}</span>
      </button>
    )
  }

  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={indent}
        className="w-full flex items-center gap-1 text-left py-1 pr-2 rounded-md text-sm text-sidebar-text/70 hover:bg-white/5 hover:text-sidebar-active transition-colors">
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform text-sidebar-text/40 ${open ? '' : '-rotate-90'}`} />
        <Folder className="w-3.5 h-3.5 shrink-0 text-sidebar-text/40" />
        <span className="truncate">{node.name}</span>
      </button>
      {open && node.children.map(child => (
        <TreeNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  )
}

export function WikiTree({ nodes, onSelect }: {
  nodes: WikiNode[]
  onSelect: (n: WikiNode) => void
}) {
  if (nodes.length === 0) {
    return <div className="text-sm text-slate-600 px-[10px] py-5 text-center">暂无文档</div>
  }
  return (
    <div>
      {nodes.map(n => <TreeNode key={n.id} node={n} depth={0} onSelect={onSelect} />)}
    </div>
  )
}
