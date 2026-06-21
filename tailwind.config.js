/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // CSS-variable driven so a generated UI can be re-themed by setting the
        // --gp-* channels on its wrapper (see GeneratedApp). Defaults in index.css.
        canvas: 'rgb(var(--gp-canvas) / <alpha-value>)',
        panel: 'rgb(var(--gp-panel) / <alpha-value>)',
        edge: 'rgb(var(--gp-edge) / <alpha-value>)',
        ink: 'rgb(var(--gp-ink) / <alpha-value>)',
        muted: 'rgb(var(--gp-muted) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--gp-accent) / <alpha-value>)',
          soft: 'rgb(var(--gp-accent-soft) / <alpha-value>)',
          deep: 'rgb(var(--gp-accent-deep) / <alpha-value>)',
          ink: 'rgb(var(--gp-on-accent) / <alpha-value>)', // legible text ON the accent
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
