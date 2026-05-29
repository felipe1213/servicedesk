'use client';

import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type WidgetId = 'total' | 'byStatus' | 'byPriority';

interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  order: number;
}

interface Stats {
  total: number;
  byStatus: { status: string; _count: { _all: number } }[];
  byPriority: { priority: string; _count: { _all: number } }[];
}

const STATUS_COLOR: Record<string, string> = {
  NEW: '#3b82f6',
  ASSIGNED: '#8b5cf6',
  IN_PROGRESS: '#f59e0b',
  PENDING: '#f97316',
  RESOLVED: '#10b981',
  CLOSED: '#6b7280',
};

const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#f59e0b',
  LOW: '#10b981',
};

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'total', visible: true, order: 0 },
  { id: 'byStatus', visible: true, order: 1 },
  { id: 'byPriority', visible: true, order: 2 },
];

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '20px 24px', borderTop: `3px solid ${color}` }}>
      <p style={{ margin: '0 0 8px', color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: '#0f172a' }}>{value}</p>
    </div>
  );
}

function TotalWidget({ stats }: { stats: Stats }) {
  return <StatCard label="Total Tickets" value={stats.total} color="#3b82f6" />;
}

function ByStatusWidget({ stats }: { stats: Stats }) {
  return (
    <>
      <h2 style={{ fontSize: 16, color: '#475569', margin: '0 0 12px' }}>By Status</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {stats.byStatus.map(s => (
          <StatCard key={s.status} label={s.status.replace(/_/g, ' ')} value={s._count._all} color={STATUS_COLOR[s.status] ?? '#94a3b8'} />
        ))}
      </div>
    </>
  );
}

function ByPriorityWidget({ stats }: { stats: Stats }) {
  return (
    <>
      <h2 style={{ fontSize: 16, color: '#475569', margin: '0 0 12px' }}>By Priority</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {stats.byPriority.map(p => (
          <StatCard key={p.priority} label={p.priority} value={p._count._all} color={PRIORITY_COLOR[p.priority] ?? '#94a3b8'} />
        ))}
      </div>
    </>
  );
}

function WidgetContent({ id, stats }: { id: WidgetId; stats: Stats }) {
  if (id === 'total') return <TotalWidget stats={stats} />;
  if (id === 'byStatus') return <ByStatusWidget stats={stats} />;
  return <ByPriorityWidget stats={stats} />;
}

function SortableWidget({ config, stats, onToggleVisible }: {
  config: WidgetConfig;
  stats: Stats;
  onToggleVisible: (id: WidgetId) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: config.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : config.visible ? 1 : 0.4,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        marginBottom: 24,
      }}
    >
      <button
        {...listeners}
        {...attributes}
        style={{ cursor: 'grab', background: 'none', border: 'none', padding: '4px 2px', color: '#94a3b8', fontSize: 18, lineHeight: 1, marginTop: 2, flexShrink: 0 }}
        title="Drag to reorder"
      >
        ⠿
      </button>
      <div style={{ flex: 1 }}>
        <WidgetContent id={config.id} stats={stats} />
      </div>
      <button
        onClick={() => onToggleVisible(config.id)}
        style={{ cursor: 'pointer', background: 'none', border: 'none', padding: '4px 6px', color: config.visible ? '#3b82f6' : '#94a3b8', fontSize: 16, flexShrink: 0, marginTop: 2 }}
        title={config.visible ? 'Hide widget' : 'Show widget'}
      >
        {config.visible ? '👁' : '🚫'}
      </button>
    </div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [widgets, setWidgets] = useState<WidgetConfig[]>([...DEFAULT_WIDGETS]);
  const [savedWidgets, setSavedWidgets] = useState<WidgetConfig[]>([...DEFAULT_WIDGETS]);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [statsError, setStatsError] = useState('');

  const sensors = useSensors(useSensor(PointerSensor));

  useEffect(() => {
    if (!session) return;
    const auth = { Authorization: `Bearer ${(session as any)?.accessToken}` };
    const api = process.env.NEXT_PUBLIC_API_URL;

    Promise.all([
      fetch(`${api}/tickets/stats`, { headers: auth }),
      fetch(`${api}/dashboard/config`, { headers: auth }),
    ]).then(async ([statsRes, configRes]) => {
      if (statsRes.ok) setStats(await statsRes.json());
      else setStatsError('Failed to load stats');
      if (configRes.ok) {
        const layout: WidgetConfig[] = await configRes.json();
        setWidgets(layout);
        setSavedWidgets(layout);
      }
      // config failure: keep DEFAULT_WIDGETS silently
    }).catch(() => setStatsError('Failed to load stats'));
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWidgets(prev => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const oldIndex = sorted.findIndex(w => w.id === active.id);
      const newIndex = sorted.findIndex(w => w.id === over.id);
      return arrayMove(sorted, oldIndex, newIndex).map((w, i) => ({ ...w, order: i }));
    });
  }

  function toggleVisible(id: WidgetId) {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
  }

  async function handleSave() {
    const widgetsToSave = widgets;
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/dashboard/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` },
        body: JSON.stringify({ widgets: widgetsToSave }),
      });
      if (res.ok) {
        setSavedWidgets(widgetsToSave);
        setEditMode(false);
      } else {
        setSaveError('Save failed. Please try again.');
      }
    } finally { setSaving(false); }
  }

  function handleCancel() {
    setWidgets(savedWidgets);
    setEditMode(false);
    setSaveError('');
  }

  const sortedWidgets = [...widgets].sort((a, b) => a.order - b.order);
  const visibleWidgets = sortedWidgets.filter(w => w.visible);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>Dashboard</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {!editMode && (
            <button
              onClick={() => setEditMode(true)}
              style={{ padding: '8px 16px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
            >
              Customize
            </button>
          )}
          {editMode && (
            <>
              {saveError && <span style={{ color: '#dc2626', fontSize: 13 }}>{saveError}</span>}
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={handleCancel}
                style={{ padding: '8px 16px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
              >
                Cancel
              </button>
            </>
          )}
          <Link
            href="/tickets/new"
            style={{ background: '#3b82f6', color: 'white', padding: '10px 20px', borderRadius: 6, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}
          >
            + New Ticket
          </Link>
        </div>
      </div>

      {statsError && <p style={{ color: '#ef4444' }}>{statsError}</p>}
      {!stats && !statsError && <p style={{ color: '#64748b' }}>Loading…</p>}

      {stats && !editMode && (
        <div>
          {visibleWidgets.length === 0 && (
            <p style={{ color: '#64748b' }}>
              All widgets hidden — click <strong>Customize</strong> to restore.
            </p>
          )}
          {visibleWidgets.map(w => (
            <div key={w.id} style={{ marginBottom: 32 }}>
              <WidgetContent id={w.id} stats={stats} />
            </div>
          ))}
          {visibleWidgets.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Link href="/tickets" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: 14 }}>
                View all tickets →
              </Link>
            </div>
          )}
        </div>
      )}

      {stats && editMode && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortedWidgets.map(w => w.id)} strategy={verticalListSortingStrategy}>
            {sortedWidgets.map(w => (
              <SortableWidget key={w.id} config={w} stats={stats} onToggleVisible={toggleVisible} />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
