const BASE = ''  // 不走 /api 前缀，Vite proxy 直接转发 /auth

async function authFetch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

export function login(email: string, password: string) {
  return authFetch<{ token: string; user: { id: number; email: string; name?: string } }>(
    '/auth/login', { email, password }
  )
}

export function register(email: string, password: string, name?: string) {
  return authFetch<{ token: string; user: { id: number; email: string; name?: string } }>(
    '/auth/register', { email, password, name }
  )
}
