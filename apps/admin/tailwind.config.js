/** Своя колірна гама (не indigo — це Flows): teal/cyan на темному slate-тлі. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#14b8a6', dark: '#0d9488', light: '#5eead4' }, // teal
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
