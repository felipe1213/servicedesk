'use client';

import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface KbArticle {
  id: string; title: string; body: string; status: string;
  tags: string[]; viewCount: number; slug: string;
  publishedAt: string | null; updatedAt: string;
  author: { name: string } | null;
}

export default function KbArticlePage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [article, setArticle] = useState<KbArticle | null>(null);
  const [error, setError] = useState('');
  const [deflected, setDeflected] = useState(false);

  function authHeaders() {
    return {
      Authorization: `Bearer ${(session as any)?.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  useEffect(() => {
    if (!session) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/kb/${id}`, {
      headers: { Authorization: `Bearer ${(session as any)?.accessToken}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setArticle)
      .catch(() => setError('Article not found'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, id]);

  async function handleDeflect() {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/kb/${id}/deflect`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ type: 'END_USER' }),
    });
    setDeflected(true);
  }

  if (error) {
    return (
      <div style={{ color: '#ef4444' }}>
        {error}{' '}
        <button onClick={() => router.back()} style={linkBtn}>← Back</button>
      </div>
    );
  }
  if (!article) return <div style={{ color: '#64748b' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 800 }}>
      <button onClick={() => router.push('/kb')} style={{ ...linkBtn, marginBottom: 16, display: 'block' }}>
        ← Knowledge Base
      </button>
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32 }}>
        <h1 style={{ margin: '0 0 16px', fontSize: 22, color: '#0f172a' }}>{article.title}</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {article.tags.map(tag => (
            <span key={tag} style={{ background: '#eff6ff', color: '#3b82f6', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
              {tag}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 24 }}>
          {article.author && <span>By {article.author.name} · </span>}
          {article.publishedAt && (
            <span>Published {new Date(article.publishedAt).toLocaleDateString()} · </span>
          )}
          <span>{article.viewCount} views</span>
        </div>
        <div style={{ color: '#374151', lineHeight: 1.7 }}>
          <ReactMarkdown>{article.body}</ReactMarkdown>
        </div>
        <div style={{ marginTop: 32 }}>
          {deflected ? (
            <p style={{ color: '#10b981', fontSize: 14, margin: 0 }}>✓ Marked as resolved</p>
          ) : (
            <button
              onClick={handleDeflect}
              style={{ background: '#10b981', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
            >
              This solved my issue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0, fontSize: 14,
};
