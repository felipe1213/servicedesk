'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL;

const ROLES = ['ADMIN', 'MANAGER', 'AGENT', 'END_USER'] as const;
type Role = (typeof ROLES)[number];

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  authProvider: string;
  createdAt: string;
};

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  AGENT: 'Agent',
  END_USER: 'End User',
};

const ROLE_COLORS: Record<Role, { bg: string; color: string }> = {
  ADMIN: { bg: '#fef3c7', color: '#92400e' },
  MANAGER: { bg: '#ede9fe', color: '#5b21b6' },
  AGENT: { bg: '#dbeafe', color: '#1e40af' },
  END_USER: { bg: '#f1f5f9', color: '#475569' },
};

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [search, setSearch] = useState('');

  async function loadUsers() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setUsers(await res.json());
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, [token]);

  async function updateRole(user: User, role: Role) {
    if (!token) return;
    setSaving(user.id);
    setMsg(null);
    try {
      const res = await fetch(`${API}/users/${user.id}/role`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role } : u));
        setMsg({ id: user.id, text: 'Role updated.', ok: true });
      } else {
        setMsg({ id: user.id, text: 'Failed to update role.', ok: false });
      }
    } catch {
      setMsg({ id: user.id, text: 'Failed to update role.', ok: false });
    } finally {
      setSaving(null);
    }
  }

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>User Management</h1>
      <p style={{ color: '#64748b', marginBottom: 24 }}>Manage user accounts and their roles.</p>

      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6,
            fontSize: 14, width: 300, boxSizing: 'border-box',
          }}
        />
      </div>

      {loading ? (
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading…</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Name</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Email</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Provider</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Role</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#475569' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user, i) => (
                <tr key={user.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 500 }}>{user.name}</td>
                  <td style={{ padding: '12px 16px', color: '#475569' }}>{user.email}</td>
                  <td style={{ padding: '12px 16px', color: '#475569' }}>
                    {user.authProvider === 'LOCAL' ? 'Local' : 'Entra ID'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      background: ROLE_COLORS[user.role].bg,
                      color: ROLE_COLORS[user.role].color,
                      marginBottom: 6,
                    }}>
                      {ROLE_LABELS[user.role]}
                    </span>
                    <select
                      value={user.role}
                      onChange={(e) => updateRole(user, e.target.value as Role)}
                      disabled={saving === user.id}
                      style={{
                        display: 'block',
                        padding: '4px 8px',
                        border: '1px solid #e2e8f0',
                        borderRadius: 4,
                        fontSize: 13,
                        color: '#0f172a',
                        cursor: 'pointer',
                        background: '#fff',
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>
                    {saving === user.id && <span style={{ color: '#64748b' }}>Saving…</span>}
                    {msg?.id === user.id && (
                      <span style={{ color: msg.ok ? '#16a34a' : '#ef4444' }}>{msg.text}</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12, color: '#94a3b8', fontSize: 12 }}>
        {filtered.length} of {users.length} user{users.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
