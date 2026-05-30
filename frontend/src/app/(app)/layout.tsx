'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const BASE_NAV: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/tickets', label: 'Tickets' },
  { href: '/kb', label: 'Knowledge Base' },
];

const API = process.env.NEXT_PUBLIC_API_URL;

type Notification = {
  id: string;
  title: string;
  body: string;
  ticketId?: string;
  read: boolean;
  createdAt: string;
};

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const bellRef = useRef<HTMLDivElement>(null);

  const token = (session as any)?.accessToken;
  const role = (session?.user as any)?.role ?? '';
  const nav = ['ADMIN', 'MANAGER'].includes(role)
    ? [...BASE_NAV, { href: '/admin', label: 'Admin' }]
    : BASE_NAV;

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/login');
  }, [status, router]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/notifications?limit=5&unread=true`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => setNotifications(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!bellOpen) return;
    function handleOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [bellOpen]);

  async function markRead(notif: Notification) {
    if (!notif.read && token) {
      await fetch(`${API}/notifications/${notif.id}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    }
    setBellOpen(false);
    if (notif.ticketId) router.push(`/tickets/${notif.ticketId}`);
  }

  async function markAllRead() {
    if (!token) return;
    await fetch(`${API}/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    setNotifications([]);
  }

  const unreadCount = notifications.filter((n) => !n.read).length;
  const countLabel = unreadCount >= 5 ? '5+' : String(unreadCount);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' }}>
        Loading…
      </div>
    );
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
          <div style={{ fontSize: 13, marginBottom: 8, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.user?.email}
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/auth/login' })}
            style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13, width: '100%' }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <header style={{ height: 48, background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 24px', flexShrink: 0 }}>
          <div ref={bellRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setBellOpen((o) => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'relative', padding: 4 }}
              aria-label="Notifications"
            >
              <span style={{ fontSize: 20 }}>🔔</span>
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: -2, right: -2,
                  background: '#ef4444', color: '#fff',
                  borderRadius: '50%', width: 18, height: 18,
                  fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700,
                }}>
                  {countLabel}
                </span>
              )}
            </button>
            {bellOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 340, zIndex: 100,
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                  Notifications
                </div>
                {notifications.length === 0 ? (
                  <div style={{ padding: 16, color: '#64748b', fontSize: 14, textAlign: 'center' }}>
                    No unread notifications
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {notifications.slice(0, 5).map((n) => (
                      <li
                        key={n.id}
                        onClick={() => markRead(n)}
                        style={{
                          padding: '10px 16px', cursor: 'pointer',
                          borderBottom: '1px solid #f8fafc',
                          background: n.read ? '#fff' : '#f0f9ff',
                        }}
                      >
                        <div style={{ fontWeight: n.read ? 400 : 600, fontSize: 13, color: '#0f172a', marginBottom: 2 }}>
                          {n.title}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>
                          {n.body.length > 80 ? n.body.slice(0, 80) + '…' : n.body}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{relativeTime(n.createdAt)}</div>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    onClick={markAllRead}
                    style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 13, padding: 0 }}
                  >
                    Mark all read
                  </button>
                  <Link
                    href="/notifications"
                    onClick={() => setBellOpen(false)}
                    style={{ color: '#3b82f6', fontSize: 13, textDecoration: 'none' }}
                  >
                    View all →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </header>
        <main style={{ flex: 1, padding: 32, overflow: 'auto' }}>{children}</main>
      </div>
    </div>
  );
}
