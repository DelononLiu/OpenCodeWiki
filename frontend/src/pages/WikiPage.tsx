import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { BottomInput } from '@/components/layout/BottomInput'
import { fetchWikiPage } from '@/api/client'
import { marked } from 'marked'
import { Hash, BookOpen, FileText, Search } from 'lucide-react'

export function WikiPage() {
  const { repo } = useParams<{ repo: string }>()
  const location = useLocation()
  const [rawContent, setRawContent] = useState<string>('')
  const [pageType, setPageType] = useState<'wiki' | 'topic'>('wiki')
  const [currentSlug, setCurrentSlug] = useState<string>('')
  const articleRef = useRef<HTMLDivElement>(null)

  const currentHash = location.hash.replace('#', '')

  const loadContent = useCallback(async (slug: string) => {
    if (!slug) return
    setCurrentSlug(slug)
    try {
      const data = await fetchWikiPage(slug)
      setRawContent(data.content)
      setPageType(data.type as 'wiki' | 'topic')
    } catch {
      setRawContent('')
      setPageType('wiki')
    }
  }, [])

  useEffect(() => {
    if (currentHash) loadContent(currentHash)
    else loadContent('overview')
  }, [currentHash, loadContent])

  // Markdown → HTML
  const renderedHtml = useMemo(() => {
    if (!rawContent) return ''
    return marked.parse(rawContent, { async: false }) as string
  }, [rawContent])

  // Post-process: syntax highlight + mermaid
  useEffect(() => {
    if (!articleRef.current || !renderedHtml) return

    // Highlight.js
    import('highlight.js/lib/core').catch(() => {})
    import('highlight.js/lib/languages/typescript').catch(() => {})
    import('highlight.js/lib/languages/python').catch(() => {})
    import('highlight.js/lib/languages/bash').catch(() => {})
    import('highlight.js/lib/languages/json').catch(() => {})
    // Lazy load highlight.js and run
    const hljsPromise = import('highlight.js')
    hljsPromise.then(hljs => {
      articleRef.current?.querySelectorAll('pre code').forEach((block) => {
        hljs.default.highlightElement(block as HTMLElement)
      })
    }).catch(() => {})

    // Mermaid diagrams
    const mermaidDiagrams = articleRef.current.querySelectorAll('.language-mermaid')
    if (mermaidDiagrams.length > 0) {
      import('mermaid').then(mermaid => {
        mermaidDiagrams.forEach(block => {
          const pre = block.parentElement
          if (!pre) return
          const div = document.createElement('div')
          div.className = 'mermaid my-4'
          div.textContent = block.textContent
          pre.parentElement?.replaceChild(div, pre)
        })
        mermaid.default.run({ nodes: articleRef.current?.querySelectorAll('.mermaid') })
      }).catch(() => {})
    }
  }, [renderedHtml])

  const handleNavigate = (slug: string) => {
    window.location.hash = slug
  }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" repoName={repo} activeSection="wiki" />
      <div className="flex-1 flex overflow-hidden relative">
        <LeftSidebar pageType="wiki" currentSlug={currentSlug} currentTopic={pageType === 'topic' ? currentSlug : undefined} onNavigate={handleNavigate} />
        <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar relative bg-[#FBFBFC]">
          <div className="flex-1 flex justify-center py-8 px-6">
            <div className="w-full max-w-4xl transition-all">
              {!currentHash && !currentSlug && (
                <div className="text-center py-16 space-y-6">
                  <div className="w-16 h-16 bg-gradient-to-br from-cyber-blue/10 to-cyber-blue/5 rounded-2xl flex items-center justify-center mx-auto">
                    <BookOpen className="w-8 h-8 text-cyber-blue" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">{repo} 知识库</h2>
                    <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">
                      从左侧选择文档开始阅读，或点击 #topic 查看关联问答聚合
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> 物理文档</span>
                    <span className="text-gray-300">·</span>
                    <span className="flex items-center gap-1"><Hash className="w-3.5 h-3.5" /> Topic 聚合</span>
                    <span className="text-gray-300">·</span>
                    <span className="flex items-center gap-1"><Search className="w-3.5 h-3.5" /> 全文检索</span>
                  </div>
                </div>
              )}
              {renderedHtml ? (
                <div className="bg-white border border-gray-200/50 rounded-xl p-8 md:p-10 pb-32 shadow-sm">
                  {pageType === 'topic' && (
                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                      <span className="text-[10px] font-mono bg-cyber-blue/10 text-cyber-blue px-2 py-0.5 rounded font-bold flex items-center gap-1">
                        <Hash className="w-3 h-3" /> TOPIC VIEW
                      </span>
                      <span className="text-[10px] text-gray-400">主题聚合视图 — 内容由关联 QA 自动生成</span>
                    </div>
                  )}
                  <article
                    ref={articleRef}
                    className="prose prose-slate max-w-none text-sm leading-relaxed font-sans [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:pb-2 [&_h1]:border-b [&_h1]:border-gray-100 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:my-3 [&_p]:text-gray-700 [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono [&_pre]:bg-[#1e293b] [&_pre]:text-[#e2e8f0] [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_blockquote]:border-l-4 [&_blockquote]:border-cyber-blue [&_blockquote]:pl-4 [&_blockquote]:py-2 [&_blockquote]:my-4 [&_blockquote]:bg-gray-50 [&_blockquote]:rounded-r-lg [&_blockquote]:text-gray-600 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-gray-200 [&_td]:px-3 [&_td]:py-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3 [&_li]:my-1 [&_a]:text-cyber-blue [&_a]:no-underline [&_a:hover]:underline [&_hr]:my-8 [&_hr]:border-gray-100 [&_img]:max-w-full [&_img]:rounded-lg"
                    dangerouslySetInnerHTML={{ __html: renderedHtml }}
                  />
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
