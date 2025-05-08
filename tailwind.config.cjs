module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#3B82F6', // Blue from NextUI
        secondary: '#6B7280', // Gray from NextUI
        background: '#F3F4F6', // Light background
        darkBackground: '#1F2937', // Dark background
        success: '#10B981', // Green for success
        failure: '#EF4444', // Red for failure
      },
      borderRadius: {
        'xl': '1rem', // For rounded edges
      },
    },
  },
  plugins: [],
};