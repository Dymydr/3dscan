import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0d0f12',
        surface: '#13161b',
        'surface-2': '#1a1f27',
        border: '#2a3040',
        'border-bright': '#3d4d66',
        accent: '#00e5ff',
        'accent-dim': '#0099aa',
        'accent-glow': 'rgba(0,229,255,0.15)',
        warning: '#ff9900',
        error: '#ff3d57',
        success: '#00ff88',
        text: '#e8edf5',
        'text-dim': '#7a8899',
        'text-muted': '#4a5568',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Space Mono"', 'monospace'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-accent': '0 0 20px rgba(0,229,255,0.3)',
        'glow-sm': '0 0 10px rgba(0,229,255,0.2)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 3s linear infinite',
        'scan-line': 'scanLine 2s ease-in-out infinite',
      },
      keyframes: {
        scanLine: {
          '0%, 100%': { transform: 'translateY(-100%)' },
          '50%': { transform: 'translateY(100%)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
