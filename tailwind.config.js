/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0b0b12',
        panel: '#15151f',
        edge: '#262635',
        ink: '#e7e7f0',
        muted: '#9a9ab0',
        accent: {
          DEFAULT: '#7c5cff',
          soft: '#9d86ff',
          deep: '#5b3fd6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
