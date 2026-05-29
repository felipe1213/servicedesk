# Phase 5a — Configurable Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user drag-and-drop widget layout customisation to the dashboard, with Admin-settable role defaults.

**Architecture:** A new `DashboardModule` (service + controller) reads/writes `DashboardConfig` (personal layouts) and `AppConfig` (role defaults) with a three-tier fallback chain: personal → role default → hardcoded. The frontend dashboard gains a DnD edit mode using `@dnd-kit/sortable`; a new admin page at `/admin/dashboard-defaults` lets Admins set the per-role starting layout. No schema migration needed — `DashboardConfig` already exists.

**Tech Stack:** NestJS 10, Prisma 5, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`, Next.js 14 App Router, React, Jest + React Testing Library.

---

## File Map

### Backend — new files
- `backend/src/modules/dashboard/dashboard.module.ts`
- `backend/src/modules/dashboard/dashboard.service.ts`
- `backend/src/modules/dashboard/dashboard.controller.ts`
- `backend/src/modules/dashboard/dto/save-widget-layout.dto.ts`
- `backend/src/modules/dashboard/dashboard.service.spec.ts`

### Backend — modified files
- `backend/src/app.module.ts` — add `DashboardModule` import

### Frontend — new files
- `frontend/src/app/(app)/admin/dashboard-defaults/page.tsx`
- `frontend/src/app/(app)/dashboard/page.test.tsx`

### Frontend — modified files
- `frontend/src/app/(app)/dashboard/page.tsx` — extract widget components, add layout fetch, DnD edit mode
- `frontend/src/app/(app)/admin/page.tsx` — add 5th card; grid → `repeat(5, 1fr)`, maxWidth → 1400

---

## Task 1: Backend — DTO, DashboardService, and Unit Tests

**Files:**
- Create: `backend/src/modules/dashboard/dto/save-widget-layout.dto.ts`
- Create: `backend/src/modules/dashboard/dashboard.service.ts`
- Create: `backend/src/modules/dashboard/dashboard.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/modules/dashboard/dashboard.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService, WidgetConfig } from './dashboard.service';

const DEFAULT: WidgetConfig[] = [
  { id: 'total', visible: true, order: 0 },
  { id: 'byStatus', visible: true, order: 1 },
  { id: 'byPriority', visible: true, order: 2 },
];

