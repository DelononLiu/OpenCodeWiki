import type { KB, Document, Session, Message, Config } from '@/types/opencodewiki'

const BASE = ''

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
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
    headers: { 'Content-Type': 'application/json' },
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
