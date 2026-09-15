/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
    "../mac-ui-core/src/**/*.{vue,js,ts,jsx,tsx}"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      spacing: { '4.5': '1.125rem' },
      boxShadow: { '2xs': '0 1px 1px rgb(0 0 0 / 4%)', xs: '0 1px 2px rgb(0 0 0 / 6%)' },
      backdropBlur: { xs: '2px' },
      opacity: { 15: '.15', 35: '.35', 45: '.45', 55: '.55', 65: '.65', 85: '.85' },
      colors: {
        mac: {
          accent: '#007aff',
          blue: '#0a84ff',
          green: '#30d158',
          indigo: '#5e5ce6',
          orange: '#ff9f0a',
          pink: '#ff375f',
          purple: '#bf5af2',
          red: '#ff453a',
          teal: '#64d2ff',
          yellow: '#ffd60a',
          gray: '#8e8e93',
        }
      },
      borderRadius: {
        'squircle': '18px',
      }
    },
  },
  plugins: [],
}
