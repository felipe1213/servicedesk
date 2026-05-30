'use client';

import Link from 'next/link';

export default function AdminPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Admin</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>
        Configure routing rules, SLA policies, knowledge base articles, external connectors, dashboard defaults, and notifications.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 20, maxWidth: 1600 }}>
        <Link href="/admin/routing-rules" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Routing Rules</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Auto-assign tickets to agents or teams based on conditions.</div>
          </div>
        </Link>
        <Link href="/admin/sla-policies" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>SLA Policies</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Set response and resolution deadlines per priority level.</div>
          </div>
        </Link>
        <Link href="/admin/kb" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Knowledge Base</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Author and publish KB articles; track ticket deflection.</div>
          </div>
        </Link>
        <Link href="/admin/connectors" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Connectors</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Sync articles with SharePoint and Confluence.</div>
          </div>
        </Link>
        <Link href="/admin/dashboard-defaults" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Dashboard Defaults</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Set the default widget layout for each role.</div>
          </div>
        </Link>
        <Link href="/admin/notifications" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Notifications</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Configure outbound notification events and email delivery.</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
