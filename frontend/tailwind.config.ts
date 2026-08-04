import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cyber: {
          blue: '#2563EB',
          'blue-dark': '#1D4ED8',
          'blue-light': '#EFF6FF',
          green: '#10B981',
          orange: '#F59E0B',
          amber: '#F59E0B',
          red: '#EF4444',
          violet: '#8B5CF6',
          cyan: '#06B6D4',
          bg: '#F8FAFC',
          card: '#FFFFFF',
        },
        sidebar: {
          bg: '#172554',
          text: '#94A3B8',
          active: '#FFFFFF',
        },
        code: {
          bg: '#0F172A',
          text: '#E2E8F0',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
}

export default config
