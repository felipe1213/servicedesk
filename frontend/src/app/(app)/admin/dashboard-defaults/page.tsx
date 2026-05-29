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

type WidgetId = 'total' | 'byStatus' | 'byPriority';
type RoleKey = 'ADMIN' | 'MANAGER' | 'AGENT' | 'END_USER';

interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  order: number;
}

const WIDGET_LABELS: Record<WidgetId, string> = {
  total: 'Total Tickets',
  byStatus: 'By Status',
  byPriority: 'By Priority',
};

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'total', visible: true, order: 0 },
  { id: 'byStatus', visible: true, order: 1 },
  { id: 'byPriority', visible: true, order: 2 },
];

const ROLES: RoleKey[] = ['ADMIN', 'MANAGER', 'AGENT', 'END_USER'];

function SortableRow({ config, onToggleVisible }: {
  config: WidgetConfig;
  onToggleVisible: (id: WidgetId) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: config.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        marginBottom: 8,
      }}
    >
      <button
        {...listeners}
        {...attributes}
        style={{ cursor: 'grab', background: 'none', border: 'none', color: '#94a3b8', fontSize: 18, padding: 0, flexShrink: 0 }}
      >
        ⠿
      </button>
      <span style={{ flex: 1, fontSize: 14, color: config.visible ? '#0f172a' : '#94a3b8' }}>
        {WIDGET_LABELS[config.id]}
      </span>
      <button
        onClick={() => onToggleVisible(config.id)}
        style={{
          cursor: 'pointer',
          background: 'none',
          border: `1px solid ${config.visible ? '#3b82f6' : '#94a3b8'}`,
          fontSize: 12,
          color: config.visible ? '#3b82f6' : '#94a3b8',
          padding: '2px 8px',
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        {config.visible ? 'Visible' : 'Hidden'}
      </button>
    </div>
  );
}

export default function DashboardDefaultsPage() {
  const { data: session } = useSession();
  const [role, setRole] = useState<RoleKey>('ADMIN');
  const [widgets, setWidgets] = useState<WidgetConfig[]>([...DEFAULT_WIDGETS]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const sensors = useSensors(useSensor(PointerSensor));

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${(session as any)?.accessToken}`,
    };
  }

  async function load(r: RoleKey) {
    setMsg('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/dashboard/defaults/${r}`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const layout: WidgetConfig[] = await res.json();
        setWidgets([...layout].sort((a, b) => a.order - b.order));
      } else {
        setMsg('Failed to load defaults.');
      }
    } catch {
      setMsg('Failed to load defaults.');
    }
  }

  useEffect(() => {
    if (session) load(role);
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRoleChange(r: RoleKey) {
    setRole(r);
    if (session) load(r);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWidgets(prev => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const oldIdx = sorted.findIndex(w => w.id === active.id);
      const newIdx = sorted.findIndex(w => w.id === over.id);
      return arrayMove(sorted, oldIdx, newIdx).map((w, i) => ({ ...w, order: i }));
    });
  }

  function toggleVisible(id: WidgetId) {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
  }

  async function handleSave() {
    const widgetsToSave = widgets;
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/dashboard/defaults/${role}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ widgets: widgetsToSave }),
      });
      setMsg(res.ok ? 'Saved.' : 'Save failed.');
    } catch {
      setMsg('Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...widgets].sort((a, b) => a.order - b.order);

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Dashboard Defaults</h1>
      <p style={{ color: '#64748b', marginBottom: 24 }}>
        Set the default widget layout for each role. Users who have not customised their own dashboard will see this layout.
      </p>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Role</label>
        <select
          value={role}
          onChange={e => handleRoleChange(e.target.value as RoleKey)}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, width: '100%' }}
        >
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sorted.map(w => w.id)} strategy={verticalListSortingStrategy}>
          {sorted.map(w => (
            <SortableRow key={w.id} config={w} onToggleVisible={toggleVisible} />
          ))}
        </SortableContext>
      </DndContext>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
        >
          {saving ? 'Saving…' : 'Save Defaults'}
        </button>
        {msg && (
          <span style={{ fontSize: 13, color: msg === 'Saved.' ? '#16a34a' : '#dc2626' }}>{msg}</span>
        )}
      </div>
    </div>
  );
}
