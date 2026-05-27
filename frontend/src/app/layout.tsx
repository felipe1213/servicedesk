import type { Metadata } from 'next';
import { SessionProvider } from '../components/session-provider';

export const metadata: Metadata = {
  title: 'Service Desk',
  description: 'Enterprise Help Desk Ticketing System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
