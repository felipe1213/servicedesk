'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Stats {
  total: number;
  byStatus: { status: string; _count: { _all: number } }[];
  byPriority: { priority: string; _count: { _all: number } }[];
}

const STATUS_COLOR: Record<string, string> = {
  NEW: '#3b82f6',
  ASSIGNED: '#8b5cf6',
  IN_PROGRESS: '#f59e0b',
  PENDING: '#f97316',
  RESOLVED: '#10b981',
  CLOSED: '#6b7280',
};

const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#f59e0b',
  LOW: '#10b981',
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session?.accessToken) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/stats`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setStats)
      .catch(() => setError('Failed to load stats'));
  }, [session]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>Dashboard</h1>
        <Link href="/tickets/new" style={{ background: '#3b82f6', color: 'white', padding: '10px 20px', borderRadius: 6, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
          + New Ticket
        </Link>
      </div>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}

      {!stats && !error && <p style={{ color: '#64748b' }}>Loading…</p>}

      {stats && (
        <>
          <StatCard label="Total Tickets" value={stats.total} color="#3b82f6" />

          <h2 style={{ fontSize: 16, color: '#475569', margin: '32px 0 12px' }}>By Status</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {stats.byStatus.map((s) => (
              <StatCard key={s.status} label={s.status.replace('_', ' ')} value={s._count._all} color={STATUS_COLOR[s.status] ?? '#94a3b8'} />
            ))}
          </div>

          <h2 style={{ fontSize: 16, color: '#475569', margin: '32px 0 12px' }}>By Priority</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {stats.byPriority.map((p) => (
              <StatCard key={p.priority} label={p.priority} value={p._count._all} color={PRIORITY_COLOR[p.priority] ?? '#94a3b8'} />
            ))}
          </div>

          <div style={{ marginTop: 32 }}>
            <Link href="/tickets" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: 14 }}>View all tickets →</Link>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '20px 24px', borderTop: `3px solid ${color}` }}>
      <p style={{ margin: '0 0 8px', color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: '#0f172a' }}>{value}</p>
    </div>
  );
}
