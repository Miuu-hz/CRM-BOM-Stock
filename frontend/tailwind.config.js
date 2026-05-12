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
        'phopy': {
          'indigo': '#3949E5',
          'indigo-600': '#2F3DC4',
          'indigo-700': '#2632A8',
          'indigo-50': '#EEF0FE',
          'mango': '#F5A524',
          'mango-600': '#D9881A',
          'mango-50': '#FEF4E2',
        },
        /* Neutrals (Sand → Ink) */
        'sand': {
          50: '#FBF8F1',
          100: '#F5F0E2',
          200: '#ECE6D8',
          300: '#D9D2C0',
          400: '#A8A294',
        },
        'ink': {
          500: '#6B6658',
          700: '#383426',
          900: '#1E1B16',
        },
        /* Surfaces */
        'surface': {
          DEFAULT: '#FFFFFF',
          2: '#F5F0E2',
          sunken: '#ECE6D8',
        },
        /* Semantic */
        'success': {
          DEFAULT: '#16A34A',
          soft: '#DCFCE7',
        },
        'warning': {
          DEFAULT: '#F5A524',
          soft: '#FEF4E2',
        },
        'danger': {
          DEFAULT: '#DC2626',
          soft: '#FEE2E2',
        },
        'info': {
          DEFAULT: '#3949E5',
          soft: '#EEF0FE',
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
        '1': '0 1px 2px rgba(30, 27, 22, 0.05)',
        '2': '0 4px 12px -2px rgba(30, 27, 22, 0.08)',
        '3': '0 12px 32px -8px rgba(30, 27, 22, 0.16)',
        'focus': '0 0 0 4px rgba(57, 73, 229, 0.18)',
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
