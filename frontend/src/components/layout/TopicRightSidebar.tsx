import { useNavigate } from 'react-router-dom'
import { MessageCircle, FileText } from 'lucide-react'

interface QaBrief { qid: number; question: string; created_at: string }
interface WikiLink { slug: string; name: string }

interface TopicRightSidebarProps { qaEntries: QaBrief[]; wikiLinks: WikiLink[] }

export function TopicRightSidebar({ qaEntries, wikiLinks }: TopicRightSidebarProps) {
  const navigate = useNavigate()
  return (
    <aside className="w-56 border-l border-gray-200/50 bg-[#FBFBFC] overflow-y-auto no-scrollbar shrink-0 hidden lg:block">
      <div className="p-4 space-y-6 sticky top-0">
        <div>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <MessageCircle className="w-3.5 h-3.5 text-amber-500" /> 关联 QA
          </h3>
          {qaEntries.length > 0 ? (
            <nav className="space-y-1">
              {qaEntries.map(qa => (
                <button key={qa.qid} onClick={() => navigate(`/qa?qid=${qa.qid}`)}
                  className="w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 transition">
                  <span className="font-mono text-[10px] text-cyber-blue font-bold mr-1.5">#Q{qa.qid}</span>
                  <span className="text-gray-600">{qa.question.length > 40 ? qa.question.slice(0, 40) + '...' : qa.question}</span>
                </button>
              ))}
            </nav>
          ) : <div className="text-[11px] text-gray-400 py-2">暂无关联 QA</div>}
        </div>
        <div className="pt-3 border-t border-gray-100">
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-cyber-blue" /> 关联页面
          </h3>
          {wikiLinks.length > 0 ? (
            <nav className="space-y-1">
              {wikiLinks.map(link => (
                <button key={link.slug} onClick={() => window.location.hash = link.slug}
                  className="w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 transition text-gray-600">
                  {link.name}
                </button>
              ))}
            </nav>
          ) : <div className="text-[11px] text-gray-400 py-2">暂无关联页面</div>}
        </div>
      </div>
    </aside>
  )
}
