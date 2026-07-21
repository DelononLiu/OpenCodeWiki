import type { AnalyzeResult, ApiResponse, Repo, QaEntry, ReviewItem, Topic, TopicDraft, WikiPageResponse } from '@/types'

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

export function calibrateQaEntry(qid: number, answer: string, calibrator = 'admin'): Promise<{ calibrated: boolean }> {
  return request(`/qa/entry/${qid}/calibrate`, {
    method: 'POST',
    body: JSON.stringify({ answer, calibrator }),
  })
}

// ── Wiki ──

export function fetchWikiPage(slug: string): Promise<WikiPageResponse> {
  // 保留路径中的 / 分隔符，只编码各段
  const encoded = slug.split('/').map(encodeURIComponent).join('/')
  return request(`/wiki/${encoded}`)
}

// ── Wiki Modules ──

export function fetchWikiModules(): Promise<{ slug: string; name: string; type: string; title?: string }[]> {
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

// ── Settings ──

export function fetchSettings(): Promise<{ general: { site_name: string }; model: { provider: string; api_key: string; model: string; temperature: number } }> {
  return request('/settings')
}

export function saveSettings(section: string, data: Record<string, unknown>): Promise<{ saved: boolean }> {
  return request('/settings', { method: 'PUT', body: JSON.stringify({ section, data }) })
}

// ── Sources ──

export interface SourceItem {
  name: string
  type: 'code' | 'docs' | 'svn'
  url?: string
  svn_url?: string
  created_at: string
  updated_at: string
  git_commit?: string
  git_count?: string
  git_branch?: string
}

export function fetchSources(type?: string): Promise<SourceItem[]> {
  const qs = type ? `?type=${type}` : ''
  return request<SourceItem[]>(`/sources${qs}`)
}

export function addSource(name: string, url: string, type: string): Promise<SourceItem> {
  return request<SourceItem>('/sources', {
    method: 'POST',
    body: JSON.stringify({ name, url, type }),
  })
}

export function syncSource(name: string): Promise<SourceItem> {
  return request<SourceItem>(`/sources/${encodeURIComponent(name)}/sync`, { method: 'POST' })
}

export function deleteSourceApi(name: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/sources/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export async function addSourceZip(name: string, type: string, file: File): Promise<SourceItem> {
  const formData = new FormData()
  formData.append('name', name)
  formData.append('type', type)
  formData.append('file', file)
  const res = await fetch('/api/sources/upload', { method: 'POST', body: formData })
  const body = await res.json()
  if (!body.ok) throw new Error(body.error || 'Upload failed')
  return body.data
}

// ── Knowledge Pipeline ──

export function analyzeTopics(): Promise<AnalyzeResult> {
  return request<AnalyzeResult>('/topics/analyze', { method: 'POST' })
}

export function generateDraft(slug: string): Promise<TopicDraft> {
  return request<TopicDraft>(`/topics/${encodeURIComponent(slug)}/generate`, { method: 'POST' })
}

export function submitDraft(slug: string): Promise<{ submitted: boolean }> {
  return request<{ submitted: boolean }>(`/topics/${encodeURIComponent(slug)}/submit`, { method: 'POST' })
}

export function approveDraft(slug: string, wikiModule: string): Promise<{ published: boolean; slug: string }> {
  return request<{ published: boolean; slug: string }>(`/topics/${encodeURIComponent(slug)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ wiki_module: wikiModule }),
  })
}

export function rejectDraft(slug: string, reason: string): Promise<{ rejected: boolean }> {
  return request<{ rejected: boolean }>(`/topics/${encodeURIComponent(slug)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function fetchReviewQueue(): Promise<{ queue: ReviewItem[] }> {
  return request<{ queue: ReviewItem[] }>('/wiki/review-queue')
}
