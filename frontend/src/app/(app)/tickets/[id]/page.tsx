'use client';

import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, FormEvent, ChangeEvent } from 'react';

interface Comment { id: string; body: string; isInternal: boolean; createdAt: string; author: { name: string } }
interface AuditLog { id: string; action: string; oldValue: string | null; newValue: string | null; createdAt: string; actor: { name: string } }
interface Attachment { id: string; filename: string; mimeType: string; createdAt: string; downloadUrl: string }
interface Agent { id: string; name: string }
interface Ticket {
  id: string; title: string; description: string; status: string; priority: string;
  category: string | null; sourceChannel: string; createdAt: string; updatedAt: string;
  createdBy: { name: string; email: string };
  assignedTo: { id: string; name: string; email: string } | null;
  team: { name: string } | null;
  comments: Comment[];
  auditLogs: AuditLog[];
}

const STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'];
const STATUS_COLOR: Record<string, string> = { NEW: '#3b82f6', ASSIGNED: '#8b5cf6', IN_PROGRESS: '#f59e0b', PENDING: '#f97316', RESOLVED: '#10b981', CLOSED: '#6b7280' };
const PRIORITY_COLOR: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#10b981' };

export default function TicketDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [suggestions, setSuggestions] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [deflectingId, setDeflectingId] = useState<string | null>(null);

  const isAgent = ['ADMIN', 'MANAGER', 'AGENT'].includes((session as any)?.user?.role ?? '');

  function authHeaders() {
    return { Authorization: `Bearer ${(session as any)?.accessToken}`, 'Content-Type': 'application/json' };
  }

  useEffect(() => {
    if (!session) return;
    const h = { Authorization: `Bearer ${(session as any).accessToken}` };
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}`, { headers: h })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setTicket)
      .catch(() => setError('Ticket not found'));
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}/attachments`, { headers: h })
      .then(r => r.ok ? r.json() : [])
      .then(setAttachments)
      .catch(() => {});
    if (isAgent) {
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/agents`, { headers: h })
        .then(r => r.ok ? r.json() : [])
        .then(setAgents)
        .catch(() => {});
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/kb/suggest?ticketId=${id}`, { headers: h })
        .then(r => r.ok ? r.json() : [])
        .then(setSuggestions)
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, id]);

  async function updateStatus(status: string) {
    if (!ticket) return;
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status }),
    });
    if (res.ok) setTicket(t => t ? { ...t, status } : t);
  }

  async function updateAssignee(assignedToId: string) {
    if (!ticket) return;
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ assignedToId: assignedToId || null }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTicket(t => t ? { ...t, assignedTo: updated.assignedTo, status: updated.status } : t);
    }
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setSubmitting(true);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}/comments`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ body: commentBody, isInternal }),
    });
    setSubmitting(false);
    if (res.ok) {
      const comment = await res.json();
      setTicket(t => t ? { ...t, comments: [...t.comments, comment] } : t);
      setCommentBody(''); setIsInternal(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setUploadError('');
    if (file && file.size > 10 * 1024 * 1024) {
      setUploadError('File must be 10 MB or smaller');
      setUploadFile(null);
      e.target.value = '';
      return;
    }
    setUploadFile(file);
  }

  async function submitAttachment(e: FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    setUploadError('');
    const form = new FormData();
    form.append('file', uploadFile);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${(session as any)?.accessToken}` },
      body: form,
    });
    setUploading(false);
    if (res.ok) {
      const listRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}/attachments`, {
        headers: { Authorization: `Bearer ${(session as any)?.accessToken}` },
      });
      if (listRes.ok) setAttachments(await listRes.json());
      setUploadFile(null);
    } else {
      setUploadError('Upload failed. Try again.');
    }
  }

  async function deflectViaAgent(articleId: string) {
    setDeflectingId(articleId);
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/kb/${articleId}/deflect`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ type: 'AGENT', ticketId: id }),
    });
    setDeflectingId(null);
    // Refresh ticket to show RESOLVED status
    const h = { Authorization: `Bearer ${(session as any)?.accessToken}` };
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}`, { headers: h })
      .then(r => r.ok ? r.json() : null)
      .then(t => t && setTicket(t))
      .catch(() => {});
  }

  if (error) return <div style={{ color: '#ef4444' }}>{error} <button onClick={() => router.back()} style={linkBtn}>← Back</button></div>;
  if (!ticket) return <div style={{ color: '#64748b' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => router.push('/tickets')} style={linkBtn}>← All Tickets</button>
      </div>

      {/* Ticket header */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: '#0f172a', flex: 1 }}>{ticket.title}</h1>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
            <Badge label={ticket.status.replace('_', ' ')} color={STATUS_COLOR[ticket.status]} />
            <Badge label={ticket.priority} color={PRIORITY_COLOR[ticket.priority]} />
          </div>
        </div>

        <p style={{ color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 24 }}>{ticket.description}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, fontSize: 13, color: '#64748b' }}>
          <MetaItem label="Created by" value={ticket.createdBy.name} />
          <MetaItem label="Assigned to" value={ticket.assignedTo?.name ?? '—'} />
          <MetaItem label="Team" value={ticket.team?.name ?? '—'} />
          <MetaItem label="Channel" value={ticket.sourceChannel} />
          {ticket.category && <MetaItem label="Category" value={ticket.category} />}
          <MetaItem label="Created" value={new Date(ticket.createdAt).toLocaleString()} />
        </div>

        {isAgent && (
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #f1f5f9', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginRight: 8 }}>Status:</label>
              <select value={ticket.status} onChange={e => updateStatus(e.target.value)} style={agentSelect}>
                {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginRight: 8 }}>Assigned to:</label>
              <select value={ticket.assignedTo?.id ?? ''} onChange={e => updateAssignee(e.target.value)} style={agentSelect}>
                <option value="">— unassigned</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Comments */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32, marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 20px', fontSize: 16, color: '#0f172a' }}>Comments</h2>
        {ticket.comments.length === 0 && <p style={{ color: '#94a3b8', fontSize: 14 }}>No comments yet.</p>}
        {ticket.comments.map(c => (
          <div key={c.id} style={{ marginBottom: 16, padding: '12px 16px', background: c.isInternal ? '#fefce8' : '#f8fafc', borderRadius: 6, border: `1px solid ${c.isInternal ? '#fde68a' : '#e2e8f0'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{c.author.name}</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                {new Date(c.createdAt).toLocaleString()}
                {c.isInternal && <span style={{ marginLeft: 8, color: '#b45309', fontSize: 11 }}>internal</span>}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap' }}>{c.body}</p>
          </div>
        ))}
        <form onSubmit={submitComment} style={{ marginTop: 20 }}>
          <textarea value={commentBody} onChange={e => setCommentBody(e.target.value)} rows={3} placeholder="Add a comment…" style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '9px 12px', fontSize: 14, boxSizing: 'border-box', resize: 'vertical' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
            {isAgent && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748b', cursor: 'pointer' }}>
                <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />
                Internal note
              </label>
            )}
            <button type="submit" disabled={submitting || !commentBody.trim()} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 13, opacity: submitting || !commentBody.trim() ? 0.6 : 1 }}>
              {submitting ? 'Posting…' : 'Post Comment'}
            </button>
          </div>
        </form>
      </div>

      {/* Suggested KB Articles */}
      {isAgent && suggestions.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32, marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, color: '#0f172a' }}>Suggested Articles</h2>
          {suggestions.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <a href={`/kb/${s.id}`} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', fontSize: 14, textDecoration: 'none' }}>{s.title}</a>
              <button
                onClick={() => deflectViaAgent(s.id)}
                disabled={deflectingId === s.id}
                style={{ background: '#10b981', color: 'white', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, opacity: deflectingId === s.id ? 0.6 : 1 }}
              >
                {deflectingId === s.id ? 'Resolving…' : 'Resolved by this article'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Attachments */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32, marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 20px', fontSize: 16, color: '#0f172a' }}>Attachments</h2>
        {attachments.length === 0 && <p style={{ color: '#94a3b8', fontSize: 14 }}>No attachments yet.</p>}
        {attachments.map(a => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
            <span style={{ color: '#374151' }}>{a.filename}</span>
            <a href={a.downloadUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', fontSize: 13 }}>Download</a>
          </div>
        ))}
        <form onSubmit={submitAttachment} style={{ marginTop: 16 }}>
          <input type="file" onChange={handleFileChange} style={{ fontSize: 13, marginBottom: 8, display: 'block' }} />
          {uploadError && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{uploadError}</p>}
          <button type="submit" disabled={!uploadFile || uploading} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 13, opacity: !uploadFile || uploading ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : 'Upload File'}
          </button>
        </form>
      </div>

      {/* Activity log */}
      {ticket.auditLogs.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, color: '#0f172a' }}>Activity Log</h2>
          {ticket.auditLogs.map(log => (
            <div key={log.id} style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 13, color: '#64748b' }}>
              <span style={{ color: '#94a3b8', flexShrink: 0 }}>{new Date(log.createdAt).toLocaleString()}</span>
              <span><strong style={{ color: '#374151' }}>{log.actor.name}</strong> {formatAction(log)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatAction(log: AuditLog) {
  if (log.action === 'CREATED') return 'created this ticket';
  if (log.action === 'STATUS_CHANGED') return `changed status from ${log.oldValue} to ${log.newValue}`;
  if (log.action === 'ASSIGNED') return `assigned ticket to ${log.newValue}`;
  return log.action.toLowerCase().replace('_', ' ');
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span style={{ background: `${color}18`, color, padding: '3px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>{label}</span>;
}
function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
      <div style={{ color: '#374151', fontWeight: 500 }}>{value}</div>
    </div>
  );
}

const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0, fontSize: 14 };
const agentSelect: React.CSSProperties = { border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px', fontSize: 13, color: '#0f172a' };
