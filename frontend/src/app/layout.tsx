import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Service Desk',
  description: 'Enterprise Help Desk Ticketing System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
