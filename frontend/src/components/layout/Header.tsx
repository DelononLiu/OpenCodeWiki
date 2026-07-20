interface HeaderProps {
  variant: 'home' | 'global'
  repoName?: string
}

export function Header({ variant, repoName }: HeaderProps) {
  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 px-4 py-2 flex items-center z-30 shrink-0">
      {repoName && variant === 'global' && (
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
          {repoName}
        </div>
      )}
    </header>
  )
}
