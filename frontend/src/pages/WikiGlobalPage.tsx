import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ContentRightPanel } from '@/components/layout/ContentRightPanel'
import { fetchWikiPage, fetchWikiModules } from '@/api/client'
import type { WikiPageResponse } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from '@/components/content/CodeBlock'
import { Loader2, BookOpen } from 'lucide-react'

export function WikiGlobalPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [wikiPages, setWikiPages] = useState<{slug: string; name: string}[]>([])
  const [currentSlug, setCurrentSlug] = useState('')
  const [rawContent, setRawContent] = useState('')
  const [pageType, setPageType] = useState<'wiki' | 'topic'>('wiki')
  const [wikiData, setWikiData] = useState<WikiPageResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const selectedKb = name || ''

  // Auto-redirect to first KB when no KB specified
  useEffect(() => {
    if (!name) {
      fetch('/api/knowledge').then(r => r.json()).then(d => {
        const first = d.data?.[0]?.name
        if (first) navigate(`/wiki/${first}`, { replace: true })
      }).catch(() => {})
    }
  }, [name, navigate])

  useEffect(() => {
    if (!selectedKb) return
    setCurrentSlug('')
    setRawContent('')
    setWikiPages([])
    fetchWikiModules().then(modules => {
      const pages = modules
        .filter(m => {
          if (!m.slug || m.slug.startsWith('_')) return false
          const sourceName = m.name.split(' / ')[0]
          return sourceName === selectedKb
        })
        .map(m => ({ slug: m.slug, name: (m.title || m.slug.split('/').pop() || m.slug) }))
      setWikiPages(pages)
      if (pages.length > 0) {
        loadContent(pages[0].slug, true)
      }
    }).catch(() => {})
  }, [name])

  const extractText = (children: any): string => {
    if (typeof children === 'string') return children
    if (Array.isArray(children)) return children.map(c => extractText(c)).join('')
    if (children?.props?.children) return extractText(children.props.children)
    return ''
  }

  const loadContent = async (slug: string, initial = false) => {
    if (!slug) return
    if (!initial) setLoading(true)
    try {
      const data = await fetchWikiPage(slug)
      setWikiData(data)
      setRawContent(data.content || '')
      setPageType(data.type as 'wiki' | 'topic')
      setCurrentSlug(slug)
    } catch {
      setRawContent('')
      setPageType('wiki')
      if (initial) setCurrentSlug('')
    } finally {
      if (!initial) setLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#F8FAFC]">
      <div className="flex-1 flex overflow-hidden">
        {/* 主内容区 */}
        <div className="flex-1 flex flex-col relative bg-[#FBFBFC]">
          <main className="flex-1 overflow-y-auto no-scrollbar">
            <div className="flex justify-center py-6 px-6">
              <div className="w-full max-w-4xl">
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : rawContent ? (
                  <article>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ children }) => { const id = extractText(children).toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return <h1 id={id} className="text-3xl font-bold border-b border-gray-200 pb-3 mb-6">{children}</h1> },
                        h2: ({ children }) => { const id = extractText(children).toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return <h2 id={id} className="text-2xl font-semibold mt-12 mb-4">{children}</h2> },
                        h3: ({ children }) => { const id = extractText(children).toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return <h3 id={id} className="text-lg font-semibold mt-8 mb-3">{children}</h3> },
                        h4: ({ children }) => <h4 className="font-semibold mt-6 mb-2">{children}</h4>,
                        a: ({ href, children }) => <a href={href} className="text-cyber-blue no-underline hover:underline">{children}</a>,
                        img: ({ src, alt }) => <img src={src} alt={alt} className="rounded-xl my-4" />,
                        blockquote: ({ children }) => <blockquote className="border-l-4 border-gray-300 pl-5 py-1 text-gray-600 my-6">{children}</blockquote>,
                        table: ({ children }) => <table className="w-full my-6">{children}</table>,
                        th: ({ children }) => <th className="border bg-gray-50 px-3 py-2 text-sm font-semibold">{children}</th>,
                        td: ({ children }) => <td className="border px-3 py-2 text-sm">{children}</td>,
                        code: ({ className, children, ...props }) => {
                          const match = /language-(\w+)/.exec(className || '')
                          const isInline = !className && !String(children).includes('\n')
                          if (isInline) {
                            return <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>{children}</code>
                          }
                          const lang = match ? match[1] : 'text'
                          if (lang === 'mermaid') {
                            return <pre className="bg-gray-50 rounded-lg p-4 my-4 text-center text-gray-400 text-sm">mermaid</pre>
                          }
                          return (
                            <CodeBlock language={lang}>
                              {String(children).replace(/\n$/, '')}
                            </CodeBlock>
                          )
                        },
                      }}
                    >
                      {rawContent}
                    </ReactMarkdown>
                  </article>
                ) : selectedKb ? (
                  <div className="text-center py-16 text-gray-400 text-sm">该知识库暂无内容</div>
                ) : (
                  <div className="text-center py-16 space-y-4">
                    <BookOpen className="w-12 h-12 mx-auto text-gray-300" />
                    <p className="text-gray-400 text-sm">请在侧栏选择知识库查看内容</p>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>

        {/* 右侧面板 */}
        {rawContent && (
          <ContentRightPanel
            pageType={pageType}
            renderedHtml={rawContent}
            qaEntries={wikiData?.qa_entries}
            wikiLinks={wikiData?.wiki_links}
          />
        )}
      </div>
    </div>
  )
}