const mockPrisma = {
  dashboardConfig: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  appConfig: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(DashboardService);
    jest.clearAllMocks();
  });

  describe('getConfig', () => {
    it('returns personal config when DashboardConfig exists for user', async () => {
      const personal: WidgetConfig[] = [
        { id: 'byStatus', visible: true, order: 0 },
        { id: 'total', visible: false, order: 1 },
        { id: 'byPriority', visible: true, order: 2 },
      ];
      mockPrisma.dashboardConfig.findUnique.mockResolvedValue({ widgetLayout: { widgets: personal } });

      const result = await service.getConfig('user-1', Role.AGENT);
      expect(result).toEqual(personal);
      expect(mockPrisma.appConfig.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to role default from AppConfig when no personal config', async () => {
      const roleDefault: WidgetConfig[] = [
        { id: 'byPriority', visible: true, order: 0 },
        { id: 'total', visible: true, order: 1 },
        { id: 'byStatus', visible: false, order: 2 },
      ];
      mockPrisma.dashboardConfig.findUnique.mockResolvedValue(null);
      mockPrisma.appConfig.findUnique.mockResolvedValue({
        value: JSON.stringify({ widgets: roleDefault }),
      });

      const result = await service.getConfig('user-1', Role.MANAGER);
      expect(result).toEqual(roleDefault);
    });

    it('falls back to hardcoded default when neither personal nor role default exists', async () => {
      mockPrisma.dashboardConfig.findUnique.mockResolvedValue(null);
      mockPrisma.appConfig.findUnique.mockResolvedValue(null);

      const result = await service.getConfig('user-1', Role.END_USER);
      expect(result).toEqual(DEFAULT);
    });
  });

  describe('saveConfig', () => {
    it('upserts DashboardConfig for the user with role and widgetLayout', async () => {
      mockPrisma.dashboardConfig.upsert.mockResolvedValue({});
      const widgets: WidgetConfig[] = [{ id: 'total', visible: true, order: 0 }];

      const result = await service.saveConfig('user-1', Role.AGENT, widgets);

      expect(mockPrisma.dashboardConfig.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', role: Role.AGENT, widgetLayout: { widgets } },
        update: { role: Role.AGENT, widgetLayout: { widgets } },
      });
      expect(result).toEqual(widgets);
    });
  });

  describe('getRoleDefault', () => {
    it('returns hardcoded default when AppConfig key is absent', async () => {
      mockPrisma.appConfig.findUnique.mockResolvedValue(null);
      const result = await service.getRoleDefault(Role.ADMIN);
      expect(result).toEqual(DEFAULT);
    });
  });

  describe('saveRoleDefault', () => {
    it('upserts AppConfig with key dashboard.default.{role}', async () => {
      mockPrisma.appConfig.upsert.mockResolvedValue({});
      const widgets: WidgetConfig[] = [{ id: 'byStatus', visible: true, order: 0 }];

      await service.saveRoleDefault(Role.MANAGER, widgets);

      expect(mockPrisma.appConfig.upsert).toHaveBeenCalledWith({
        where: { key: 'dashboard.default.MANAGER' },
        create: { key: 'dashboard.default.MANAGER', value: JSON.stringify({ widgets }) },
        update: { value: JSON.stringify({ widgets }) },
      });
    });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /path/to/servicedesk/backend
npm test -- --testPathPattern="dashboard.service" --watchAll=false 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './dashboard.service'`

- [ ] **Step 3: Create the DTO**

Create `backend/src/modules/dashboard/dto/save-widget-layout.dto.ts`:

```typescript
import { IsArray, IsBoolean, IsEnum, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export type WidgetId = 'total' | 'byStatus' | 'byPriority';

export class WidgetConfigItemDto {
  @IsEnum(['total', 'byStatus', 'byPriority'])
  id!: WidgetId;

  @IsBoolean()
  visible!: boolean;

  @IsInt()
  @Min(0)
  order!: number;
}

export class SaveWidgetLayoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WidgetConfigItemDto)
  widgets!: WidgetConfigItemDto[];
}
```

- [ ] **Step 4: Create DashboardService**

Create `backend/src/modules/dashboard/dashboard.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type WidgetId = 'total' | 'byStatus' | 'byPriority';

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  order: number;
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'total', visible: true, order: 0 },
  { id: 'byStatus', visible: true, order: 1 },
  { id: 'byPriority', visible: true, order: 2 },
];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(userId: string, role: Role): Promise<WidgetConfig[]> {
    const personal = await this.prisma.dashboardConfig.findUnique({ where: { userId } });
    if (personal) {
      return (personal.widgetLayout as { widgets: WidgetConfig[] }).widgets;
    }
    return this.getRoleDefault(role);
  }

  async saveConfig(userId: string, role: Role, widgets: WidgetConfig[]): Promise<WidgetConfig[]> {
    await this.prisma.dashboardConfig.upsert({
      where: { userId },
      create: { userId, role, widgetLayout: { widgets } },
      update: { role, widgetLayout: { widgets } },
    });
    return widgets;
  }

  async getRoleDefault(role: Role): Promise<WidgetConfig[]> {
    const record = await this.prisma.appConfig.findUnique({
      where: { key: `dashboard.default.${role}` },
    });
    if (!record) return DEFAULT_WIDGETS;
    return (JSON.parse(record.value) as { widgets: WidgetConfig[] }).widgets;
  }

  async saveRoleDefault(role: Role, widgets: WidgetConfig[]): Promise<WidgetConfig[]> {
    await this.prisma.appConfig.upsert({
      where: { key: `dashboard.default.${role}` },
      create: { key: `dashboard.default.${role}`, value: JSON.stringify({ widgets }) },
      update: { value: JSON.stringify({ widgets }) },
    });
    return widgets;
  }
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd backend
npm test -- --testPathPattern="dashboard.service" --watchAll=false 2>&1 | tail -10
```

Expected: `Tests: 7 passed, 7 total`

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/dashboard/
git commit -m "feat(dashboard): DashboardService with fallback chain + unit tests"
```

---

## Task 2: Backend — DashboardController, Module, and AppModule

**Files:**
- Create: `backend/src/modules/dashboard/dashboard.controller.ts`
- Create: `backend/src/modules/dashboard/dashboard.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create DashboardController**

Create `backend/src/modules/dashboard/dashboard.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { SaveWidgetLayoutDto } from './dto/save-widget-layout.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('config')
  getConfig(@Req() req: any) {
    return this.dashboardService.getConfig(req.user.id, req.user.role);
  }

  @Put('config')
  saveConfig(@Req() req: any, @Body() dto: SaveWidgetLayoutDto) {
    return this.dashboardService.saveConfig(req.user.id, req.user.role, dto.widgets);
  }

  @Get('defaults/:role')
  @Roles(Role.ADMIN)
  getRoleDefault(@Param('role') role: Role) {
    return this.dashboardService.getRoleDefault(role);
  }

  @Put('defaults/:role')
  @Roles(Role.ADMIN)
  saveRoleDefault(@Param('role') role: Role, @Body() dto: SaveWidgetLayoutDto) {
    return this.dashboardService.saveRoleDefault(role, dto.widgets);
  }
}
```

- [ ] **Step 2: Create DashboardModule**

Create `backend/src/modules/dashboard/dashboard.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

