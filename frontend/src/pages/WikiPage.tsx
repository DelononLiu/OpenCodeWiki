import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { WikiRightSidebar } from '@/components/layout/WikiRightSidebar'
import { TopicRightSidebar } from '@/components/layout/TopicRightSidebar'
import { BottomInput } from '@/components/layout/BottomInput'
import { fetchWikiPage } from '@/api/client'
import type { WikiPageResponse } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Hash, BookOpen } from 'lucide-react'

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

  // 从 React children 提取文本
  const extractText = (children: any): string => {
    if (typeof children === 'string') return children
    if (Array.isArray(children)) return children.map(c => extractText(c)).join('')
    if (children?.props?.children) return extractText(children.props.children)
    return ''
  }

  // Mermaid
  useEffect(() => {
    if (!articleRef.current) return
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
  }, [rawContent])

  // 检测是否含 ASCII art
  const isAsciiArt = (text: string) => /[┌└│├─┐┘┴┬┤╰╮╭╯]/.test(text)

  const handleNavigate = (slug: string) => { window.location.hash = slug }

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <Header variant="global" repoName={repo} />
      <div className="flex-1 flex overflow-hidden">
        <LeftSidebar currentSlug={currentSlug} currentTopic={pageType === 'topic' ? currentSlug : undefined} onNavigate={handleNavigate} />
        <div className="flex-1 flex flex-col relative bg-[#FBFBFC]">
          <main className="flex-1 overflow-y-auto no-scrollbar">
            <div className="flex justify-center py-8 px-6">
              <div className="w-full max-w-4xl transition-all">
                {!currentHash && !currentSlug && (
                  <div className="text-center py-16 space-y-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-cyber-blue/10 to-cyber-blue/5 rounded-2xl flex items-center justify-center mx-auto">
                      <BookOpen className="w-8 h-8 text-cyber-blue" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-800">{repo} 知识库</h2>
                    <p className="text-sm text-gray-400">从左侧选择文档开始阅读</p>
                  </div>
                )}
                {rawContent ? (
                  <div>
                    {pageType === 'topic' && (
                      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                        <span className="text-[10px] font-mono bg-cyber-blue/10 text-cyber-blue px-2 py-0.5 rounded font-bold">
                          <Hash className="w-3 h-3 inline mr-1" />TOPIC VIEW
                        </span>
                        <span className="text-[10px] text-gray-400">主题聚合视图</span>
                      </div>
                    )}
                    <article ref={articleRef} className="text-sm leading-7 text-gray-800 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:border-b [&_h1]:border-gray-200 [&_h1]:pb-3 [&_h1]:mb-6 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-8 [&_h4]:font-semibold [&_h4]:mt-6 [&_a]:text-cyber-blue [&_a]:no-underline [&_img]:rounded-xl [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-5 [&_blockquote]:py-1 [&_blockquote]:text-gray-600 [&_blockquote]:my-6 [&_table]:w-full [&_table]:my-6 [&_th]:border [&_th]:bg-gray-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-sm [&_th]:font-semibold [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_ul]:my-4 [&_ol]:my-4 [&_li]:my-1 [&_hr]:my-8 [&_hr]:border-gray-200">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => {
                            const text = extractText(children)
                            if (isAsciiArt(text)) {
                              return <pre className="bg-[#1e293b] text-[#e2e8f0] rounded-lg p-4 overflow-x-auto text-xs font-mono my-6">{text}</pre>
                            }
                            return <p className="my-4">{children}</p>
                          },
                          code: ({ className, children }) => {
                            const match = /language-(\w+)/.exec(className || '')
                            const isInline = !match
                            if (isInline) {
                              return <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
                            }
                            const lang = match[1]
                            if (lang === 'mermaid') {
                              return <pre className="bg-gray-50 rounded-lg p-4 my-4 text-center text-gray-400 text-sm">mermaid</pre>
                            }
                            return (
                              <SyntaxHighlighter style={vscDarkPlus} language={lang} PreTag="div" customStyle={{
                                margin: '1.5rem 0', padding: '16px', borderRadius: '8px',
                                fontSize: '13px', lineHeight: '1.6',
                              }}>
                                {String(children).replace(/\n$/, '')}
                              </SyntaxHighlighter>
                            )
                          },
                          pre: ({ children }) => <>{children}</>,
                        }}
                      >
                        {rawContent}
                      </ReactMarkdown>
                    </article> "
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
          : <WikiRightSidebar renderedHtml={rawContent} />
        }
      </div>
    </div>
  )
}
