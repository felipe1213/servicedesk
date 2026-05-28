'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface KbArticle {
  id: string; title: string; slug: string; status: string;
  tags: string[]; body: string; viewCount: number; updatedAt: string;
  author: { name: string } | null;
}

export default function KbPage() {
  const { data: session } = useSession();
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  function authHeaders() {
    return { Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    const t = setTimeout(() => {
      const url = query.trim()
        ? `${process.env.NEXT_PUBLIC_API_URL}/kb/search?q=${encodeURIComponent(query)}`
        : `${process.env.NEXT_PUBLIC_API_URL}/kb`;
      fetch(url, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : [])
        .then(setArticles)
        .catch(() => setArticles([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, query]);

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={{ marginBottom: 24, fontSize: 22, color: '#0f172a' }}>Knowledge Base</h1>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search articles…"
        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '10px 14px', fontSize: 14, marginBottom: 24, boxSizing: 'border-box' }}
      />
      {loading && <p style={{ color: '#64748b' }}>Loading…</p>}
      {!loading && articles.length === 0 && (
        <p style={{ color: '#94a3b8' }}>No articles found.</p>
      )}
      {articles.map(a => (
        <Link key={a.id} href={`/kb/${a.id}`} style={{ textDecoration: 'none' }}>
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, marginBottom: 12, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 16, color: '#0f172a', fontWeight: 600 }}>{a.title}</h2>
              <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0, marginLeft: 12 }}>{a.viewCount} views</span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
              {a.body.slice(0, 160)}…
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {a.tags.map(tag => (
                <span key={tag} style={{ background: '#eff6ff', color: '#3b82f6', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