- [ ] **Step 3: Add DashboardModule to AppModule**

In `backend/src/app.module.ts`, add the import at the top and in the imports array:

```typescript
import { DashboardModule } from './modules/dashboard/dashboard.module';
```

Add `DashboardModule` to the `imports` array after `ConnectorsModule`:

```typescript
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  EventEmitterModule.forRoot(),
  ScheduleModule.forRoot(),
  ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
  PrismaModule,
  AuthModule,
  TicketsModule,
  UsersModule,
  AttachmentsModule,
  SlaModule,
  RoutingModule,
  KbModule,
  ConnectorsModule,
  DashboardModule,
],
```

- [ ] **Step 4: Verify the backend builds**

```bash
cd backend
npm run build 2>&1 | tail -5
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Run all backend tests to check for regressions**

```bash
cd backend
npm test 2>&1 | tail -10
```

Expected: all suites pass (existing 85 + new 7 = 92 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/dashboard/dashboard.controller.ts \
        backend/src/modules/dashboard/dashboard.module.ts \
        backend/src/app.module.ts
git commit -m "feat(dashboard): DashboardController and module wiring"
```

---

## Task 3: Frontend — Install @dnd-kit Packages

**Files:**
- Modify: `frontend/package.json` (via npm install)

- [ ] **Step 1: Install the packages**

```bash
cd frontend
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Verify the packages appear in package.json**

```bash
grep "@dnd-kit" frontend/package.json
```

Expected output (versions may vary):
```
"@dnd-kit/core": "^6.x.x",
"@dnd-kit/sortable": "^8.x.x",
"@dnd-kit/utilities": "^3.x.x",
```

- [ ] **Step 3: Verify TypeScript types resolve**

```bash
cd frontend
npx tsc --noEmit 2>&1 | grep "dnd-kit" | head -5
```

Expected: no output (no errors for dnd-kit).

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "feat(dashboard): add @dnd-kit packages for drag-and-drop"
```

---

## Task 4: Frontend — Refactor Dashboard Page with DnD Edit Mode

**Files:**
- Modify: `frontend/src/app/(app)/dashboard/page.tsx`

This replaces the existing dashboard page entirely. Read it first to confirm the current structure matches what's described above (three hardcoded sections: total, byStatus, byPriority), then overwrite it.

- [ ] **Step 1: Replace the dashboard page**

Write `frontend/src/app/(app)/dashboard/page.tsx`:

