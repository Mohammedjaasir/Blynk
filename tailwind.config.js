/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        blynk: {
          green: {
            50: '#E6F8F0',
            100: '#C2EED9',
            200: '#99E3BF',
            300: '#6FD8A4',
            400: '#3EC986',
            500: '#00B761', // Primary Brand Green
            600: '#009E52',
            700: '#008142',
            800: '#006433',
            900: '#004723',
          },
          lime: {
            400: '#D4E157',
            500: '#CDDC39',
          },
          yellow: {
            400: '#FACC15',
            500: '#EAB308',
          },
          dark: '#1A1D1E',
          gray: {
            50: '#F8FAFC',
            100: '#F1F5F9',
            200: '#E2E8F0',
            300: '#CBD5E1',
            400: '#94A3B8',
            500: '#64748B',
            600: '#475569',
            700: '#334155',
            800: '#1E293B',
          }
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        'blynk-sm': '0 2px 8px rgba(0, 0, 0, 0.04)',
        'blynk-md': '0 4px 16px rgba(0, 0, 0, 0.06)',
        'blynk-lg': '0 8px 30px rgba(0, 0, 0, 0.08)',
        'blynk-glow': '0 4px 20px rgba(0, 183, 97, 0.25)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'bounce-short': 'bounceShort 0.5s ease-in-out',
        'pulse-subtle': 'pulseSubtle 2s infinite',
        'shimmer': 'shimmer 1.5s infinite linear',
      },
      keyframes: {
        bounceShort: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        }
      }
    },
  },
  plugins: [],
}
