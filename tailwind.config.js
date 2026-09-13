/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          50: '#faf7ef',
          100: '#f7f3e8',
          200: '#f0eada',
          300: '#e8e0cc',
          400: '#d6ccb0',
          500: '#c0b594',
        },
        ink: {
          900: '#1a1a1a',
          800: '#2b2b2b',
          700: '#3d3d3d',
          600: '#4a4a4a',
          500: '#6b6b6b',
          400: '#8a8a8a',
        },
        rule: 'rgba(120, 160, 200, 0.25)',
        marginline: 'rgba(220, 80, 80, 0.3)',
      },
      fontFamily: {
        hand: ['Kalam', 'sans-serif'],
        script: ['Caveat', 'cursive'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'wiggle': 'wiggle 0.5s ease-in-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(-1deg)' },
          '50%': { transform: 'rotate(1deg)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
