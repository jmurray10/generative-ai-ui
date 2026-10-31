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
        // status colors: always paired with a text label, never color alone
        ok: 'rgb(var(--gp-ok) / <alpha-value>)',
        warn: 'rgb(var(--gp-warn) / <alpha-value>)',
        bad: 'rgb(var(--gp-bad) / <alpha-value>)',
        info: 'rgb(var(--gp-info) / <alpha-value>)',
      },
      // Shape and depth are tokens too, so a DESIGN.md token file can restyle the
      // registry without touching component code (design/*/tokens.css).
      borderRadius: {
        lg: 'var(--gp-radius-sm)',
        xl: 'var(--gp-radius-md)',
        '2xl': 'var(--gp-radius-lg)',
        full: 'var(--gp-radius-pill)',
      },
      boxShadow: {
        card: 'var(--gp-shadow-card)',
      },
      fontFamily: {
        sans: ['var(--gp-font-body)'],
        display: ['var(--gp-font-display)'],
        data: ['var(--gp-font-data)'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
