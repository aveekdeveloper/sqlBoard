/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pbi: {
          bg: '#f3f2f1',
          card: '#ffffff',
          text: '#252423',
          muted: '#605e5c',
          accent: '#0078d4',
          'accent-soft': '#deecf9',
          border: '#edebe9',
        },
      },
    },
  },
  plugins: [],
}
