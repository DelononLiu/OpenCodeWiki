import { FileText, Trash2 } from 'lucide-react'

interface UploadDocCardProps {
  slug: string
  filename: string
  size: number
  updatedAt: string
  onDelete: () => void
}

export function UploadDocCard({ slug, filename, size, updatedAt, onDelete }: UploadDocCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2.5 hover:shadow-sm transition group">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4 text-yellow-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900 truncate">{slug}</div>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">upload</span>
        </div>
      </div>
      <div className="text-[10px] text-gray-400 truncate font-mono">{filename} ({(size / 1024).toFixed(1)} KB)</div>
      <div className="text-[10px] text-gray-400">{updatedAt?.slice(0, 10)}</div>
      <div className="flex items-center gap-1 pt-2 border-t border-gray-100 opacity-0 group-hover:opacity-100 transition">
        <button onClick={onDelete}
          className="flex-1 inline-flex items-center justify-center gap-1 text-[10px] px-2 py-1 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition">
          <Trash2 className="w-3 h-3" />
          删除
        </button>
      </div>
    </div>
  )
}
