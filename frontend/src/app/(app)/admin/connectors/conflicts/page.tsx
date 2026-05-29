'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';

interface ConflictArticle {
  id: string; title: string; body: string; source: string; updatedAt: string;
  conflictData: { remoteTitle: string; remoteBody: string; remoteVersion: string; detectedAt: string };
}

export default function ConflictsPage() {
  const { data: session } = useSession();
  const [conflicts, setConflicts] = useState<ConflictArticle[]>([]);
  const [selected, setSelected] = useState<ConflictArticle | null>(null);
  const [resolving, setResolving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [mergedBody, setMergedBody] = useState('');

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  async function load() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/conflicts`, { headers: authHeaders() });
    if (res.ok) setConflicts(await res.json());
  }

  useEffect(() => { if (session) load().catch(() => {}); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolve(articleId: string, resolution: 'LOCAL' | 'REMOTE' | 'MERGED', merged?: string) {
    setResolving(true);
    try {
      const body: { resolution: string; mergedBody?: string } = { resolution };
      if (resolution === 'MERGED' && merged !== undefined) body.mergedBody = merged;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/conflicts/${articleId}/resolve`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
      });
      if (res.ok) {
        setSelected(null);
        setEditMode(false);
        setMergedBody('');
        await load();
      }
    } finally { setResolving(false); }
  }

  function openReview(article: ConflictArticle) {
    setSelected(article);
    setEditMode(false);
    setMergedBody(article.body);
  }

  function closeReview() {
    setSelected(null);
    setEditMode(false);
    setMergedBody('');
  }

  const connectorBadge = (source: string) => {
    const isSharepoint = source?.toUpperCase() === 'SHAREPOINT';
    const isConfluence = source?.toUpperCase() === 'CONFLUENCE';
    const bg = isSharepoint ? '#dbeafe' : isConfluence ? '#ccfbf1' : '#f1f5f9';
    const fg = isSharepoint ? '#1d4ed8' : isConfluence ? '#0d9488' : '#374151';
    return (
      <span style={{ padding: '2px 8px', borderRadius: 12, background: bg, color: fg, fontSize: 12, fontWeight: 600 }}>
        {source?.toUpperCase() ?? 'UNKNOWN'}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Conflict Resolution</h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>Review and resolve articles where remote content differs from local content.</p>

      {conflicts.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
          No conflicts — all synced.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontWeight: 600 }}>Article Title</th>
                <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontWeight: 600 }}>Connector</th>
                <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontWeight: 600 }}>Detected At</th>
                <th style={{ textAlign: 'right', padding: '12px 16px', color: '#64748b', fontWeight: 600 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map(article => (
                <tr key={article.id} style={{ borderBottom: '1px solid #f1f5f9', background: selected?.id === article.id ? '#f8fafc' : 'transparent' }}>
                  <td style={{ padding: '10px 16px', fontWeight: 500, color: '#0f172a' }}>{article.title}</td>
                  <td style={{ padding: '10px 16px' }}>{connectorBadge(article.source)}</td>
                  <td style={{ padding: '10px 16px', color: '#64748b' }}>{new Date(article.conflictData.detectedAt).toLocaleString()}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => selected?.id === article.id ? closeReview() : openReview(article)}
                      style={{ padding: '6px 14px', background: selected?.id === article.id ? '#e2e8f0' : '#3b82f6', color: selected?.id === article.id ? '#374151' : '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      {selected?.id === article.id ? 'Close' : 'Review'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Reviewing: {selected.title}</h2>
            <button onClick={closeReview} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#64748b', lineHeight: 1 }}>×</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Local Version</div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 16, minHeight: 200, fontSize: 14, color: '#1e293b', overflowY: 'auto', maxHeight: 400 }}>
                <ReactMarkdown>{selected.body}</ReactMarkdown>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Remote Version</div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 16, minHeight: 200, fontSize: 14, color: '#1e293b', overflowY: 'auto', maxHeight: 400 }}>
                <ReactMarkdown>{selected.conflictData.remoteBody}</ReactMarkdown>
              </div>
            </div>
          </div>

          {!editMode ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={() => resolve(selected.id, 'LOCAL')}
                disabled={resolving}
                style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                {resolving ? 'Resolving…' : 'Keep Local'}
              </button>
              <button
                onClick={() => resolve(selected.id, 'REMOTE')}
                disabled={resolving}
                style={{ padding: '8px 20px', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                {resolving ? 'Resolving…' : 'Accept Remote'}
              </button>
              <button
                onClick={() => setEditMode(true)}
                disabled={resolving}
                style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                Edit Merged
              </button>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Edit Merged Content</div>
              <textarea
                value={mergedBody}
                onChange={e => setMergedBody(e.target.value)}
                rows={12}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button
                  onClick={() => resolve(selected.id, 'MERGED', mergedBody)}
                  disabled={resolving}
                  style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                  {resolving ? 'Saving…' : 'Save Merged'}
                </button>
                <button
                  onClick={() => { setEditMode(false); setMergedBody(selected.body); }}
                  disabled={resolving}
                  style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
