/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#17181a',
          soft: '#3d4043',
          muted: '#6c6f72',
          faint: '#9a9c9d',
        },
        paper: '#f4f2ed',
        surface: '#fffdf8',
        line: '#e4e0d7',
        'line-strong': '#d5d0c4',
        accent: {
          DEFAULT: '#1d5c4a',
          soft: '#e4eee9',
          ink: '#123c30',
        },
        signal: {
          DEFAULT: '#c8412f',
          soft: '#f8e6e2',
        },
        positive: '#2f6b4f',
        warning: '#a56b1f',
      },
      fontFamily: {
        sans: [
          'Inter',
          'Segoe UI Variable Text',
          'Segoe UI',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Cascadia Code',
          'Cascadia Mono',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(23, 24, 26, 0.04), 0 8px 24px -18px rgba(23, 24, 26, 0.25)',
        lift: '0 2px 6px rgba(23, 24, 26, 0.06), 0 18px 40px -24px rgba(23, 24, 26, 0.35)',
        pop: '0 24px 60px -20px rgba(23, 24, 26, 0.35)',
      },
      borderRadius: {
        card: '12px',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
