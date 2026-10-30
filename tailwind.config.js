/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./www/**/*.html', './www/app.js'],
  theme: {
    extend: {
      colors: {
        base: '#09090b',
        panel: '#18181b',
        line: '#27272a',
        ink: '#ffffff',
        muted: '#a1a1aa',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
