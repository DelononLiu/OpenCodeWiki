import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { WikiRightSidebar } from '@/components/layout/WikiRightSidebar'
import { TopicRightSidebar } from '@/components/layout/TopicRightSidebar'
import { BottomInput } from '@/components/layout/BottomInput'
import { fetchWikiPage } from '@/api/client'
import type { WikiPageResponse } from '@/types'
import { marked } from 'marked'
import { Hash, BookOpen, FileText, Search } from 'lucide-react'

export function WikiPage() {
  const { repo } = useParams<{ repo: string }>()
  const location = useLocation()
  const [rawContent, setRawContent] = useState('')
  const [pageType, setPageType] = useState<'wiki' | 'topic'>('wiki')
  const [currentSlug, setCurrentSlug] = useState('')
  const [wikiData, setWikiData] = useState<WikiPageResponse | null>(null)
  const articleRef = useRef<HTMLDivElement>(null)

  const currentHash = location.hash.replace('#', '')

  const loadContent = useCallback(async (slug: string) => {
    if (!slug) return
    setCurrentSlug(slug)
    try {
      const data = await fetchWikiPage(slug)
      setWikiData(data)
      setRawContent(data.content)
      setPageType(data.type as 'wiki' | 'topic')
    } catch {
      setWikiData(null)
      setRawContent('')
      setPageType('wiki')
    }
  }, [])

  useEffect(() => {
    if (currentHash) loadContent(currentHash)
    else loadContent('overview')
  }, [currentHash, loadContent])

  const renderedHtml = useMemo(() => {
    if (!rawContent) return ''
    return marked.parse(rawContent, { async: false }) as string
  }, [rawContent])

  // Highlight.js + Mermaid
  useEffect(() => {
    if (!articleRef.current || !renderedHtml) return
    import('highlight.js').then(hljs => {
      articleRef.current?.querySelectorAll('pre code').forEach(b => hljs.default.highlightElement(b as HTMLElement))
    }).catch(() => {})
    const mmds = articleRef.current.querySelectorAll('.language-mermaid')
    if (mmds.length > 0) {
      import('mermaid').then(m => {
        mmds.forEach(block => {
          const pre = block.parentElement
          if (!pre) return
          const div = document.createElement('div')
          div.className = 'mermaid my-4'; div.textContent = block.textContent
          pre.parentElement?.replaceChild(div, pre)
        })
        m.default.run({ nodes: articleRef.current?.querySelectorAll('.mermaid') })
      }).catch(() => {})
    }
  }, [renderedHtml])

  const handleNavigate = (slug: string) => { window.location.hash = slug }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" repoName={repo} />
      <div className="flex-1 flex overflow-hidden relative">
        <LeftSidebar currentSlug={currentSlug} currentTopic={pageType === 'topic' ? currentSlug : undefined} onNavigate={handleNavigate} />
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar relative bg-[#FBFBFC]">
          <div className="flex-1 flex justify-center py-8 px-6">
            <div className="w-full max-w-3xl transition-all">
              {!currentHash && !currentSlug && (
                <div className="text-center py-16 space-y-6">
                  <div className="w-16 h-16 bg-gradient-to-br from-cyber-blue/10 to-cyber-blue/5 rounded-2xl flex items-center justify-center mx-auto">
                    <BookOpen className="w-8 h-8 text-cyber-blue" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-800">{repo} 知识库</h2>
                  <p className="text-sm text-gray-400">从左侧选择文档开始阅读，或点击 #topic 查看关联问答聚合</p>
                  <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                    <FileText className="w-3.5 h-3.5" /> 物理文档 <span className="text-gray-300">·</span>
                    <Hash className="w-3.5 h-3.5" /> Topic 聚合 <span className="text-gray-300">·</span>
                    <Search className="w-3.5 h-3.5" /> 全文检索
                  </div>
                </div>
              )}
              {renderedHtml ? (
                <div className="bg-white border border-gray-200/50 rounded-xl p-8 md:p-10 pb-32 shadow-sm">
                  {pageType === 'topic' && (
                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                      <span className="text-[10px] font-mono bg-cyber-blue/10 text-cyber-blue px-2 py-0.5 rounded font-bold">
                        <Hash className="w-3 h-3 inline mr-1" />TOPIC VIEW
                      </span>
                      <span className="text-[10px] text-gray-400">主题聚合视图</span>
                    </div>
                  )}
                  <article ref={articleRef} className="prose prose-slate max-w-none text-sm leading-relaxed font-sans [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_pre]:bg-[#1e293b] [&_pre]:text-[#e2e8f0] [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono [&_a]:text-cyber-blue [&_blockquote]:border-l-4 [&_blockquote]:border-cyber-blue [&_blockquote]:pl-4 [&_blockquote]:bg-gray-50 [&_blockquote]:rounded-r-lg [&_table]:w-full [&_th]:border [&_th]:bg-gray-50 [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:px-3 [&_td]:py-2"
                    dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                </div>
              ) : currentSlug ? (
                <div className="text-center text-gray-400 py-20">加载中或页面不存在</div>
              ) : null}
            </div>
          </div>
          <BottomInput visible placeholder="对当前文档提问..." contextTag={currentSlug} />
        </main>
        {pageType === 'topic'
          ? <TopicRightSidebar qaEntries={wikiData?.qa_entries || []} wikiLinks={wikiData?.wiki_links || []} />
          : <WikiRightSidebar renderedHtml={renderedHtml} />
        }
      </div>
    </div>
  )
}
