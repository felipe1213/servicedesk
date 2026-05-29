# Phase 5a Design — Configurable Manager Dashboard

**Date:** 2026-05-29
**Status:** Approved
**Scope:** Make the existing dashboard widgets draggable and show/hide-able per user, with Admin-settable role defaults.

---

## What Was Already Built

Phase 2 shipped with:

- `/dashboard` page showing three stat sections: Total Tickets, By Status, By Priority — all hardcoded and non-configurable
- `DashboardConfig` model in the schema (`userId String @unique`, `role Role`, `widgetLayout Json`) — intentionally left dormant until this phase
- `AppConfig` key/value model — used by ConnectorConfigService for encrypted credential storage
- Global `JwtAuthGuard` + `RolesGuard` via `APP_GUARD`

---

## Architecture

A new **`DashboardModule`** owns all layout persistence. It reads/writes `DashboardConfig` (personal layouts) and `AppConfig` (role defaults). The frontend dashboard page gains drag-and-drop edit mode using `@dnd-kit/sortable`. No new Prisma schema migration is required.

---

## Data Model

### Widget Layout JSON

The `widgetLayout` field on `DashboardConfig` and the `value` field on `AppConfig` (for role defaults) both store the same JSON shape:

```typescript
type WidgetId = 'total' | 'byStatus' | 'byPriority';

interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  order: number;  // 0-indexed sort position; contiguous integers
}

// widgetLayout stored as: { widgets: WidgetConfig[] }
```

**Hardcoded app default** (used when no personal config and no role default exist):
```json
{
  "widgets": [
    { "id": "total",      "visible": true, "order": 0 },
    { "id": "byStatus",   "visible": true, "order": 1 },
    { "id": "byPriority", "visible": true, "order": 2 }
  ]
}
```

### Fallback Chain

When loading a user's layout, `DashboardService.getConfig()` applies:

1. Personal `DashboardConfig` record for `userId` → return `widgetLayout.widgets`
2. `AppConfig` key `dashboard.default.{user.role}` → parse and return
3. Hardcoded app default above

Role defaults take effect immediately for all users who have not saved a personal layout, so an Admin can set a sensible starting point for a new role without requiring each user to configure their own.

### AppConfig Keys

| Key | Description |
|---|---|
| `dashboard.default.ADMIN` | Role default layout for Admins |
| `dashboard.default.MANAGER` | Role default layout for Managers |
| `dashboard.default.AGENT` | Role default layout for Agents |
| `dashboard.default.END_USER` | Role default layout for End Users |

---

## Backend

### Files

- Create: `backend/src/modules/dashboard/dashboard.module.ts`
- Create: `backend/src/modules/dashboard/dashboard.service.ts`
- Create: `backend/src/modules/dashboard/dashboard.controller.ts`
- Create: `backend/src/modules/dashboard/dto/save-widget-layout.dto.ts`
- Create: `backend/src/modules/dashboard/dashboard.service.spec.ts`
- Modify: `backend/src/app.module.ts` — add `DashboardModule`

### `DashboardController`

All routes require authentication (global `JwtAuthGuard`). Role restriction on defaults endpoints only.

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/dashboard/config` | All | Get caller's layout — fallback chain applied |
| PUT | `/dashboard/config` | All | Save personal layout |
| GET | `/dashboard/defaults/:role` | ADMIN | Get role default layout |
| PUT | `/dashboard/defaults/:role` | ADMIN | Save role default layout |

### `DashboardService`

```typescript
// Returns the effective widget layout for a user — applies fallback chain
getConfig(userId: string, role: Role): Promise<WidgetConfig[]>

// Upserts DashboardConfig for userId; sets role field to current user role
saveConfig(userId: string, role: Role, widgets: WidgetConfig[]): Promise<WidgetConfig[]>

// Reads AppConfig key dashboard.default.{role}; returns hardcoded default if missing
getRoleDefault(role: Role): Promise<WidgetConfig[]>

// Upserts AppConfig key dashboard.default.{role}
saveRoleDefault(role: Role, widgets: WidgetConfig[]): Promise<WidgetConfig[]>
```

### `SaveWidgetLayoutDto`

```typescript
class WidgetConfigItemDto {
  @IsEnum(['total', 'byStatus', 'byPriority'])
  id: WidgetId;

  @IsBoolean()
  visible: boolean;

  @IsInt()
  @Min(0)
  order: number;
}

class SaveWidgetLayoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WidgetConfigItemDto)
  widgets: WidgetConfigItemDto[];
}
```

---

## Frontend

### Packages Added

```
@dnd-kit/core
@dnd-kit/sortable
@dnd-kit/utilities
```

### Files

- Modify: `frontend/src/app/(app)/dashboard/page.tsx` — add DnD edit mode, layout fetch, widget extraction
- Create: `frontend/src/app/(app)/admin/dashboard-defaults/page.tsx` — role default editor
- Modify: `frontend/src/app/(app)/admin/page.tsx` — add 5th card for Dashboard Defaults; grid → `repeat(5, 1fr)`, maxWidth → 1400

### Dashboard Page (`/dashboard`)

**On load:** fetch `GET /dashboard/config` and `GET /tickets/stats` in parallel.

**Normal mode:** widgets render in `order` sequence; widgets where `visible: false` are not rendered.

**Edit mode** (toggled by "Customize" button in the header):

- `DndContext` and `SortableContext` (vertical list strategy) wrap the widget list
- Each widget section is wrapped in a `useSortable` hook that provides `transform`, `transition`, `listeners`, and `setNodeRef`
- Drag handle (⠿ icon) on the left edge of each widget — `{...listeners}` attached to the handle only, not the whole widget
- Eye toggle button on the right edge — clicking flips `visible` in local state; the widget dims to 50% opacity but stays in the list (still draggable, position preserved for when it is re-enabled)
- On drag end: `arrayMove` reorders the widgets array; `order` values are recomputed as sequential integers
- "Save" button: `PUT /dashboard/config { widgets }` → on success, exit edit mode, update saved state
- "Cancel" button: restore last-fetched layout, exit edit mode — no API call
- "Customize" button in the header is replaced by "Save" and "Cancel" while in edit mode

**Widget components** (extracted from existing dashboard page):

```typescript
TotalWidget({ stats: Stats })       // total tickets stat card
ByStatusWidget({ stats: Stats })    // by-status grid of stat cards
ByPriorityWidget({ stats: Stats })  // by-priority grid of stat cards
```

Each component is a pure presentational component. The page imports them and renders them inside sortable wrappers only in edit mode.

**Render logic:**

```typescript
// In normal mode:
widgets
  .filter(w => w.visible)
  .sort((a, b) => a.order - b.order)
  .map(w => <WidgetForId id={w.id} stats={stats} />)

// In edit mode (inside DndContext + SortableContext):
widgets
  .sort((a, b) => a.order - b.order)
  .map(w => <SortableWidget key={w.id} config={w} stats={stats} onToggleVisible={...} />)
```

### Dashboard Defaults Page (`/admin/dashboard-defaults`)

Admin-only. Same DnD editor as the personal dashboard edit mode.

- Role selector (`<select>`) with options: ADMIN, MANAGER, AGENT, END_USER
- On role change: fetch `GET /dashboard/defaults/:role`
- DnD widget editor (identical to dashboard edit mode but always in edit state — no Customize toggle needed)
- "Save Defaults" button: `PUT /dashboard/defaults/:role { widgets }`
- Success/error inline message

### Admin Landing Page (`/admin`)

Add 5th card:
- Title: "Dashboard Defaults"
- Description: "Set the default widget layout for each role."
- Link: `/admin/dashboard-defaults`
- Grid: `repeat(5, 1fr)`, maxWidth: 1400

---

## Tests

### Backend Unit Tests (`dashboard.service.spec.ts`)

- `getConfig` returns personal config when `DashboardConfig` exists for user
- `getConfig` falls back to role default from `AppConfig` when no personal config
- `getConfig` falls back to hardcoded default when neither personal nor role default exists
- `saveConfig` creates new `DashboardConfig` when none exists (upsert)
- `saveConfig` updates existing `DashboardConfig`
- `getRoleDefault` returns hardcoded default when `AppConfig` key is absent
- `saveRoleDefault` upserts `AppConfig` key `dashboard.default.{role}`

### Frontend Component Tests

- Dashboard page renders widgets in saved order (mock `GET /dashboard/config`)
- "Customize" button is present in the rendered output
- Hidden widget (`visible: false`) is not rendered in normal mode

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `GET /dashboard/config` fails on load | Dashboard renders with hardcoded default; no crash |
| `PUT /dashboard/config` fails on save | Inline error message; edit mode stays open; layout not changed |
| `GET /dashboard/defaults/:role` fails | Admin page shows error; no crash |
| Invalid `WidgetId` in PUT body | `SaveWidgetLayoutDto` validation rejects with 400 |
| All widgets set to `visible: false` | Allowed — dashboard renders empty with an "All widgets hidden — click Customize to restore" hint |

---

## Out of Scope (Phase 5a)

- Adding new widget types beyond the existing three
- Per-ticket-view widgets or any widgets fetching data beyond `/tickets/stats`
- Resizable widgets or grid-based free-form layout (only vertical list reordering)
- Real-time / WebSocket data refresh
- Widget-level refresh intervals
