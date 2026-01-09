/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Futuristic Color Palette
        'cyber': {
          'primary': '#00f0ff',
          'secondary': '#0066ff',
          'purple': '#9d00ff',
          'magenta': '#ff00ff',
          'green': '#00ff88',
          'dark': '#0a0e27',
          'darker': '#1a1d35',
          'card': '#151932',
          'border': '#2d3250',
        },
      },
      boxShadow: {
        'neon': '0 0 10px rgba(0, 240, 255, 0.5)',
        'neon-strong': '0 0 20px rgba(0, 240, 255, 0.8)',
        'purple-neon': '0 0 10px rgba(157, 0, 255, 0.5)',
        'green-neon': '0 0 10px rgba(0, 255, 136, 0.5)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%, 100%': { boxShadow: '0 0 5px rgba(0, 240, 255, 0.5)' },
          '50%': { boxShadow: '0 0 20px rgba(0, 240, 255, 0.8), 0 0 30px rgba(0, 240, 255, 0.6)' },
        },
      },
      backgroundImage: {
        'gradient-cyber': 'linear-gradient(135deg, #0a0e27 0%, #1a1d35 100%)',
        'gradient-card': 'linear-gradient(135deg, rgba(21, 25, 50, 0.8) 0%, rgba(26, 29, 53, 0.8) 100%)',
      },
    },
  },
  plugins: [],
}
