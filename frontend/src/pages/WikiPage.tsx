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
    let html = marked.parse(rawContent, { async: false }) as string
    // 将含制表符（ASCII art 图表）的 <p> 段落替换为 <pre>
    // 每行 ASCII art 可能是一个独立的 <p>，需要合并连续的 ASCII 行
    html = html.replace(/(<p>\s*[┌└│├─┐┘┴┬┤╰╮╭╯╲╱].*?<\/p>\s*)+/gs, (block) => {
      // 提取所有行内容，去掉 <p> 和 </p> 标签
      const lines = block.replace(/<\/?p>/g, '').trim()
      return `<pre class="ascii-art">${lines}</pre>`
    })
    return html
  }, [rawContent])

  // Highlight.js + Mermaid
  useEffect(() => {
    if (!articleRef.current || !renderedHtml) return
    import('highlight.js/styles/github-dark.css').then(() => {})
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
      <div className="flex-1 flex overflow-hidden">
        <LeftSidebar currentSlug={currentSlug} currentTopic={pageType === 'topic' ? currentSlug : undefined} onNavigate={handleNavigate} />
        <div className="flex-1 flex flex-col relative bg-[#FBFBFC]">
          <main className="flex-1 overflow-y-auto no-scrollbar">
            <div className="flex justify-center py-8 px-6">
              <div className="w-full max-w-3xl transition-all">
                {!currentHash && !currentSlug && (
                  <div className="text-center py-16 space-y-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-cyber-blue/10 to-cyber-blue/5 rounded-2xl flex items-center justify-center mx-auto">
                      <BookOpen className="w-8 h-8 text-cyber-blue" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-800">{repo} 知识库</h2>
                    <p className="text-sm text-gray-400">从左侧选择文档开始阅读</p>
                  </div>
                )}
                {renderedHtml ? (
                  <div className="bg-white border border-gray-200/50 rounded-xl p-8 md:p-10 shadow-sm mb-4">
                    {pageType === 'topic' && (
                      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                        <span className="text-[10px] font-mono bg-cyber-blue/10 text-cyber-blue px-2 py-0.5 rounded font-bold">
                          <Hash className="w-3 h-3 inline mr-1" />TOPIC VIEW
                        </span>
                        <span className="text-[10px] text-gray-400">主题聚合视图</span>
                      </div>
                    )}
                    <article ref={articleRef} className="prose prose-slate max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-2xl prose-h1:border-b prose-h1:border-gray-200 prose-h1:pb-3 prose-h2:text-xl prose-h2:mt-10 prose-h3:text-base prose-a:text-cyber-blue prose-a:no-underline hover:prose-a:underline prose-pre:bg-[#1e293b] prose-pre:text-[#e2e8f0] prose-pre:rounded-lg prose-pre:p-4 prose-pre:overflow-x-auto prose-pre:text-sm prose-code:before:content-none prose-code:after:content-none prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono prose-pre:prose-code:bg-transparent prose-pre:prose-code:p-0 prose-pre:prose-code:rounded-none prose-pre:prose-code:text-inherit prose-img:rounded-xl prose-blockquote:border-l-4 prose-blockquote:border-cyber-blue prose-blockquote:pl-4 prose-blockquote:not-italic prose-table:table-fixed prose-td:border prose-td:px-2 prose-td:py-1.5 prose-td:text-sm prose-th:border prose-th:px-2 prose-th:py-1.5 prose-th:bg-gray-50 [&_.ascii-art]:bg-[#1e293b] [&_.ascii-art]:text-[#e2e8f0] [&_.ascii-art]:rounded-lg [&_.ascii-art]:p-4 [&_.ascii-art]:overflow-x-auto [&_.ascii-art]:text-xs [&_.ascii-art]:font-mono [&_.ascii-art]:my-4 "
                      dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                  </div>
                ) : currentSlug ? (
                  <div className="text-center text-gray-400 py-20">加载中或页面不存在</div>
                ) : null}
              </div>
            </div>
          </main>
          <BottomInput visible placeholder="对当前文档提问..." contextTag={currentSlug} />
        </div>
        {pageType === 'topic'
          ? <TopicRightSidebar qaEntries={wikiData?.qa_entries || []} wikiLinks={wikiData?.wiki_links || []} />
          : <WikiRightSidebar renderedHtml={renderedHtml} />
        }
      </div>
    </div>
  )
}
