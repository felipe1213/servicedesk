'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL;

type Notification = {
  id: string;
  title: string;
  body: string;
  ticketId?: string;
  read: boolean;
  createdAt: string;
};

export default function NotificationsPage() {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const token = (session as any)?.accessToken;

  async function load() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/notifications?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setNotifications(Array.isArray(data) ? data : []);
    } catch {
      // page stays empty
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [token]);

  async function markRead(id: string) {
    if (!token) return;
    await fetch(`${API}/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  async function markAllRead() {
    if (!token) return;
    await fetch(`${API}/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  if (loading) return <div style={{ color: '#64748b' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>Notifications</h1>
        <button
          onClick={markAllRead}
          style={{ background: 'none', border: '1px solid #e2e8f0', color: '#3b82f6', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
        >
          Mark all read
        </button>
      </div>
      {notifications.length === 0 ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 48 }}>No notifications yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {notifications.map((n) => (
            <li
              key={n.id}
              onClick={() => markRead(n.id)}
              style={{
                background: '#fff',
                borderRadius: 8,
                padding: '14px 16px',
                borderLeft: n.read ? '4px solid transparent' : '4px solid #3b82f6',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                cursor: 'pointer',
              }}
            >
              {n.ticketId ? (
                <Link
                  href={`/tickets/${n.ticketId}`}
                  style={{ textDecoration: 'none' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ fontWeight: n.read ? 400 : 600, fontSize: 14, color: '#0f172a', marginBottom: 4 }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>{n.body}</div>
                </Link>
              ) : (
                <>
                  <div style={{ fontWeight: n.read ? 400 : 600, fontSize: 14, color: '#0f172a', marginBottom: 4 }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>{n.body}</div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
