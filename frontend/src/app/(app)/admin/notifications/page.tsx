'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL;

const EVENT_LABELS: Record<string, string> = {
  'notification.event.ticket_created': 'Ticket created — email confirmation to submitter',
  'notification.event.ticket_assigned': 'Ticket assigned — in-app + email to assignee',
  'notification.event.ticket_commented': 'New comment — in-app + email to participants',
  'notification.event.ticket_status_changed': 'Status changed — in-app + email to creator',
  'notification.event.sla_breach': 'SLA breached — in-app + email to assignee and managers',
};

export default function AdminNotificationsPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;

  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [toggleSaving, setToggleSaving] = useState(false);
  const [toggleMsg, setToggleMsg] = useState('');

  const [transport, setTransport] = useState<'SMTP' | 'GRAPH' | 'NONE'>('NONE');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  async function loadToggles() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/notifications/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setToggles(await res.json());
    } catch {}
  }

  async function loadEmailConfig() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/notifications/email-config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setTransport(data.transport ?? 'NONE');
      if (data.transport === 'SMTP' && data.config) {
        setSmtpHost(data.config.host ?? '');
        setSmtpPort(String(data.config.port ?? ''));
        setSmtpSecure(data.config.secure ?? false);
        setSmtpUser(data.config.user ?? '');
        setSmtpPass(data.config.pass ?? '');
        setFromAddress(data.config.fromAddress ?? '');
      } else if (data.transport === 'GRAPH' && data.config) {
        setTenantId(data.config.tenantId ?? '');
        setClientId(data.config.clientId ?? '');
        setClientSecret(data.config.clientSecret ?? '');
        setFromAddress(data.config.fromAddress ?? '');
      }
    } catch {}
  }

  useEffect(() => {
    loadToggles();
    loadEmailConfig();
  }, [token]);

  async function saveToggles() {
    if (!token) return;
    const toSave = toggles;
    setToggleSaving(true);
    setToggleMsg('');
    try {
      const res = await fetch(`${API}/notifications/config`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toggles: toSave }),
      });
      setToggleMsg(res.ok ? 'Saved.' : 'Error saving toggles.');
    } catch {
      setToggleMsg('Error saving toggles.');
    } finally {
      setToggleSaving(false);
    }
  }

  async function saveEmailConfig() {
    if (!token) return;
    const currentTransport = transport;
    const body: Record<string, unknown> = { transport: currentTransport };
    if (currentTransport === 'SMTP') {
      Object.assign(body, {
        host: smtpHost, port: parseInt(smtpPort, 10), secure: smtpSecure,
        user: smtpUser, pass: smtpPass, fromAddress,
      });
    } else if (currentTransport === 'GRAPH') {
      Object.assign(body, { tenantId, clientId, clientSecret, fromAddress });
    }
    setEmailSaving(true);
    setEmailMsg('');
    try {
      const res = await fetch(`${API}/notifications/email-config`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setEmailMsg(res.ok ? 'Email config saved.' : 'Error saving email config.');
    } catch {
      setEmailMsg('Error saving email config.');
    } finally {
      setEmailSaving(false);
    }
  }

  async function sendTestEmail() {
    if (!token) return;
    setTestLoading(true);
    setTestMsg('');
    try {
      const res = await fetch(`${API}/notifications/email-config/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestMsg(res.ok ? 'Test email sent.' : (data.message ?? 'Error sending test email.'));
    } catch {
      setTestMsg('Error sending test email.');
    } finally {
      setTestLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0',
    borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: '#475569', marginBottom: 4, display: 'block',
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Notifications</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>
        Configure outbound notification events and email delivery.
      </p>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 16, marginTop: 0 }}>Event Toggles</h2>
        {Object.entries(EVENT_LABELS).map(([key, label]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!toggles[key]}
              onChange={(e) => setToggles((prev) => ({ ...prev, [key]: e.target.checked }))}
              style={{ marginTop: 2 }}
            />
            <span style={{ fontSize: 14, color: '#334155' }}>{label}</span>
          </label>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button
            onClick={saveToggles}
            disabled={toggleSaving}
            style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14 }}
          >
            {toggleSaving ? 'Saving…' : 'Save'}
          </button>
          {toggleMsg && (
            <span style={{ fontSize: 13, color: toggleMsg.startsWith('Error') ? '#ef4444' : '#22c55e' }}>
              {toggleMsg}
            </span>
          )}
        </div>
      </section>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 16, marginTop: 0 }}>Email Delivery</h2>
        <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
          {(['NONE', 'SMTP', 'GRAPH'] as const).map((t) => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
              <input type="radio" name="transport" value={t} checked={transport === t} onChange={() => setTransport(t)} />
              {t === 'NONE' ? 'None (disabled)' : t === 'SMTP' ? 'SMTP' : 'Microsoft Graph'}
            </label>
          ))}
        </div>

        {transport === 'SMTP' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Host</label>
              <input style={inputStyle} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div>
              <label style={labelStyle}>Port</label>
              <input style={inputStyle} type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="secure" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
              <label htmlFor="secure" style={{ fontSize: 14, cursor: 'pointer' }}>Use TLS/SSL</label>
            </div>
            <div>
              <label style={labelStyle}>Username</label>
              <input style={inputStyle} value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input
                style={inputStyle}
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={smtpPass === '***' ? 'saved — enter to change' : ''}
              />
            </div>
            <div>
              <label style={labelStyle}>From Address</label>
              <input style={inputStyle} type="email" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="noreply@example.com" />
            </div>
          </div>
        )}

        {transport === 'GRAPH' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Tenant ID</label>
              <input style={inputStyle} value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Client ID</label>
              <input style={inputStyle} value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Client Secret</label>
              <input
                style={inputStyle}
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={clientSecret === '***' ? 'saved — enter to change' : ''}
              />
            </div>
            <div>
              <label style={labelStyle}>From Address</label>
              <input style={inputStyle} type="email" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="noreply@example.com" />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={saveEmailConfig}
            disabled={emailSaving}
            style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14 }}
          >
            {emailSaving ? 'Saving…' : 'Save Email Config'}
          </button>
          <button
            onClick={sendTestEmail}
            disabled={testLoading || transport === 'NONE'}
            style={{ background: '#fff', color: '#3b82f6', border: '1px solid #3b82f6', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14 }}
          >
            {testLoading ? 'Sending…' : 'Send Test Email'}
          </button>
          {emailMsg && (
            <span style={{ fontSize: 13, color: emailMsg.startsWith('Error') ? '#ef4444' : '#22c55e' }}>
              {emailMsg}
            </span>
          )}
          {testMsg && (
            <span style={{ fontSize: 13, color: testMsg.startsWith('Error') ? '#ef4444' : '#22c55e' }}>
              {testMsg}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
