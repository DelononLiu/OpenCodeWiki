import { http, HttpResponse } from 'msw'

export const handlers = [
  // ── Repos ──
  http.get('/api/repos', () =>
    HttpResponse.json({ ok: true, data: [] })
  ),

  // ── QA ──
  http.get('/api/qa/entries', ({ request }) => {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    return HttpResponse.json({
      ok: true,
      data: {
        entries: [
          {
            qid: 1,
            session_id: 'mock-session-1',
            question: '如何配置数据库',
            answer: '修改 config.json',
            repo: 'test-repo',
            domain: 'general',
            status: status || 'pending',
            is_calibrated: false,
            tags: [],
            created_at: '2026-07-18T00:00:00Z',
            updated_at: '2026-07-18T00:00:00Z',
            visit_count: 0,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      },
    })
  }),

  http.get('/api/qa/entry/:qid', ({ params }) => {
    const qid = Number(params.qid)
    if (qid === 99999) {
      return HttpResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json({
      ok: true,
      data: {
        qid,
        session_id: 'mock-session-1',
        question: '测试问题',
        answer: '测试答案',
        repo: '',
        domain: 'general',
        status: 'active',
        is_calibrated: false,
        tags: [],
        created_at: '2026-07-18T00:00:00Z',
        updated_at: '2026-07-18T00:00:00Z',
        visit_count: 0,
      },
    })
  }),

  http.post('/api/qa/entry/:qid/calibrate', ({ params }) => {
    const qid = Number(params.qid)
    if (qid === 99999) {
      return HttpResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json({ ok: true, data: { calibrated: true } })
  }),

  http.get('/api/qa/suggest', ({ request }) => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q') || ''
    if (q.length < 2) {
      return HttpResponse.json({ ok: true, data: { suggestions: [] } })
    }
    return HttpResponse.json({
      ok: true,
      data: {
        suggestions: [{ qid: 1, question: `关于 ${q} 的问题` }],
      },
    })
  }),

  http.get('/api/qa/next-qid', () =>
    HttpResponse.json({ ok: true, data: { qid: 42 } })
  ),

  http.get('/api/qa/pending', () =>
    HttpResponse.json({ ok: true, data: [] })
  ),

  http.post('/api/qa/save', () =>
    HttpResponse.json({ ok: true, data: { qid: 42, id: 'mock-id', domain: 'general', session_id: 'mock-session' } })
  ),

  http.get('/api/qa/entry/:qid/followups', () =>
    HttpResponse.json({ ok: true, data: [] })
  ),

  // ── Topics ──
  http.get('/api/topics', () =>
    HttpResponse.json({
      ok: true,
      data: [
        {
          slug: 'test-topic',
          name: '测试主题',
          description: '描述',
          status: 'pool',
          wiki_module: null,
          created_at: '2026-07-18T00:00:00Z',
          promoted_at: null,
        },
      ],
    })
  ),

  http.get('/api/topics/:slug', ({ params }) => {
    if (params.slug === 'not-here') {
      return HttpResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json({
      ok: true,
      data: {
        slug: params.slug,
        name: '主题',
        description: '描述',
        status: 'pool',
        qa_entries: [],
        created_at: '2026-07-18T00:00:00Z',
      },
    })
  }),

  http.post('/api/topics', () =>
    HttpResponse.json({ ok: true, data: { slug: 'new-topic', status: 'pool' } })
  ),

  http.get('/api/topics/:slug/draft', () =>
    HttpResponse.json({ ok: true, data: null })
  ),

  http.post('/api/topics/:slug/draft', () =>
    HttpResponse.json({ ok: true, data: { topic_slug: 'test', status: 'pending' } })
  ),

  http.put('/api/topics/:slug/draft', () =>
    HttpResponse.json({ ok: true, data: { updated: true } })
  ),

  http.post('/api/topics/:slug/publish', () =>
    HttpResponse.json({ ok: true, data: { slug: 'test', published: true } })
  ),

  // ── Wiki ──
  http.get('/api/wiki/:slug', ({ params }) => {
    if (params.slug === 'nonexistent-page') {
      return HttpResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json({
      ok: true,
      data: {
        type: 'wiki',
        slug: params.slug,
        content: '# 页面内容',
      },
    })
  }),

  http.get('/api/wiki/modules', () =>
    HttpResponse.json({ ok: true, data: [] })
  ),

  // ── Search ──
  http.get('/api/search', ({ request }) => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q') || ''
    if (q.length < 2) {
      return HttpResponse.json({ ok: true, data: { wiki: [], topic: [], qa: [] } })
    }
    return HttpResponse.json({
      ok: true,
      data: {
        wiki: [{ slug: 'test', title: 'Test', snippet: '...' }],
        topic: [{ slug: 'test', name: 'Test', description: '' }],
        qa: [{ qid: 1, question: 'test question' }],
      },
    })
  }),

  // ── Settings ──
  http.get('/api/settings', () =>
    HttpResponse.json({
      ok: true,
      data: {
        general: { site_name: 'TestWiki' },
        model: { provider: 'openai', api_key: '', model: 'gpt-4o', temperature: 0.7 },
      },
    })
  ),

  http.put('/api/settings', () =>
    HttpResponse.json({ ok: true, data: { saved: true } })
  ),
]
