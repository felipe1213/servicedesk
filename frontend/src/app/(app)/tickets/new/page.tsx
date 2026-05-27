'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState, ChangeEvent } from 'react';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function NewTicketPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [attachWarning, setAttachWarning] = useState('');

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFileError('');
    const files = Array.from(e.target.files ?? []);
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setFileError(`${oversized.map(f => f.name).join(', ')} exceed${oversized.length === 1 ? 's' : ''} the 10 MB limit`);
      e.target.value = '';
      return;
    }
    setSelectedFiles(files);
  }

  function removeFile(name: string) {
    setSelectedFiles(prev => prev.filter(f => f.name !== name));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session) return;

    const form = new FormData(e.currentTarget);
    const body = {
      title: form.get('title'),
      description: form.get('description'),
      priority: form.get('priority'),
      category: form.get('category') || undefined,
      sourceChannel: 'WEB',
    };

    setLoading(true);
    setError('');
    setAttachWarning('');

    const token = (session as any).accessToken;
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? 'Failed to create ticket');
      return;
    }

    const ticket = await res.json();

    if (selectedFiles.length > 0) {
      let failCount = 0;
      for (const file of selectedFiles) {
        const fd = new FormData();
        fd.append('file', file);
        const uploadRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${ticket.id}/attachments`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!uploadRes.ok) failCount++;
      }
      if (failCount > 0) {
        setAttachWarning(`Ticket created, but ${failCount} attachment${failCount > 1 ? 's' : ''} failed to upload.`);
      }
    }

    router.push(`/tickets/${ticket.id}`);
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, color: '#0f172a', marginBottom: 24 }}>New Ticket</h1>

      <form onSubmit={handleSubmit} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32 }}>
        <Field label="Title" required>
          <input name="title" required maxLength={200} style={inputStyle} placeholder="Brief summary of the issue" />
        </Field>

        <Field label="Description" required>
          <textarea name="description" required rows={6} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Describe the issue in detail" />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Priority">
            <select name="priority" defaultValue="MEDIUM" style={inputStyle}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <input name="category" maxLength={100} style={inputStyle} placeholder="e.g. Hardware, Software" />
          </Field>
        </div>

        <Field label="Attachments">
          <input type="file" multiple onChange={handleFileChange} style={{ fontSize: 13 }} />
          {fileError && <p style={{ color: '#ef4444', fontSize: 13, marginTop: 4 }}>{fileError}</p>}
          {selectedFiles.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 13 }}>
              {selectedFiles.map(f => (
                <li key={f.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#374151' }}>
                  <span>{f.name}</span>
                  <button type="button" onClick={() => removeFile(f.name)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}>×</button>
                </li>
              ))}
            </ul>
          )}
        </Field>

        {error && <p style={{ color: '#ef4444', marginBottom: 16 }}>{error}</p>}
        {attachWarning && <p style={{ color: '#f59e0b', marginBottom: 16 }}>{attachWarning}</p>}

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="submit" disabled={loading || !!fileError} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '10px 24px', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500, opacity: loading || fileError ? 0.7 : 1 }}>
            {loading ? 'Submitting…' : 'Submit Ticket'}
          </button>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: '1px solid #e2e8f0', color: '#64748b', padding: '10px 24px', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
        {label}{required && <span style={{ color: '#ef4444' }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '9px 12px', fontSize: 14, color: '#0f172a', boxSizing: 'border-box', outline: 'none' };
