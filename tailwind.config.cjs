/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './index.tsx',
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
    './types.ts',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        app: {
          bg: 'var(--app-bg)',
          bgSoft: 'var(--app-bg-soft)',
          surface: 'var(--app-surface)',
          muted: 'var(--app-surface-muted)',
          border: 'var(--app-border)',
          text: 'var(--app-text)',
          textMuted: 'var(--app-text-muted)',
          textSoft: 'var(--app-text-soft)',
          primary: 'var(--app-primary)',
          primaryStrong: 'var(--app-primary-strong)',
          primarySoft: 'var(--app-primary-soft)',
          success: 'var(--app-success)',
          successSoft: 'var(--app-success-soft)',
          warning: 'var(--app-warning)',
          warningSoft: 'var(--app-warning-soft)',
          danger: 'var(--app-danger)',
          dangerSoft: 'var(--app-danger-soft)',
          info: 'var(--app-info)',
          infoSoft: 'var(--app-info-soft)',
        },
      },
      borderRadius: {
        appControl: 'var(--radius-control)',
        appCard: 'var(--radius-card)',
        appPanel: 'var(--radius-panel)',
      },
      boxShadow: {
        appSoft: 'var(--shadow-soft)',
        appCard: 'var(--shadow-card)',
        appLift: 'var(--shadow-lift)',
      },
      fontFamily: {
        app: ['var(--font-app)'],
        data: ['var(--font-data)'],
      },
      spacing: {
        appGutter: 'var(--space-page-gutter)',
      },
    },
  },
  plugins: [],
};
