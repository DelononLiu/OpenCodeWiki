import type { ApiResponse, Repo, QaEntry, Topic, TopicDraft } from '@/types'

const BASE = '/api'

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const body: ApiResponse<T> = await res.json()
  if (!body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
}

// ── Repos ──

export function fetchRepos(): Promise<Repo[]> {
  return request<Repo[]>('/repos')
}

// ── QA ──

export function fetchQaEntries(params?: {
  repo?: string; status?: string; limit?: number; sort?: string
}): Promise<{ entries: QaEntry[]; total: number }> {
  const qs = new URLSearchParams()
  if (params?.repo) qs.set('repo', params.repo)
  if (params?.status) qs.set('status', params.status)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.sort) qs.set('sort', params.sort)
  return request(`/qa/entries?${qs.toString()}`)
}

export function fetchQaEntry(qid: number): Promise<QaEntry> {
  return request(`/qa/entry/${qid}`)
}

export function fetchQaPending(repo?: string): Promise<QaEntry[]> {
  const qs = repo ? `?repo=${encodeURIComponent(repo)}` : ''
  return request(`/qa/pending${qs}`)
}

export function calibrateQaEntry(qid: number, answer: string, calibrator = 'admin'): Promise<{ calibrated: boolean }> {
  return request(`/qa/entry/${qid}/calibrate`, {
    method: 'POST',
    body: JSON.stringify({ answer, calibrator }),
  })
}

export function fetchQaSuggest(q: string): Promise<{ suggestions: { qid: number; question: string }[] }> {
  return request(`/qa/suggest?q=${encodeURIComponent(q)}&limit=5`)
}

// ── Wiki ──

export function fetchWikiPage(slug: string): Promise<{ type: string; slug: string; content: string }> {
  return request(`/wiki/${encodeURIComponent(slug)}`)
}

// ── Wiki Modules ──

export function fetchWikiModules(): Promise<{ slug: string; name: string; type: string }[]> {
  return request('/wiki/modules')
}

// ── Topics ──

export function fetchTopics(): Promise<Topic[]> {
  return request('/topics')
}

export function fetchTopic(slug: string): Promise<Topic> {
  return request(`/topics/${encodeURIComponent(slug)}`)
}

export function fetchTopicDraft(slug: string): Promise<TopicDraft | null> {
  return request(`/topics/${encodeURIComponent(slug)}/draft`)
}

export function analyzeTopics(): Promise<{ suggestions: Topic[] }> {
  return request('/topics/analyze', { method: 'POST' })
}

export function updateTopicDraft(slug: string, content: string): Promise<{ updated: boolean }> {
  return request(`/topics/${encodeURIComponent(slug)}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

export function publishTopic(slug: string, wikiModule: string): Promise<{ slug: string }> {
  return request(`/topics/${encodeURIComponent(slug)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ wiki_module: wikiModule }),
  })
}
