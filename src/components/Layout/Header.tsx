import { Button, Space, Typography } from 'antd'
import { BulbOutlined, BulbFilled } from '@ant-design/icons'
import { useUIStore } from '@/stores/uiStore'
import { useNavigate } from 'react-router-dom'

const { Title } = Typography

export function Header() {
  const { theme, toggleTheme } = useUIStore()
  const navigate = useNavigate()

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      height: 56,
      borderBottom: '1px solid #f0f0f0',
      background: '#fff',
    }}>
      <div
        onClick={() => navigate('/')}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="#1677ff" />
          <path d="M16 6l8 12H8l8-12z" fill="white" />
          <circle cx="16" cy="22" r="3" fill="white" />
        </svg>
        <Title level={4} style={{ margin: 0 }}>ModelDiff</Title>
      </div>

      <Space>
        <Button
          type="text"
          icon={theme === 'dark' ? <BulbFilled /> : <BulbOutlined />}
          onClick={toggleTheme}
        />
      </Space>
    </header>
  )
}
