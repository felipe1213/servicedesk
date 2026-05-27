'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

interface SlaPolicy {
  id: string; name: string; priorityLevel: string;
  responseTimeMinutes: number; resolutionTimeMinutes: number;
  breachAction: string; escalateToUserId: string | null; escalateToTeamId: string | null;
}
interface Agent { id: string; name: string; email: string }

const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const BREACH_ACTIONS = ['FLAG', 'ESCALATE', 'BOTH'];
const PRIORITY_COLOR: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#10b981' };

const emptyForm = (priority: string) => ({
  name: `${priority} SLA`, priorityLevel: priority,
  responseTimeMinutes: 60, resolutionTimeMinutes: 480,
  breachAction: 'FLAG', escalateToUserId: '',
});

export default function SlaPoliciesPage() {
  const { data: session } = useSession();
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editPriority, setEditPriority] = useState<string | null>(null);
  const [form, setForm] = useState<ReturnType<typeof emptyForm> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  async function load() {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      const [pRes, aRes] = await Promise.all([
        fetch(`${apiUrl}/sla-policies`, { headers: authHeaders() }),
        fetch(`${apiUrl}/users/agents`, { headers: authHeaders() }),
      ]);
      if (pRes.ok) setPolicies(await pRes.json());
      if (aRes.ok) setAgents(await aRes.json());
    } catch {
      setError('Failed to load SLA policies.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (session) load(); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(priority: string) {
    const existing = policies.find(p => p.priorityLevel === priority);
    setEditPriority(priority);
    setForm(existing
      ? { name: existing.name, priorityLevel: existing.priorityLevel, responseTimeMinutes: existing.responseTimeMinutes, resolutionTimeMinutes: existing.resolutionTimeMinutes, breachAction: existing.breachAction, escalateToUserId: existing.escalateToUserId ?? '' }
      : emptyForm(priority));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError('');
    const existing = policies.find(p => p.priorityLevel === form.priorityLevel);
    const body = {
      ...form,
      escalateToUserId: form.escalateToUserId || undefined,
    };
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    const url = existing ? `${apiUrl}/sla-policies/${existing.id}` : `${apiUrl}/sla-policies`;
    const method = existing ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    if (!res.ok) { setError('Failed to save policy.'); return; }
    setEditPriority(null);
    setForm(null);
    await load();
  }

  const showEscalation = form && (form.breachAction === 'ESCALATE' || form.breachAction === 'BOTH');

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>SLA Policies</h1>
      <p style={{ color: '#64748b', marginBottom: 24 }}>Configure response and resolution deadlines per priority level.</p>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {loading && <p style={{ color: '#64748b' }}>Loading…</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {PRIORITIES.map(priority => {
          const policy = policies.find(p => p.priorityLevel === priority);
          const isEditing = editPriority === priority;

          return (
            <div key={priority} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isEditing ? 16 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: PRIORITY_COLOR[priority] + '20', color: PRIORITY_COLOR[priority] }}>{priority}</span>
                  {policy && !isEditing && (
                    <span style={{ fontSize: 13, color: '#374151' }}>
                      Response: <strong>{policy.responseTimeMinutes}min</strong> · Resolution: <strong>{policy.resolutionTimeMinutes}min</strong> · On breach: <strong>{policy.breachAction}</strong>
                    </span>
                  )}
                  {!policy && !isEditing && <span style={{ fontSize: 13, color: '#94a3b8' }}>Not configured</span>}
                </div>
                <button onClick={() => isEditing ? (setEditPriority(null), setForm(null)) : startEdit(priority)}
                  style={{ fontSize: 13, background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', color: isEditing ? '#64748b' : '#3b82f6' }}>
                  {isEditing ? 'Cancel' : (policy ? 'Edit' : 'Add')}
                </button>
              </div>

              {isEditing && form && (
                <form onSubmit={handleSubmit}>
                  {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4, color: '#64748b' }}>Name</label>
                      <input value={form.name} onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))}
                        style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: '100%', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4, color: '#64748b' }}>Response (min)</label>
                      <input type="number" min={1} value={form.responseTimeMinutes}
                        onChange={e => setForm(f => f && ({ ...f, responseTimeMinutes: Number(e.target.value) }))}
                        style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: '100%', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4, color: '#64748b' }}>Resolution (min)</label>
                      <input type="number" min={1} value={form.resolutionTimeMinutes}
                        onChange={e => setForm(f => f && ({ ...f, resolutionTimeMinutes: Number(e.target.value) }))}
                        style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: '100%', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4, color: '#64748b' }}>On Breach</label>
                      <select value={form.breachAction} onChange={e => setForm(f => f && ({ ...f, breachAction: e.target.value }))}
                        style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: '100%' }}>
                        {BREACH_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    {showEscalation && (
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4, color: '#64748b' }}>Escalate To (Agent)</label>
                        <select value={form.escalateToUserId} onChange={e => setForm(f => f && ({ ...f, escalateToUserId: e.target.value }))}
                          style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: '100%' }}>
                          <option value="">— None —</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  <button type="submit" style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14 }}>
                    Save Policy
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
