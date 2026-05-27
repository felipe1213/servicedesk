'use client';

import { useSession } from 'next-auth/react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Ticket {
  id: string; title: string; status: string; priority: string;
  category: string | null; sourceChannel: string;
  createdBy: { name: string }; assignedTo: { id: string; name: string } | null;
  createdAt: string;
}
interface TicketPage { data: Ticket[]; total: number; page: number; limit: number }
interface Agent { id: string; name: string }

const STATUS_COLOR: Record<string, string> = { NEW: '#3b82f6', ASSIGNED: '#8b5cf6', IN_PROGRESS: '#f59e0b', PENDING: '#f97316', RESOLVED: '#10b981', CLOSED: '#6b7280' };
const PRIORITY_COLOR: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#10b981' };
const STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export default function TicketsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isAgent = ['ADMIN', 'MANAGER', 'AGENT'].includes((session as any)?.user?.role ?? '');

  const status = searchParams.get('status') ?? '';
  const priority = searchParams.get('priority') ?? '';
  const search = searchParams.get('search') ?? '';
  const page = Number(searchParams.get('page') ?? '1');

  const [result, setResult] = useState<TicketPage>({ data: [], total: 0, page: 1, limit: 25 });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [searchInput, setSearchInput] = useState(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function authHeaders() {
    return { Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value); else p.delete(key);
    if (key !== 'page') p.delete('page');
    router.replace(`${pathname}?${p.toString()}`);
  }

  useEffect(() => {
    const timer = setTimeout(() => setParam('search', searchInput), 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const fetchTickets = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (priority) p.set('priority', priority);
    if (search) p.set('search', search);
    p.set('page', String(page));
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets?${p}`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      setResult(await res.json());
    } catch {
      setError('Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [session, status, priority, search, page]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  useEffect(() => {
    if (!session || !isAgent) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/agents`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setAgents)
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function quickAssign(ticketId: string, assignedToId: string) {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedToId: assignedToId || null }),
    });
    fetchTickets();
  }

  const { data: tickets, total, limit } = result;
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>Tickets</h1>
        <Link href="/tickets/new" style={{ background: '#3b82f6', color: 'white', padding: '10px 20px', borderRadius: 6, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
          + New Ticket
        </Link>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          aria-label="Status"
          value={status}
          onChange={e => setParam('status', e.target.value)}
          style={selectStyle}
        >
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>

        <select
          aria-label="Priority"
          value={priority}
          onChange={e => setParam('priority', e.target.value)}
          style={selectStyle}
        >
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search tickets…"
            style={{ ...selectStyle, width: '100%', paddingRight: searchInput ? 32 : 12 }}
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setParam('search', ''); }}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 16 }}
            >×</button>
          )}
        </div>
      </div>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {loading && <p style={{ color: '#64748b' }}>Loading…</p>}

      {!loading && tickets.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: '#94a3b8' }}>
          <p style={{ fontSize: 18, marginBottom: 16 }}>No tickets found</p>
          {!status && !priority && !search && (
            <Link href="/tickets/new" style={{ color: '#3b82f6' }}>Create your first ticket</Link>
          )}
        </div>
      )}

      {tickets.length > 0 && (
        <>
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  {['Title', 'Status', 'Priority', ...(isAgent ? ['Assignee'] : ['Assigned To']), 'Created', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontWeight: 500, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 500 }}>
                      <div>{t.title}</div>
                      {t.category && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{t.category}</div>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Badge label={t.status.replace('_', ' ')} color={STATUS_COLOR[t.status]} />
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Badge label={t.priority} color={PRIORITY_COLOR[t.priority]} />
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {isAgent ? (
                        <select
                          value={t.assignedTo?.id ?? ''}
                          onChange={e => quickAssign(t.id, e.target.value)}
                          style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 8px', fontSize: 13, color: '#374151', background: 'white' }}
                        >
                          <option value="">— unassigned</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      ) : (
                        t.assignedTo?.name ?? '—'
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <Link href={`/tickets/${t.id}`} style={{ color: '#3b82f6', textDecoration: 'none', fontSize: 13 }}>View →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 13, color: '#64748b' }}>
            <span>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
                style={{ ...paginBtn, opacity: page <= 1 ? 0.4 : 1 }}
              >← Previous</button>
              <button
                disabled={page >= totalPages}
                onClick={() => setParam('page', String(page + 1))}
                style={{ ...paginBtn, opacity: page >= totalPages ? 0.4 : 1 }}
              >Next →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span style={{ background: `${color}18`, color, padding: '3px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>{label}</span>;
}

const selectStyle: React.CSSProperties = { border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#374151', background: 'white', boxSizing: 'border-box' };
const paginBtn: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 14px', background: 'white', cursor: 'pointer', fontSize: 13 };
