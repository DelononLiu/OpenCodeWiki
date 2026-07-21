interface ActionItem {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
}

interface ContextToolbarProps {
  actions: ActionItem[]
  className?: string
}

export function ContextToolbar({ actions, className = '' }: ContextToolbarProps) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {actions.map((action, i) => (
        <div key={i} className="group relative flex items-center">
          <button
            onClick={action.onClick}
            title={action.label}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
              action.active
                ? 'bg-cyber-blue text-white shadow-sm'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
          >
            {action.icon}
          </button>
          <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-[10px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            {action.label}
          </span>
        </div>
      ))}
    </div>
  )
}
