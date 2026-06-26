import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { login, register } from '@/core/api/auth'

export function AuthPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = mode === 'login'
        ? await login(email, password)
        : await register(email, password, name || undefined)
      setAuth(res.token, res.user)
      navigate('/')
    } catch (err: any) {
      setError(err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <svg width="36" height="36" viewBox="0 0 32 32" fill="none" className="mx-auto mb-3">
            <rect width="32" height="32" rx="6" fill="#1677ff" />
            <path d="M16 6l8 12H8l8-12z" fill="white" />
            <circle cx="16" cy="22" r="3" fill="white" />
          </svg>
          <h1 className="text-lg font-semibold tracking-tight">Taskit</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {mode === 'login' ? '登录你的账号' : '创建新账号'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'register' && (
            <input
              type="text"
              placeholder="用户名（选填）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
            />
          )}
          <input
            type="email"
            placeholder="邮箱"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
          />
          <input
            type="password"
            placeholder="密码"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
          />

          {error && <p className="text-[11px] text-fail">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <p className="text-xs text-center text-muted-foreground mt-4">
          {mode === 'login' ? '没有账号？' : '已有账号？'}
          <button
            className="ml-1 text-primary hover:underline"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}
          >
            {mode === 'login' ? '注册' : '登录'}
          </button>
        </p>
      </div>
    </div>
  )
}
