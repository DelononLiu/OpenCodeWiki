import { api } from '@/api/client'

export async function login(email: string, password: string) {
  return api.post<{ token: string; user: { id: number; email: string; name?: string } }>(
    '/auth/login', { email, password }
  )
}

export async function register(email: string, password: string, name?: string) {
  return api.post<{ token: string; user: { id: number; email: string; name?: string } }>(
    '/auth/register', { email, password, name }
  )
}
