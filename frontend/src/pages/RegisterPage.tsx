import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError('两次密码不一致'); return }
    if (password.length < 4) { setError('密码至少 4 位'); return }
    setSubmitting(true)
    try {
      await register(username, password)
      navigate('/qa', { replace: true })
    } catch (err: any) {
      setError(err.message || '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={onSubmit} className="bg-white p-8 rounded-2xl shadow-lg w-80 space-y-4">
        <h1 className="text-xl font-bold text-gray-900 text-center">注册账号</h1>
        {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="用户名"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
        <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="密码（至少 4 位）"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
        <input value={confirm} onChange={e => setConfirm(e.target.value)} type="password" placeholder="确认密码"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyber-blue" />
        <button type="submit" disabled={submitting}
          className="w-full bg-cyber-blue text-white rounded-lg py-2 text-sm font-semibold hover:bg-cyber-blue-dark disabled:opacity-50">
          {submitting ? '注册中...' : '注册'}
        </button>
        <p className="text-xs text-gray-400 text-center">
          已有账号？<Link to="/login" className="text-cyber-blue hover:underline">登录</Link>
        </p>
      </form>
    </div>
  )
}
