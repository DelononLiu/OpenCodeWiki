import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLayout } from '@/contexts/LayoutContext'
import { WikiRightSidebar } from '@/components/layout/WikiRightSidebar'
import { fetchWikiPage, fetchWikiModules } from '@/api/client'
import type { WikiPageResponse } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { ChevronDown, Loader2, BookOpen } from 'lucide-react'

export function WikiGlobalPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [kbList, setKbList] = useState<{name: string}[]>([])
  const [selectedKb, setSelectedKb] = useState(name || '')
  const [wikiPages, setWikiPages] = useState<{slug: string; name: string}[]>([])
  const [currentSlug, setCurrentSlug] = useState('')
  const [rawContent, setRawContent] = useState('')
  const [pageType, setPageType] = useState<'wiki' | 'topic'>('wiki')
  const [loading, setLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { setDrawerContent } = useLayout()

  // 加载知识库列表
  useEffect(() => {
    fetch('/api/knowledge').then(r => r.json()).then(d => {
      const list = d.data || []
      setKbList(list)
      const target = name || list[0]?.name || ''
      if (target && target !== selectedKb) {
        setSelectedKb(target)
      }
    }).catch(() => {})
  }, [name])

  // 折叠状态
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) { next.delete(path) } else { next.add(path) }
      return next
    })
  }

  // 构建树形 JSX（放入 AppSidebar 抽屉）
  const wikiTree = useMemo(() => {
    if (wikiPages.length === 0) return null
    interface TreeNode { dirs: Record<string, TreeNode>; files: {slug:string; title:string}[] }
    const root: TreeNode = { dirs: {}, files: [] }
    for (const p of wikiPages) {
      const parts = p.slug.split('/')
      let node = root
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.dirs[parts[i]]) node.dirs[parts[i]] = { dirs: {}, files: [] }
        node = node.dirs[parts[i]]
      }
      node.files.push({ slug: p.slug, title: p.name })
    }
    const renderNode = (node: TreeNode, depth: number, path: string): React.ReactNode[] => {
      const els: React.ReactNode[] = []
      const indent = depth * 12
      for (const dirName of Object.keys(node.dirs).sort()) {
        const dirPath = path ? `${path}/${dirName}` : dirName
        const isExpanded = expandedDirs.has(dirPath)
        els.push(
          <div key={`dir-${dirPath}`}>
            <button onClick={() => toggleDir(dirPath)}
              style={{ paddingLeft: `${indent + 6}px` }}
              className="w-full flex items-center gap-0.5 text-left py-1 pr-2 rounded text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition">
              <span className={`inline-block w-3 h-3 text-center text-[10px] leading-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▸</span>
              <span className="truncate">📁 {dirName}</span>
            </button>
            {isExpanded && <div>{renderNode(node.dirs[dirName], depth + 1, dirPath)}</div>}
          </div>
        )
      }
      for (const f of node.files.sort((a,b) => a.title.localeCompare(b.title))) {
        els.push(
          <button key={f.slug} onClick={() => loadContent(f.slug)}
            style={{ paddingLeft: `${indent + 22}px` }}
            className={`block w-full text-left py-1 pr-2 rounded text-xs leading-snug hover:bg-gray-50 transition truncate ${currentSlug === f.slug ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-gray-600'}`}>
            {f.title}
          </button>
        )
      }
      return els
    }
    return <>{renderNode(root, 0, '')}</>
  }, [wikiPages, expandedDirs, currentSlug])

  // 将树放入 AppSidebar 抽屉
  useEffect(() => {
    if (wikiPages.length > 0) {
      setDrawerContent({ title: '文档', items: [], customContent: wikiTree })
    }
  }, [wikiTree, wikiPages.length])

  // 切换知识库时重置并加载内容
  useEffect(() => {
    const kb = name || kbList[0]?.name || ''
    if (!kb) return
    setSelectedKb(kb)
    setCurrentSlug('')
    setRawContent('')
    setWikiPages([])
    // 加载当前知识库的页面列表和内容
    fetchWikiModules().then(modules => {
      // 过滤出属于当前知识库的页面
      const pages = modules
        .filter(m => {
          if (!m.slug || m.slug.startsWith('_')) return false
          // name 格式 "source / title"，取第一部分匹配知识库
          const sourceName = m.name.split(' / ')[0]
          return sourceName === kb
        })
        .map(m => ({ slug: m.slug, name: (m.title || m.slug.split('/').pop() || m.slug) }))
      setWikiPages(pages)
      if (pages.length > 0) {
        loadContent(pages[0].slug, true)
      }
    }).catch(() => {})
  }, [name, kbList])

  // 从 React children 提取文本（用于 heading id）
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

  const handleNavigate = (slug: string) => {
    loadContent(slug)
  }

  const currentKb = kbList.find(k => k.name === selectedKb)

  return (
    <div className="h-full flex flex-col bg-[#F8F9FA]">
      <div className="flex-1 flex overflow-hidden">

        {/* 文档树已放入 AppSidebar 抽屉 */}

        {/* 主内容区 */}
        <div className="flex-1 flex flex-col relative bg-[#FBFBFC]">
          <main className="flex-1 overflow-y-auto no-scrollbar">
            <div className="flex justify-center py-6 px-6">
              <div className="w-full max-w-4xl">

                {/* 知识库切换下拉 */}
                {kbList.length > 0 && (
                  <div className="flex items-center mb-6">
                    <div className="relative">
                      <button
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-800 hover:border-cyber-blue transition"
                      >
                        <BookOpen className="w-4 h-4 text-cyber-blue" />
                        {selectedKb || '选择知识库'}
                        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                      {dropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-20 min-w-[180px]"
                          onMouseLeave={() => setDropdownOpen(false)}>
                          {kbList.map(s => (
                            <button key={s.name}
                              onClick={() => {
                                navigate(`/wiki/${s.name}`)
                                setDropdownOpen(false)
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition ${
                                selectedKb === s.name ? 'text-cyber-blue font-bold bg-cyber-blue/5' : 'text-gray-700'
                              }`}
                            >
                              {s.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 内容 */}
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
                          const text = String(children).replace(/\n$/, '')
                          if (match) return <SyntaxHighlighter style={vscDarkPlus} language={match[1]} PreTag="div" customStyle={{ borderRadius: 12, fontSize: 13 }}>{text}</SyntaxHighlighter>
                          return <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm text-red-500" {...props}>{children}</code>
                        },
                      }}
                    >
                      {rawContent}
                    </ReactMarkdown>
                  </article>
                ) : selectedKb ? (
                  <div className="text-center py-16 text-gray-400 text-sm">
                    该知识库暂无内容
                  </div>
                ) : (
                  <div className="text-center py-16 space-y-4">
                    <BookOpen className="w-12 h-12 mx-auto text-gray-300" />
                    <p className="text-gray-400 text-sm">请先在知识库页面添加内容</p>
                  </div>
                )}

              </div>
            </div>
          </main>
        </div>

        {/* 右侧目录 */}
        {rawContent && <WikiRightSidebar renderedHtml={rawContent} />}
      </div>
    </div>
  )
}
