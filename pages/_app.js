import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import '../styles/globals.css';

function MyApp({ Component, pageProps }) {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 transition-colors duration-200">
      <main className="container mx-auto px-4 py-8">
        <Component {...pageProps} />
        <Analytics />
        <SpeedInsights />
      </main>
    </div>
  );
}

export default MyApp;