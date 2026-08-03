import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { getToken, setToken, login as apiLogin, register as apiRegister, fetchMe } from '@/api/opencodewiki'
import type { User } from '@/types/opencodewiki'

interface AuthContextValue {
  user: User | null
  token: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null, token: null, loading: true,
  login: async () => {}, register: async () => {}, logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setTokenState] = useState<string | null>(getToken())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { setLoading(false); return }
    fetchMe()
      .then(setUser)
      .catch((err: any) => {
        if (err?.message === '未登录') {
          // 401：token 无效/过期，清理
          setToken(null)
          setTokenState(null)
          setUser(null)
        } else {
          // 网络/服务错误：保留 token，稍后重试
          setUser(null)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string) => {
    const res = await apiLogin(username, password)
    setToken(res.token)
    setTokenState(res.token)
    setUser(res.user)
  }
  const register = async (username: string, password: string) => {
    const res = await apiRegister(username, password)
    setToken(res.token)
    setTokenState(res.token)
    setUser(res.user)
  }
  const logout = () => { setToken(null); setTokenState(null); setUser(null) }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
