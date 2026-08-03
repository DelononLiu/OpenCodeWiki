import type { KB, Document, Session, Message, Config, User, KnowledgeItem, ReviewTask, WikiNode } from '@/types/opencodewiki'

const BASE = ''

const TOKEN_KEY = 'ocw_token'

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY) }
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  })
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    setToken(null)
    if (!window.location.pathname.startsWith('/login')) window.location.href = '/login'
    throw new Error('未登录')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || body.message || `HTTP ${res.status}`)
  }
  return res.json()
}

// KB
export function fetchKBs(): Promise<KB[]> { return request('/api/kb') }
export function fetchKB(id: string): Promise<KB> { return request(`/api/kb/${id}`) }
export function createKB(name: string, description?: string, repoOpts?: {
  repo_url?: string; repo_type?: string; repo_branch?: string; content_type?: string;
  svn_username?: string; svn_password?: string;
}): Promise<KB> {
  return request('/api/kb', { method: 'POST', body: JSON.stringify({ name, description, ...repoOpts }) })
}
export function deleteKB(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/kb/${id}`, { method: 'DELETE' })
}
export function syncKB(id: string, svnUsername?: string, svnPassword?: string): Promise<any> {
  const body: Record<string, string> = {}
  if (svnUsername) body.svn_username = svnUsername
  if (svnPassword) body.svn_password = svnPassword
  return request(`/api/kb/${id}/sync`, {
    method: 'POST',
    body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
  })
}

// Documents
export function fetchDocuments(kbId: string): Promise<Document[]> {
  return request(`/api/kb/${kbId}/documents`)
}
export function uploadDocument(kbId: string, file: File): Promise<Document> {
  const formData = new FormData()
  formData.append('file', file)
  return fetch(`${BASE}/api/kb/${kbId}/documents`, { method: 'POST', body: formData }).then(r => r.json())
}
export function deleteDocument(kbId: string, docId: string): Promise<{ deleted: boolean }> {
  return request(`/api/kb/${kbId}/documents/${docId}`, { method: 'DELETE' })
}

// Sessions
export function createSession(kbId: string, title?: string): Promise<Session> {
  return request('/api/sessions', { method: 'POST', body: JSON.stringify({ kb_id: kbId, title: title || '' }) })
}
export function fetchSessions(kbId?: string): Promise<Session[]> {
  const qs = kbId ? `?kb_id=${encodeURIComponent(kbId)}` : ''
  return request(`/api/sessions${qs}`)
}
export function fetchSession(id: string): Promise<Session> { return request(`/api/sessions/${id}`) }
export function deleteSession(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/sessions/${id}`, { method: 'DELETE' })
}

// Config
export function fetchConfig(): Promise<Config> { return request('/api/config') }

// QA (SSE)
export function askQuestion(kbId: string, question: string, sessionId?: string): Promise<Response> {
  return fetch(`${BASE}/api/qa`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()!}` } : {}),
    },
    body: JSON.stringify({ kb_id: kbId, question, session_id: sessionId || '' }),
  })
}

// Tasks
export function fetchTasks(status?: string): Promise<any[]> {
  const qs = status ? `?status=${status}` : ''
  return request(`/api/tasks${qs}`)
}

export function submitSVNAuth(kbId: string, username: string, password: string, saveCredentials: boolean): Promise<{ task_id: string }> {
  return request(`/api/kb/${kbId}/svn-auth`, {
    method: 'POST',
    body: JSON.stringify({ username, password, save_credentials: saveCredentials }),
  })
}

// Auth
export function register(username: string, password: string): Promise<{ token: string; user: User }> {
  return request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) })
}
export function login(username: string, password: string): Promise<{ token: string; user: User }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}
export function fetchMe(): Promise<User> { return request('/api/auth/me') }

// Fragments & Items
export function fetchFragments(): Promise<KnowledgeItem[]> { return request('/api/fragments') }
export function createFragment(content: string, title?: string): Promise<KnowledgeItem> {
  return request('/api/fragments', { method: 'POST', body: JSON.stringify({ content, title: title || '' }) })
}
export function fetchItems(params?: { form?: string; scope?: string; q?: string }): Promise<KnowledgeItem[]> {
  const qs = new URLSearchParams()
  if (params?.form) qs.set('form', params.form)
  if (params?.scope) qs.set('scope', params.scope)
  if (params?.q) qs.set('q', params.q)
  const s = qs.toString()
  return request(`/api/items${s ? `?${s}` : ''}`)
}
export function fetchItem(id: string): Promise<KnowledgeItem> { return request(`/api/items/${id}`) }
export function createItem(payload: { title: string; content_md: string; form?: string; scope?: string }): Promise<KnowledgeItem> {
  return request('/api/items', { method: 'POST', body: JSON.stringify(payload) })
}
export function updateItem(id: string, patch: { title?: string; content_md?: string }): Promise<KnowledgeItem> {
  return request(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
}
export function deleteItemApi(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/items/${id}`, { method: 'DELETE' })
}
export function publishItem(id: string): Promise<KnowledgeItem> {
  return request(`/api/items/${id}/publish`, { method: 'POST' })
}

// Sedimentation & Review
export function sedimentSession(sid: string, kind: 'card' | 'article'): Promise<KnowledgeItem> {
  return request(`/api/sessions/${sid}/sediment`, { method: 'POST', body: JSON.stringify({ kind }) })
}
export function draftArticle(itemIds: string[], title?: string): Promise<KnowledgeItem> {
  return request('/api/articles/draft', { method: 'POST', body: JSON.stringify({ item_ids: itemIds, title: title || '' }) })
}
export function submitItem(id: string): Promise<KnowledgeItem> {
  return request(`/api/items/${id}/submit`, { method: 'POST' })
}
export function reviewItem(id: string, action: 'approve' | 'reject', reason: string): Promise<KnowledgeItem> {
  return request(`/api/items/${id}/review`, { method: 'POST', body: JSON.stringify({ action, reason }) })
}
export function fetchReviews(): Promise<ReviewTask[]> { return request('/api/admin/reviews') }
export function fetchAdminUsers(): Promise<User[]> { return request('/api/admin/users') }
export function deactivateUser(id: string): Promise<{ deactivated: boolean }> {
  return request(`/api/admin/users/${id}/deactivate`, { method: 'POST' })
}

// Wiki organization tree
export function fetchWikiTree(): Promise<WikiNode[]> { return request('/api/wiki/tree') }
export function fetchWikiNodeContent(id: string): Promise<{ node: { id: string; name: string; item_id: string | null }; content: string; title: string }> {
  return request(`/api/wiki/node/${id}`)
}
