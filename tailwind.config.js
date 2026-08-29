/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI',
          'Inter', 'Helvetica Neue', 'Arial', 'sans-serif',
        ],
        mono: [
          'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas',
          'JetBrains Mono', 'monospace',
        ],
      },
      colors: {
        accent: {
          50:  '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc7fb',
          400: '#36aaf5',
          500: '#0c8ee0',
          600: '#0070be',
          700: '#0059a0',
          800: '#054a83',
          900: '#0a3d6d',
        },
        success: { 400: '#4ade80', 600: '#16a34a' },
        warning: { 400: '#fb923c', 600: '#ea580c' },
        danger:  { 400: '#f87171', 600: '#dc2626' },
      },
      fontSize: {
        '3xs': ['0.75rem', { lineHeight: '1rem' }],
        '2xs': ['0.86rem', { lineHeight: '1.25rem' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04), 0 1px 12px rgba(15,23,42,0.04)',
        'card-dark': '0 1px 2px rgba(0,0,0,0.2), 0 1px 16px rgba(0,0,0,0.28)',
      },
    },
  },
  plugins: [],
}
