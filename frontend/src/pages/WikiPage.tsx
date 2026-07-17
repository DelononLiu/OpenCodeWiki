import { useState, useEffect, useCallback } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { BottomInput } from '@/components/layout/BottomInput'
import { fetchWikiPage } from '@/api/client'

export function WikiPage() {
  const { repo } = useParams<{ repo: string }>()
  const location = useLocation()
  const [content, setContent] = useState<string>('')
  const [currentSlug, setCurrentSlug] = useState<string>('')

  const currentHash = location.hash.replace('#', '')

  const loadContent = useCallback(async (slug: string) => {
    if (!slug) return
    setCurrentSlug(slug)
    try {
      const data = await fetchWikiPage(slug)
      setContent(data.content)
    } catch {
      setContent('')
    }
  }, [])

  useEffect(() => {
    if (currentHash) loadContent(currentHash)
    else loadContent('overview')
  }, [currentHash, loadContent])

  const handleNavigate = (slug: string) => {
    window.location.hash = slug
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" repoName={repo} activeSection="wiki" />
      <div className="flex-1 flex overflow-hidden relative">
        <LeftSidebar pageType="wiki" currentSlug={currentSlug} onNavigate={handleNavigate} />
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar relative bg-[#FBFBFC]">
          <div className="flex-1 flex justify-center py-8 px-6">
            <div className="w-full max-w-4xl transition-all">
              {content ? (
                <div className="space-y-6 bg-white border border-gray-200/50 rounded-xl p-8 md:p-10 pb-32 shadow-sm">
                  <article className="prose prose-slate max-w-none text-sm leading-relaxed whitespace-pre-wrap font-sans text-gray-700"
                    dangerouslySetInnerHTML={{ __html: content }} />
                </div>
              ) : (
                <div className="text-center text-gray-400 py-20">选择左侧文档开始阅读</div>
              )}
            </div>
          </div>
          <BottomInput visible placeholder={`对当前文档提问...`} contextTag={currentSlug} />
        </main>
      </div>
    </div>
  )
}
