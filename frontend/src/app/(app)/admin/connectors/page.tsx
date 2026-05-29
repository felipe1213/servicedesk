'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ConnectorStatus {
  enabled: boolean;
  conflicts: number;
  lastSyncedAt: string | null;
}

const CARDS = [
  { label: 'SharePoint', connector: 'sharepoint' as const, href: '/admin/connectors/sharepoint' },
  { label: 'Confluence', connector: 'confluence' as const, href: '/admin/connectors/confluence' },
];

export default function ConnectorsPage() {
  const { data: session } = useSession();
  const [statuses, setStatuses] = useState<Record<string, ConnectorStatus>>({});

  useEffect(() => {
    if (!session) return;
    const api = process.env.NEXT_PUBLIC_API_URL;

    async function load() {
      const auth = { Authorization: `Bearer ${(session as any)?.accessToken}` };
      const [spRes, cfRes, conflictsRes, logsRes] = await Promise.all([
        fetch(`${api}/connectors/sharepoint/config`, { headers: auth }),
        fetch(`${api}/connectors/confluence/config`, { headers: auth }),
        fetch(`${api}/connectors/conflicts`, { headers: auth }),
        fetch(`${api}/connectors/logs`, { headers: auth }),
      ]);
      const conflicts: any[] = conflictsRes.ok ? await conflictsRes.json() : [];
      const spConfig = spRes.ok ? await spRes.json() : null;
      const cfConfig = cfRes.ok ? await cfRes.json() : null;
      const allLogs: any[] = logsRes.ok ? await logsRes.json() : [];

      const lastSync = (connector: string) => {
        const log = allLogs.find((l: any) => l.connector === connector);
        return log?.startedAt ?? null;
      };

      setStatuses({
        sharepoint: { enabled: spConfig?.enabled ?? false, conflicts: conflicts.filter((c: any) => c.source === 'SHAREPOINT').length, lastSyncedAt: lastSync('SHAREPOINT') },
        confluence: { enabled: cfConfig?.enabled ?? false, conflicts: conflicts.filter((c: any) => c.source === 'CONFLUENCE').length, lastSyncedAt: lastSync('CONFLUENCE') },
      });
    }
    load().catch(() => {});
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>External Connectors</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>Sync knowledge base articles with SharePoint and Confluence.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 640 }}>
        {CARDS.map(card => {
          const status = statuses[card.connector];
          return (
            <Link key={card.connector} href={card.href} style={{ textDecoration: 'none' }}>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a' }}>{card.label}</div>
                  {status && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: status.enabled ? '#dcfce7' : '#f1f5f9', color: status.enabled ? '#16a34a' : '#64748b', fontWeight: 600 }}>
                      {status.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  )}
                </div>
                {status?.conflicts > 0 && (
                  <div>
                    <Link href="/admin/connectors/conflicts" style={{ textDecoration: 'none' }}>
                      <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#fee2e2', color: '#dc2626', fontWeight: 600 }}>
                        {status.conflicts} conflict{status.conflicts !== 1 ? 's' : ''}
                      </span>
                    </Link>
                  </div>
                )}
                <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
                  Last sync: {status?.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'Never'}
                </div>
                <div style={{ color: '#64748b', fontSize: 14, marginTop: 4 }}>Configure sync settings and credentials.</div>
              </div>
            </Link>
          );
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        <Link href="/admin/connectors/conflicts" style={{ color: '#3b82f6', fontSize: 14 }}>View all conflicts →</Link>
      </div>
    </div>
  );
}
