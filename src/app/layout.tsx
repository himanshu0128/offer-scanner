import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'InboxOffers — Multi-Email Promotional Offer Scanner',
  description:
    'Connect multiple email accounts to automatically scan the last 30 days of promotional offers nightly or on demand.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
