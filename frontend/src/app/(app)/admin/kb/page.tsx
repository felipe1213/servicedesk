'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface KbArticle {
  id: string; title: string; body: string; status: string;
  tags: string[]; viewCount: number; slug: string;
  publishedAt: string | null; updatedAt: string;
  author: { name: string } | null;
  source: string; externalUrl?: string;
}

const emptyForm = () => ({ title: '', body: '', tags: '', status: 'DRAFT' as 'DRAFT' | 'PUBLISHED' });

export default function AdminKbPage() {
  const { data: session } = useSession();
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [preview, setPreview] = useState(false);
  const [exportModal, setExportModal] = useState<{ articleId: string; title: string } | null>(null);
  const [exportConnector, setExportConnector] = useState<'SHAREPOINT' | 'CONFLUENCE'>('SHAREPOINT');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${(session as any)?.accessToken}`,
    };
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/kb`, {
        headers: { Authorization: `Bearer ${(session as any)?.accessToken}` },
      });
      if (res.ok) setArticles(await res.json());
    } catch {
      setError('Failed to load articles.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (session) load(); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleNew() {
    setEditId(null);
    setForm(emptyForm());
    setPreview(false);
    setShowForm(true);
  }

  function handleEdit(a: KbArticle) {
    setEditId(a.id);
    setForm({ title: a.title, body: a.body, tags: a.tags.join(', '), status: a.status as 'DRAFT' | 'PUBLISHED' });
    setPreview(false);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      title: form.title,
      body: form.body,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      status: form.status,
    };
    const url = editId
      ? `${process.env.NEXT_PUBLIC_API_URL}/kb/${editId}`
      : `${process.env.NEXT_PUBLIC_API_URL}/kb`;
    const res = await fetch(url, {
      method: editId ? 'PATCH' : 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (res.ok) { setShowForm(false); load(); }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this article?')) return;
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/kb/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${(session as any)?.accessToken}` },
    });
    load();
  }

  async function exportArticle() {
    if (!exportModal) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/export/${exportModal.articleId}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ connector: exportConnector }),
      });
      if (res.ok) {
        setExportModal(null);
        await load();
      } else {
        setExportError('Export failed. Please check connector configuration.');
      }
    } finally { setExporting(false); }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: '#0f172a' }}>Knowledge Base</h1>
        <button onClick={handleNew} style={primaryBtn}>New Article</button>
      </div>
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {loading && <p style={{ color: '#64748b' }}>Loading…</p>}

      {showForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16 }}>{editId ? 'Edit Article' : 'New Article'}</h2>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Title</label>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                required
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <label style={labelStyle}>Body (Markdown)</label>
                <button type="button" onClick={() => setPreview(p => !p)} style={ghostBtn}>
                  {preview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {preview ? (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, minHeight: 200, color: '#374151', lineHeight: 1.7 }}>
                  <ReactMarkdown>{form.body}</ReactMarkdown>
                </div>
              ) : (
                <textarea
                  value={form.body}
                  onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  rows={10}
                  required
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              )}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Tags (comma-separated)</label>
              <input
                value={form.tags}
                onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                style={inputStyle}
                placeholder="auth, login, vpn"
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as 'DRAFT' | 'PUBLISHED' }))}
                style={inputStyle}
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={primaryBtn}>
                {editId ? 'Save Changes' : 'Create Article'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} style={ghostBtn}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {!loading && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                {['Title', 'Status', 'Tags', 'Author', 'Updated', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {articles.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 500 }}>{a.title}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      background: a.status === 'PUBLISHED' ? '#dcfce7' : '#f1f5f9',
                      color: a.status === 'PUBLISHED' ? '#16a34a' : '#64748b',
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                    }}>
                      {a.status}
                    </span>
                    {a.source !== 'INTERNAL' && (
                      <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 6px', borderRadius: 10,
                        background: a.source === 'SHAREPOINT' ? '#dbeafe' : '#ccfbf1',
                        color: a.source === 'SHAREPOINT' ? '#1d4ed8' : '#0d9488', fontWeight: 600 }}>
                        {a.source}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{a.tags.join(', ') || '—'}</td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{a.author?.name ?? '—'}</td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 13 }}>
                    {new Date(a.updatedAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => handleEdit(a)} style={ghostBtn}>Edit</button>
                      <button onClick={() => handleDelete(a.id)} style={{ ...ghostBtn, color: '#ef4444' }}>Delete</button>
                      {a.source === 'INTERNAL' && (
                        <button onClick={() => setExportModal({ articleId: a.id, title: a.title })}
                          style={{ marginLeft: 6, padding: '3px 10px', fontSize: 12, background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>
                          Export
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {articles.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 24, color: '#94a3b8', textAlign: 'center' }}>
                    No articles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {exportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 32, width: 400 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Export Article</h2>
            <p style={{ color: '#64748b', marginBottom: 16, fontSize: 14 }}>{exportModal.title}</p>
            <div style={{ marginBottom: 20 }}>
              <label style={{ marginRight: 16 }}>
                <input type="radio" value="SHAREPOINT" checked={exportConnector === 'SHAREPOINT'} onChange={() => setExportConnector('SHAREPOINT')} /> SharePoint
              </label>
              <label>
                <input type="radio" value="CONFLUENCE" checked={exportConnector === 'CONFLUENCE'} onChange={() => setExportConnector('CONFLUENCE')} /> Confluence
              </label>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={exportArticle} disabled={exporting}
                style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                {exporting ? 'Exporting…' : 'Export'}
              </button>
              <button onClick={() => { setExportModal(null); setExportError(null); }}
                style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
            {exportError && (
              <div style={{ marginTop: 8, color: '#dc2626', fontSize: 13 }}>{exportError}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = { background: '#3b82f6', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
const ghostBtn: React.CSSProperties = { background: 'none', border: '1px solid #e2e8f0', color: '#374151', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, boxSizing: 'border-box' };