```typescript
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
          <StatCard key={s.status} label={s.status.replace('_', ' ')} value={s._count._all} color={STATUS_COLOR[s.status] ?? '#94a3b8'} />
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
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
  const [savedWidgets, setSavedWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
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
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/dashboard/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` },
        body: JSON.stringify({ widgets }),
      });
      if (res.ok) {
        setSavedWidgets(widgets);
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend
npx tsc --noEmit 2>&1 | grep -v "tickets/page.test\|kb/page.test" | head -20
```

Expected: no errors from `dashboard/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(dashboard): DnD edit mode with per-user layout customisation"
```

---

## Task 5: Frontend — Admin Dashboard-Defaults Page + Admin Landing Card

**Files:**
- Create: `frontend/src/app/(app)/admin/dashboard-defaults/page.tsx`
- Modify: `frontend/src/app/(app)/admin/page.tsx`

- [ ] **Step 1: Create the dashboard-defaults admin page**

Create `frontend/src/app/(app)/admin/dashboard-defaults/page.tsx`:

```typescript
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
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
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
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/dashboard/defaults/${r}`, {
      headers: authHeaders(),
    });
    if (res.ok) {
      const layout: WidgetConfig[] = await res.json();
      setWidgets([...layout].sort((a, b) => a.order - b.order));
    }
  }

  useEffect(() => {
    if (session) load(role).catch(() => {});
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRoleChange(r: RoleKey) {
    setRole(r);
    if (session) load(r).catch(() => {});
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
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/dashboard/defaults/${role}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ widgets }),
      });
      setMsg(res.ok ? 'Saved.' : 'Save failed.');
    } finally { setSaving(false); }
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
```

- [ ] **Step 2: Update the admin landing page**

Read `frontend/src/app/(app)/admin/page.tsx` first to confirm current content, then replace it with:

```typescript
'use client';

import Link from 'next/link';

export default function AdminPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Admin</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>Configure routing rules, SLA policies, knowledge base articles, external connectors, and dashboard defaults.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 20, maxWidth: 1400 }}>
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
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd frontend
npx tsc --noEmit 2>&1 | grep -v "tickets/page.test\|kb/page.test" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(app\)/admin/dashboard-defaults/page.tsx \
        frontend/src/app/\(app\)/admin/page.tsx
git commit -m "feat(dashboard): admin dashboard-defaults page and admin landing 5th card"
```

---

## Task 6: Frontend — Dashboard Page Component Tests

**Files:**
- Create: `frontend/src/app/(app)/dashboard/page.test.tsx`

- [ ] **Step 1: Write the tests**

Create `frontend/src/app/(app)/dashboard/page.test.tsx`:

```typescript
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardPage from './page';

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  closestCenter: jest.fn(),
  PointerSensor: class {},
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
}));

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  verticalListSortingStrategy: jest.fn(),
  arrayMove: jest.fn((arr: any[], from: number, to: number) => arr),
}));

jest.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}));

const { useSession } = require('next-auth/react');

const mockStats = {
  total: 42,
  byStatus: [{ status: 'NEW', _count: { _all: 10 } }],
  byPriority: [{ priority: 'HIGH', _count: { _all: 5 } }],
};

describe('DashboardPage', () => {
  beforeEach(() => {
    useSession.mockReturnValue({ data: { accessToken: 'tok' } });
  });

  it('renders widgets in saved order from layout config', async () => {
    const layout = [
      { id: 'byStatus', visible: true, order: 0 },
      { id: 'total', visible: true, order: 1 },
      { id: 'byPriority', visible: true, order: 2 },
    ];
    (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/tickets/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStats) });
      if (url.includes('/dashboard/config')) return Promise.resolve({ ok: true, json: () => Promise.resolve(layout) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    });

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('By Status')).toBeInTheDocument());
    expect(screen.getByText('Total Tickets')).toBeInTheDocument();
    expect(screen.getByText('By Priority')).toBeInTheDocument();
  });

  it('shows Customize button in normal mode', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/tickets/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStats) });
      if (url.includes('/dashboard/config')) return Promise.resolve({ ok: true, json: () => Promise.resolve([
        { id: 'total', visible: true, order: 0 },
        { id: 'byStatus', visible: true, order: 1 },
        { id: 'byPriority', visible: true, order: 2 },
      ]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    });

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /customize/i })).toBeInTheDocument());
  });

  it('does not render hidden widget in normal mode', async () => {
    const layout = [
      { id: 'total', visible: true, order: 0 },
      { id: 'byStatus', visible: true, order: 1 },
      { id: 'byPriority', visible: false, order: 2 },
    ];
    (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/tickets/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStats) });
      if (url.includes('/dashboard/config')) return Promise.resolve({ ok: true, json: () => Promise.resolve(layout) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    });

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Total Tickets')).toBeInTheDocument());
    expect(screen.queryByText('By Priority')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd frontend
npm test -- --testPathPattern="dashboard/page" --watchAll=false 2>&1 | tail -15
```

Expected: `Tests: 3 passed, 3 total`

If tests fail due to fetch mock setup, check that `global.fetch` is set as a `jest.Mock` — the `jest.fn()` pattern may need to be in a `beforeEach` rather than per-test if the component fetches on mount before the mock is set. Adjust to:

```typescript
beforeEach(() => {
  useSession.mockReturnValue({ data: { accessToken: 'tok' } });
  (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
    // default handler
  });
});
```

- [ ] **Step 3: Run all frontend tests**

```bash
cd frontend
npm test -- --watchAll=false 2>&1 | tail -15
```

Expected: all suites pass (existing 32 + new 3 = 35 tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(app\)/dashboard/page.test.tsx
git commit -m "test(dashboard): component tests for DashboardPage widget order, Customize button, hidden widgets"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run all backend tests**

```bash
cd backend
npm test 2>&1 | tail -10
```

Expected: all suites pass (92 tests across 11 suites).

- [ ] **Step 2: Run all frontend tests**

```bash
cd frontend
npm test -- --watchAll=false 2>&1 | tail -10
```

Expected: all suites pass (35 tests across 10 suites).

- [ ] **Step 3: Verify backend TypeScript build**

```bash
cd backend
npm run build 2>&1 | tail -5
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "chore: Phase 5a verification complete — configurable dashboard"
```
