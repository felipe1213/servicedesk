'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface SPConfig {
  tenantId: string; clientId: string; clientSecret: string;
  siteUrl: string; syncType: 'library' | 'pages';
  libraryName?: string; rootPageId?: string;
  enabled: boolean; syncIntervalMinutes: number;
}

interface SyncLog {
  id: string; startedAt: string; completedAt?: string;
  status: string; articlesNew: number; articlesUpdated: number; conflicts: number;
}

const empty: SPConfig = { tenantId: '', clientId: '', clientSecret: '', siteUrl: '', syncType: 'pages', enabled: false, syncIntervalMinutes: 60 };

export default function SharePointPage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<SPConfig>(empty);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [saveMsg, setSaveMsg] = useState('');

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  async function load() {
    const api = process.env.NEXT_PUBLIC_API_URL;
    const [cfgRes, logsRes] = await Promise.all([
      fetch(`${api}/connectors/sharepoint/config`, { headers: authHeaders() }),
      fetch(`${api}/connectors/logs`, { headers: authHeaders() }),
    ]);
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg) setForm({ ...empty, ...cfg, clientSecret: '' });
    }
    if (logsRes.ok) {
      const allLogs: SyncLog[] = await logsRes.json();
      setLogs(allLogs.filter((l: any) => l.connector === 'SHAREPOINT').slice(0, 10));
    }
  }

  useEffect(() => { if (session) load().catch(() => {}); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true); setSaveMsg('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/sharepoint/config`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(form),
      });
      setSaveMsg(res.ok ? 'Saved.' : 'Save failed.');
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/sharepoint/test`, { method: 'POST', headers: authHeaders() });
      setTestResult(await res.json());
    } finally { setTesting(false); }
  }

  async function syncNow() {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/sharepoint/sync`, { method: 'POST', headers: authHeaders() });
      if (res.ok) {
        const log: SyncLog = await res.json();
        setSyncResult(`Done — ${log.articlesNew} new, ${log.articlesUpdated} updated, ${log.conflicts} conflicts`);
        await load();
      }
    } finally { setSyncing(false); }
  }

  function field(label: string, key: keyof SPConfig, type = 'text') {
    return (
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
        <input
          type={type} value={(form[key] as string) ?? ''}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
        />
      </div>
    );
  }

  const badge = (status: string) => {
    const bg: Record<string, string> = { success: '#dcfce7', partial: '#fef9c3', failed: '#fee2e2', running: '#dbeafe' };
    const fg: Record<string, string> = { success: '#16a34a', partial: '#854d0e', failed: '#dc2626', running: '#1d4ed8' };
    return <span style={{ padding: '2px 8px', borderRadius: 12, background: bg[status] ?? '#f1f5f9', color: fg[status] ?? '#374151', fontSize: 12, fontWeight: 600 }}>{status}</span>;
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>SharePoint Connector</h1>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Credentials</h2>
        {field('Tenant ID', 'tenantId')}
        {field('Client ID', 'clientId')}
        {field('Client Secret', 'clientSecret', 'password')}
        {field('Site URL', 'siteUrl')}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Sync Scope</label>
          <label style={{ marginRight: 16 }}><input type="radio" value="pages" checked={form.syncType === 'pages'} onChange={() => setForm(f => ({ ...f, syncType: 'pages' }))} /> Site Pages</label>
          <label><input type="radio" value="library" checked={form.syncType === 'library'} onChange={() => setForm(f => ({ ...f, syncType: 'library' }))} /> Document Library</label>
        </div>

        {form.syncType === 'library' && field('Library Name', 'libraryName')}
        {form.syncType === 'pages' && field('Root Page ID (optional)', 'rootPageId')}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Sync Interval</label>
          <select value={form.syncIntervalMinutes} onChange={e => setForm(f => ({ ...f, syncIntervalMinutes: Number(e.target.value) }))}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={360}>6 hours</option>
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
            Enable automatic sync
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={save} disabled={saving}
            style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={test} disabled={testing}
            style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button onClick={syncNow} disabled={syncing}
            style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
          {saveMsg && <span style={{ fontSize: 13, color: '#16a34a' }}>{saveMsg}</span>}
        </div>

        {testResult && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: testResult.ok ? '#dcfce7' : '#fee2e2', color: testResult.ok ? '#16a34a' : '#dc2626', fontSize: 13 }}>
            {testResult.message}
          </div>
        )}
        {syncResult && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: '#dbeafe', color: '#1d4ed8', fontSize: 13 }}>{syncResult}</div>
        )}
      </div>

      {logs.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Sync History</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#64748b' }}>Started</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>Duration</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>New</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>Updated</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>Conflicts</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: '#64748b' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px' }}>{new Date(log.startedAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {log.completedAt ? (() => {
                      const secs = Math.round((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000);
                      return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
                    })() : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{log.articlesNew}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{log.articlesUpdated}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{log.conflicts}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>{badge(log.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
