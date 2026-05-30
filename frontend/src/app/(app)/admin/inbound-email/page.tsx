'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, KeyboardEvent } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL;

export default function AdminInboundEmailPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;

  // Transport section
  const [transport, setTransport] = useState<'IMAP' | 'GRAPH' | 'NONE'>('NONE');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('');
  const [imapSecure, setImapSecure] = useState(false);
  const [imapUser, setImapUser] = useState('');
  const [imapPass, setImapPass] = useState('');
  const [imapMailbox, setImapMailbox] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [mailboxAddress, setMailboxAddress] = useState('');
  const [transportSaving, setTransportSaving] = useState(false);
  const [transportMsg, setTransportMsg] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  // Access control section
  const [mode, setMode] = useState<'ANYONE' | 'DOMAINS' | 'USERS'>('ANYONE');
  const [list, setList] = useState<string[]>([]);
  const [listInput, setListInput] = useState('');
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessMsg, setAccessMsg] = useState('');

  async function loadConfig() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/inbound-email/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setTransport(data.transport ?? 'NONE');
      if (data.transport === 'IMAP' && data.config) {
        setImapHost(data.config.host ?? '');
        setImapPort(String(data.config.port ?? ''));
        setImapSecure(data.config.secure ?? false);
        setImapUser(data.config.user ?? '');
        setImapPass(data.config.pass ?? '');
        setImapMailbox(data.config.mailbox ?? '');
      } else if (data.transport === 'GRAPH' && data.config) {
        setTenantId(data.config.tenantId ?? '');
        setClientId(data.config.clientId ?? '');
        setClientSecret(data.config.clientSecret ?? '');
        setMailboxAddress(data.config.mailboxAddress ?? '');
      }
    } catch {}
  }

  async function loadAccess() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/inbound-email/access`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setMode(data.mode ?? 'ANYONE');
      setList(data.list ?? []);
    } catch {}
  }

  useEffect(() => {
    loadConfig();
    loadAccess();
  }, [token]);

  async function saveConfig() {
    if (!token) return;
    const currentTransport = transport;
    const body: Record<string, unknown> = { transport: currentTransport };
    if (currentTransport === 'IMAP') {
      Object.assign(body, {
        host: imapHost,
        port: parseInt(imapPort, 10),
        secure: imapSecure,
        user: imapUser,
        pass: imapPass,
        mailbox: imapMailbox || 'INBOX',
      });
    } else if (currentTransport === 'GRAPH') {
      Object.assign(body, { tenantId, clientId, clientSecret, mailboxAddress });
    }
    setTransportSaving(true);
    setTransportMsg('');
    try {
      const res = await fetch(`${API}/inbound-email/config`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTransportMsg(res.ok ? 'Config saved.' : 'Error saving config.');
    } catch {
      setTransportMsg('Error saving config.');
    } finally {
      setTransportSaving(false);
    }
  }

  async function testPoll() {
    if (!token) return;
    setTestLoading(true);
    setTestMsg('');
    try {
      const res = await fetch(`${API}/inbound-email/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestMsg(res.ok ? `Processed ${data.processed} email(s).` : (data.message ?? 'Error running test poll.'));
    } catch {
      setTestMsg('Error running test poll.');
    } finally {
      setTestLoading(false);
    }
  }

  async function saveAccess() {
    if (!token) return;
    setAccessSaving(true);
    setAccessMsg('');
    try {
      const res = await fetch(`${API}/inbound-email/access`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, list }),
      });
      setAccessMsg(res.ok ? 'Access control saved.' : 'Error saving access control.');
    } catch {
      setAccessMsg('Error saving access control.');
    } finally {
      setAccessSaving(false);
    }
  }

  function addListEntry() {
    const entry = listInput.trim().toLowerCase();
    if (entry && !list.includes(entry)) {
      setList([...list, entry]);
    }
    setListInput('');
  }

  function handleListKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addListEntry(); }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0',
    borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: '#475569', marginBottom: 4, display: 'block',
  };
  const sectionStyle: React.CSSProperties = {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24,
  };
  const btnStyle: React.CSSProperties = {
    padding: '8px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: '#3b82f6', color: '#fff', fontSize: 14, fontWeight: 500,
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Inbound Email</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>
        Configure email-to-ticket ingestion via IMAP or Microsoft Graph.
      </p>

      {/* Transport & Credentials */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>Transport & Credentials</h2>

        <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
          {(['IMAP', 'GRAPH', 'NONE'] as const).map((t) => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
              <input type="radio" value={t} checked={transport === t} onChange={() => setTransport(t)} />
              {t === 'NONE' ? 'Disabled' : t === 'IMAP' ? 'IMAP' : 'Microsoft Graph'}
            </label>
          ))}
        </div>

        {transport === 'IMAP' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Host</label>
              <input style={inputStyle} value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.gmail.com" />
            </div>
            <div>
              <label style={labelStyle}>Port</label>
              <input style={inputStyle} type="number" value={imapPort} onChange={(e) => setImapPort(e.target.value)} placeholder="993" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} id="imap-secure" />
              <label htmlFor="imap-secure" style={{ fontSize: 14 }}>Use TLS</label>
            </div>
            <div>
              <label style={labelStyle}>Mailbox</label>
              <input style={inputStyle} value={imapMailbox} onChange={(e) => setImapMailbox(e.target.value)} placeholder="INBOX" />
            </div>
            <div>
              <label style={labelStyle}>Username</label>
              <input style={inputStyle} value={imapUser} onChange={(e) => setImapUser(e.target.value)} placeholder="helpdesk@contoso.com" />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input style={inputStyle} type="password" value={imapPass} onChange={(e) => setImapPass(e.target.value)} placeholder={imapPass === '***' ? 'Saved — enter new value to change' : ''} />
            </div>
          </div>
        )}

        {transport === 'GRAPH' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
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
              <input style={inputStyle} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={clientSecret === '***' ? 'Saved — enter new value to change' : ''} />
            </div>
            <div>
              <label style={labelStyle}>Mailbox Address</label>
              <input style={inputStyle} value={mailboxAddress} onChange={(e) => setMailboxAddress(e.target.value)} placeholder="helpdesk@contoso.com" />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={btnStyle} onClick={saveConfig} disabled={transportSaving}>
            {transportSaving ? 'Saving…' : 'Save'}
          </button>
          <button
            style={{ ...btnStyle, background: transport === 'NONE' ? '#94a3b8' : '#0f172a' }}
            onClick={testPoll}
            disabled={testLoading || transport === 'NONE'}
          >
            {testLoading ? 'Polling…' : 'Test Poll'}
          </button>
          {transportMsg && <span style={{ fontSize: 13, color: transportMsg.startsWith('Error') ? '#ef4444' : '#16a34a' }}>{transportMsg}</span>}
          {testMsg && <span style={{ fontSize: 13, color: testMsg.startsWith('Error') ? '#ef4444' : '#16a34a' }}>{testMsg}</span>}
        </div>
      </section>

      {/* Access Control */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>Access Control</h2>

        <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
          {([
            { value: 'ANYONE', label: 'Anyone' },
            { value: 'DOMAINS', label: 'Approved Domains' },
            { value: 'USERS', label: 'Specific Users' },
          ] as const).map(({ value, label }) => (
            <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
              <input type="radio" value={value} checked={mode === value} onChange={() => setMode(value)} />
              {label}
            </label>
          ))}
        </div>

        {(mode === 'DOMAINS' || mode === 'USERS') && (
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              {mode === 'DOMAINS' ? 'Allowed Domains' : 'Allowed Email Addresses'}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {list.map((entry) => (
                <span key={entry} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#e0f2fe', color: '#0369a1', borderRadius: 4, padding: '2px 8px', fontSize: 13 }}>
                  {entry}
                  <button onClick={() => setList(list.filter((e) => e !== entry))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0369a1', padding: 0, fontSize: 13 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...inputStyle, width: 'auto', flexGrow: 1 }}
                value={listInput}
                onChange={(e) => setListInput(e.target.value)}
                onKeyDown={handleListKeyDown}
                placeholder={mode === 'DOMAINS' ? 'contoso.com' : 'user@contoso.com'}
              />
              <button style={{ ...btnStyle, background: '#64748b' }} onClick={addListEntry}>Add</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={btnStyle} onClick={saveAccess} disabled={accessSaving}>
            {accessSaving ? 'Saving…' : 'Save Access Control'}
          </button>
          {accessMsg && <span style={{ fontSize: 13, color: accessMsg.startsWith('Error') ? '#ef4444' : '#16a34a' }}>{accessMsg}</span>}
        </div>
      </section>
    </div>
  );
}
