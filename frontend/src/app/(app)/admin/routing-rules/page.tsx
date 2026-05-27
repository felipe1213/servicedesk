'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

interface Condition { field: string; operator: string; value: string }
interface RoutingRule {
  id: string; priorityOrder: number; conditions: Condition[];
  assignToAgentId: string | null; assignToAgent: { id: string; name: string } | null;
  assignToTeamId: string | null; assignToTeam: { id: string; name: string } | null;
  isActive: boolean;
}
interface Agent { id: string; name: string; email: string }

const FIELDS = ['category', 'channel', 'keyword'];
const OPERATORS: Record<string, string[]> = {
  category: ['eq'], channel: ['eq'], keyword: ['contains'],
};
const emptyCondition = (): Condition => ({ field: 'category', operator: 'eq', value: '' });
const emptyForm = () => ({ priorityOrder: 1, conditions: [emptyCondition()], assignToAgentId: '', assignToTeamId: '', isActive: true });

export default function RoutingRulesPage() {
  const { data: session } = useSession();
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  async function load() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    const [rRes, aRes] = await Promise.all([
      fetch(`${apiUrl}/routing-rules`, { headers: authHeaders() }),
      fetch(`${apiUrl}/users/agents`, { headers: authHeaders() }),
    ]);
    if (rRes.ok) setRules(await rRes.json());
    if (aRes.ok) setAgents(await aRes.json());
  }

  useEffect(() => { if (session) load(); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  function conditionSummary(conditions: Condition[]) {
    return conditions.map(c => `${c.field} ${c.operator === 'eq' ? '=' : 'contains'} "${c.value}"`).join(' AND ');
  }

  function assigneeName(rule: RoutingRule) {
    if (rule.assignToAgent) return `Agent: ${rule.assignToAgent.name}`;
    if (rule.assignToTeam) return `Team: ${rule.assignToTeam.name}`;
    return '—';
  }

  async function moveRule(rule: RoutingRule, direction: 'up' | 'down') {
    const sorted = [...rules].sort((a, b) => a.priorityOrder - b.priorityOrder);
    const idx = sorted.findIndex(r => r.id === rule.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const updated = sorted.map((r, i) => {
      if (i === idx) return { id: r.id, priorityOrder: sorted[swapIdx].priorityOrder };
      if (i === swapIdx) return { id: r.id, priorityOrder: sorted[idx].priorityOrder };
      return { id: r.id, priorityOrder: r.priorityOrder };
    });

    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/routing-rules/reorder`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ rules: updated }),
    });
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this routing rule?')) return;
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/routing-rules/${id}`, { method: 'DELETE', headers: authHeaders() });
    await load();
  }

  function handleEdit(rule: RoutingRule) {
    setEditId(rule.id);
    setForm({
      priorityOrder: rule.priorityOrder,
      conditions: rule.conditions.length > 0 ? rule.conditions : [emptyCondition()],
      assignToAgentId: rule.assignToAgentId ?? '',
      assignToTeamId: rule.assignToTeamId ?? '',
      isActive: rule.isActive,
    });
    setShowForm(true);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const body = {
      priorityOrder: form.priorityOrder,
      conditions: form.conditions,
      assignToAgentId: form.assignToAgentId || undefined,
      assignToTeamId: form.assignToTeamId || undefined,
      isActive: form.isActive,
    };
    const url = editId
      ? `${process.env.NEXT_PUBLIC_API_URL}/routing-rules/${editId}`
      : `${process.env.NEXT_PUBLIC_API_URL}/routing-rules`;
    const method = editId ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    if (!res.ok) { setError('Failed to save rule.'); return; }
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm());
    await load();
  }

  function updateCondition(idx: number, field: keyof Condition, value: string) {
    setForm(f => {
      const conditions = f.conditions.map((c, i) => {
        if (i !== idx) return c;
        const updated = { ...c, [field]: value };
        if (field === 'field') updated.operator = (OPERATORS[value] || ['eq'])[0];
        return updated;
      });
      return { ...f, conditions };
    });
  }

  const sorted = [...rules].sort((a, b) => a.priorityOrder - b.priorityOrder);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>Routing Rules</h1>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setForm(emptyForm()); setError(''); }}
          style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 14 }}
        >
          {showForm ? 'Cancel' : 'New Rule'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{editId ? 'Edit Rule' : 'New Rule'}</h2>
          {error && <div style={{ color: '#ef4444', marginBottom: 12 }}>{error}</div>}

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Priority Order</label>
            <input type="number" min={1} value={form.priorityOrder}
              onChange={e => setForm(f => ({ ...f, priorityOrder: Number(e.target.value) }))}
              style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: 80 }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Conditions (ALL must match)</label>
            {form.conditions.map((c, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select value={c.field} onChange={e => updateCondition(idx, 'field', e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px' }}>
                  {FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select value={c.operator} onChange={e => updateCondition(idx, 'operator', e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px' }}>
                  {(OPERATORS[c.field] || ['eq']).map(op => <option key={op} value={op}>{op}</option>)}
                </select>
                <input value={c.value} onChange={e => updateCondition(idx, 'value', e.target.value)}
                  placeholder="value" style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px', flex: 1 }} />
                {form.conditions.length > 1 && (
                  <button type="button" onClick={() => setForm(f => ({ ...f, conditions: f.conditions.filter((_, i) => i !== idx) }))}
                    style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setForm(f => ({ ...f, conditions: [...f.conditions, emptyCondition()] }))}
              style={{ fontSize: 13, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              + Add condition
            </button>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Assign to Agent</label>
            <select value={form.assignToAgentId} onChange={e => setForm(f => ({ ...f, assignToAgentId: e.target.value }))}
              style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px', minWidth: 200 }}>
              <option value="">— None —</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
              Active
            </label>
          </div>

          <button type="submit" style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer' }}>
            Save Rule
          </button>
        </form>
      )}

      {sorted.length === 0 ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>No routing rules yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              {['Order', 'Conditions', 'Assigned To', 'Active', 'Actions'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((rule, idx) => (
              <tr key={rule.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button onClick={() => moveRule(rule, 'up')} disabled={idx === 0}
                      style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#cbd5e1' : '#64748b', fontSize: 12 }}>▲</button>
                    <span style={{ textAlign: 'center', fontSize: 13 }}>{rule.priorityOrder}</span>
                    <button onClick={() => moveRule(rule, 'down')} disabled={idx === sorted.length - 1}
                      style={{ background: 'none', border: 'none', cursor: idx === sorted.length - 1 ? 'default' : 'pointer', color: idx === sorted.length - 1 ? '#cbd5e1' : '#64748b', fontSize: 12 }}>▼</button>
                  </div>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{conditionSummary(rule.conditions)}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{assigneeName(rule)}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: rule.isActive ? '#dcfce7' : '#f1f5f9', color: rule.isActive ? '#166534' : '#64748b' }}>
                    {rule.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <button onClick={() => handleEdit(rule)}
                    style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13, marginRight: 8 }}>Edit</button>
                  <button onClick={() => handleDelete(rule.id)}
                    style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: '#ef4444' }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
