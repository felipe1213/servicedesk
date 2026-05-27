'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect } from 'react';

const BASE_NAV: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/tickets', label: 'Tickets' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const role = (session?.user as any)?.role ?? '';
  const nav = ['ADMIN', 'MANAGER'].includes(role)
    ? [...BASE_NAV, { href: '/admin', label: 'Admin' }]
    : BASE_NAV;

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/login');
  }, [status, router]);

  if (status === 'loading') {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' }}>Loading…</div>;
  }
  if (!session) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
      <nav style={{ width: 220, background: '#0f172a', color: '#94a3b8', display: 'flex', flexDirection: 'column', padding: '24px 0', flexShrink: 0 }}>
        <div style={{ padding: '0 20px 24px', borderBottom: '1px solid #1e293b' }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#f1f5f9' }}>Service Desk</span>
        </div>
        <ul style={{ listStyle: 'none', padding: '16px 0', margin: 0, flex: 1 }}>
          {nav.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                style={{
                  display: 'block',
                  padding: '10px 20px',
                  color: pathname.startsWith(href) ? '#f1f5f9' : '#94a3b8',
                  background: pathname.startsWith(href) ? '#1e293b' : 'transparent',
                  textDecoration: 'none',
                  fontSize: 14,
                  borderLeft: pathname.startsWith(href) ? '3px solid #3b82f6' : '3px solid transparent',
                }}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <div style={{ padding: '16px 20px', borderTop: '1px solid #1e293b' }}>
          <div style={{ fontSize: 13, marginBottom: 8, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.user?.email}</div>
          <button
            onClick={() => signOut({ callbackUrl: '/auth/login' })}
            style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13, width: '100%' }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <main style={{ flex: 1, padding: 32, overflow: 'auto' }}>{children}</main>
    </div>
  );
}
