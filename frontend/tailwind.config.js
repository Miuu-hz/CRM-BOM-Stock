/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Brand */
        /* อ่านจาก index.css — เปลี่ยนตามธีม light/dark (ชื่อ indigo คงไว้ ไม่ต้องไล่แก้คลาสทั้งระบบ) */
        'phopy': {
          'indigo': 'rgb(var(--primary-rgb) / <alpha-value>)',
          'indigo-600': 'rgb(var(--primary-hover-rgb) / <alpha-value>)',
          'indigo-700': 'rgb(var(--primary-press-rgb) / <alpha-value>)',
          'indigo-50': 'var(--primary-soft)',
          'mango': '#F5A524',
          'mango-600': '#D9881A',
          'mango-50': '#FEF4E2',
        },
        /* Neutrals (Sand → Ink) */
        'sand': {
          50: 'var(--surface)',
          100: 'var(--surface-2)',
          200: 'var(--surface-sunken)',
          300: 'var(--border-strong)',
          400: 'var(--fg-4)',
        },
        'ink': {
          500: 'var(--fg-3)',
          700: 'var(--fg-2)',
          900: 'var(--fg-1)',
        },
        /* Surfaces */
        'surface': {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          sunken: 'var(--surface-sunken)',
        },
        /* Semantic */
        'success': {
          DEFAULT: 'rgb(var(--success-rgb) / <alpha-value>)',
          soft: 'var(--success-soft)',
        },
        'warning': {
          DEFAULT: 'rgb(var(--warning-rgb) / <alpha-value>)',
          soft: 'var(--warning-soft)',
        },
        'danger': {
          DEFAULT: 'rgb(var(--danger-rgb) / <alpha-value>)',
          soft: 'var(--danger-soft)',
        },
        'info': {
          DEFAULT: 'rgb(var(--primary-rgb) / <alpha-value>)',
          soft: 'var(--info-soft)',
        },
      },
      fontFamily: {
        'sans': ["'Plus Jakarta Sans'", "'IBM Plex Sans Thai'", 'system-ui', 'sans-serif'],
        'thai': ["'IBM Plex Sans Thai'", "'Plus Jakarta Sans'", 'system-ui', 'sans-serif'],
        'mono': ["'JetBrains Mono'", 'ui-monospace', "'SF Mono'", 'Menlo', 'monospace'],
      },
      fontSize: {
        'display': ['40px', { lineHeight: '48px', letterSpacing: '-0.02em' }],
        'h1': ['32px', { lineHeight: '40px', letterSpacing: '-0.01em' }],
        'h2': ['24px', { lineHeight: '32px', letterSpacing: '-0.005em' }],
        'h3': ['20px', { lineHeight: '28px' }],
        'lg': ['18px', { lineHeight: '28px' }],
        'base': ['16px', { lineHeight: '24px' }],
        'sm': ['14px', { lineHeight: '20px' }],
        'xs': ['12px', { lineHeight: '16px' }],
      },
      borderRadius: {
        'sm': '6px',
        'md': '10px',
        'lg': '14px',
        'xl': '20px',
      },
      boxShadow: {
        '1': 'var(--shadow-1)',
        '2': 'var(--shadow-2)',
        '3': 'var(--shadow-3)',
        'focus': 'var(--shadow-focus)',
      },
      spacing: {
        '18': '72px',
        '14': '56px',
      },
      transitionTimingFunction: {
        'phopy-out': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        'phopy-in': 'cubic-bezier(0.4, 0, 1, 1)',
      },
      transitionDuration: {
        '120': '120ms',
        '200': '200ms',
        '320': '320ms',
      },
    },
  },
  plugins: [],
}
