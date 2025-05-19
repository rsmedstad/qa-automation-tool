/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#3B82F6', // Blue from NextUI
        secondary: '#6B7280', // Gray from NextUI
        background: '#F3F4F6', // Light background
        darkBackground: '#000000', // Dark background #1F2937
        success: '#10B981', // Green for success
        failure: '#EF4444', // Red for failure
        gray: {
          100: '#F7FAFC', // Light mode text
          200: '#E2E8F0', // Dark mode primary text
          400: '#A0AEC0', // Hover states
          500: '#718096', // Light mode secondary text
          600: '#4A5568', // Light mode tertiary text / Dark mode borders
          700: '#2d2e32', // Dark mode card background #2D3748
          800: '#1e1f23', // Dark mode secondary background #1A202C
          900: '#000000', // Dark mode primary background #171923
        },
        indigo: {
          400: '#A0AEC0', // Dark mode hover accent #A0AEC0
          600: '#3182ce', // Buttons #5A67D8
        },
        green: {
          600: '#2F855A', // Submit button
          700: '#276749', // Submit button hover
        },
        red: {
          500: '#F56565', // Error text
        },
        blue: {
          500: '#3182CE', // Artifact links
        },
      },
      borderRadius: {
        'xl': '1rem', // For rounded edges
      },
      height: {
        '400': '400px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwindcss-scrollbar'),
  ],
};