import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'catalog',
  description: 'A creator-powered shopping platform where you discover products through curated looks.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
