# Phase 3 Design — Routing Rules Engine + SLA Policies

**Date:** 2026-05-27  
**Status:** Approved  
**Scope:** Routing rules engine (auto-assign tickets on creation) and SLA policies (deadline stamping, breach detection, configurable escalation) — both fully configurable via an admin UI.

---

## What Was Already Built

Phase 2 shipped with:

- Full ticket CRUD, state machine, comments, audit log
- Role-based visibility, agent assignment UI, file attachments
- `RoutingRule` and `SlaPolicy` Prisma models already defined
- `Ticket` model already has `responseDeadline`, `resolutionDeadline`, `slaBreached`, `slaPolicyId`
- `AppConfig` key/value store available for global admin settings

---

## Architecture

**Two new NestJS modules kept separate** — their runtime behaviors are fundamentally different:

- **`RoutingModule`** is event-driven: listens for `ticket.created` and applies rules synchronously at creation time.
- **`SlaModule`** is time-driven: stamps deadlines at creation and runs a cron job every minute to detect breaches.

Both expose admin CRUD endpoints. `TicketsModule` emits `ticket.created` after a successful create and calls `SlaService.stampDeadlines()` directly (direct call is simpler than an event for deadline stamping since it needs to happen before the response is returned).

New packages required: `@nestjs/event-emitter`, `@nestjs/schedule`.

---

## Schema Changes

One migration adds three fields to `SlaPolicy` and a new enum:

```prisma
enum BreachAction {
  FLAG
  ESCALATE
  BOTH
}

model SlaPolicy {
  // existing fields unchanged
  id                    String        @id @default(cuid())
  name                  String
  priorityLevel         Priority      @unique
  responseTimeMinutes   Int
  resolutionTimeMinutes Int
  tickets               Ticket[]
  createdAt             DateTime      @default(now())
  updatedAt             DateTime      @updatedAt
  // new fields
  breachAction          BreachAction  @default(FLAG)
  escalateToUserId      String?
  escalateToUser        User?         @relation("SlaEscalateToUser", fields: [escalateToUserId], references: [id])
  escalateToTeamId      String?
  escalateToTeam        Team?         @relation("SlaEscalateToTeam", fields: [escalateToTeamId], references: [id])
}
```

No changes to `RoutingRule` or `Ticket` — both already have all needed fields.

---

## Backend

### `RoutingModule`

**Files:**
- `backend/src/modules/routing/routing.module.ts`
- `backend/src/modules/routing/routing.service.ts`
- `backend/src/modules/routing/routing.listener.ts`
- `backend/src/modules/routing/routing.controller.ts`
- `backend/src/modules/routing/dto/create-routing-rule.dto.ts`
- `backend/src/modules/routing/dto/update-routing-rule.dto.ts`
- `backend/src/modules/routing/dto/reorder-rules.dto.ts`
- `backend/src/modules/routing/routing.service.spec.ts`

**`RoutingService`:**

- `findAll()` — returns all rules ordered by `priorityOrder`.
- `create(dto)` — creates a rule; if `priorityOrder` conflicts, shifts existing rules down.
- `update(id, dto)` — partial update.
- `reorder(dto)` — accepts `[{ id, priorityOrder }]`, bulk-updates order in a transaction.
- `remove(id)` — deletes rule.
- `applyRules(ticket)` — fetches active rules ordered by `priorityOrder`; evaluates each rule's `conditions` array against the ticket; stops at first full match; calls `TicketsService.update()` with `assignedToId` or `teamId`.

**Condition evaluation logic:**

```typescript
type Condition = { field: 'category' | 'channel' | 'keyword'; operator: 'eq' | 'contains'; value: string };

function matchesCondition(condition: Condition, ticket: Ticket): boolean {
  if (condition.field === 'category') return ticket.category === condition.value;
  if (condition.field === 'channel') return ticket.sourceChannel === condition.value;
  if (condition.field === 'keyword') {
    const haystack = `${ticket.title} ${ticket.description}`.toLowerCase();
    return haystack.includes(condition.value.toLowerCase());
  }
  return false;
}

function ruleMatches(conditions: Condition[], ticket: Ticket): boolean {
  return conditions.every(c => matchesCondition(c, ticket));
}
```

**`RoutingListener`:**

```typescript
@Injectable()
export class RoutingListener {
  constructor(private routing: RoutingService) {}

  @OnEvent('ticket.created')
  async handle(ticket: Ticket) {
    try {
      await this.routing.applyRules(ticket);
    } catch (err) {
      // log and swallow — routing failure must never break ticket creation
    }
  }
}
```

**`RoutingController`** — all routes require `ADMIN` or `MANAGER` role:

| Method | Path | Description |
|---|---|---|
| GET | `/routing-rules` | List all rules ordered by priorityOrder |
| POST | `/routing-rules` | Create a rule |
| PATCH | `/routing-rules/reorder` | Bulk-update order |
| PATCH | `/routing-rules/:id` | Update a rule |
| DELETE | `/routing-rules/:id` | Delete a rule |

**DTOs:**

`CreateRoutingRuleDto`:
```typescript
class ConditionDto {
  @IsEnum(['category', 'channel', 'keyword']) field: string;
  @IsEnum(['eq', 'contains']) operator: string;
  @IsString() @IsNotEmpty() value: string;
}

class CreateRoutingRuleDto {
  @IsInt() @Min(1) priorityOrder: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ConditionDto) conditions: ConditionDto[];
  @IsString() @IsOptional() assignToAgentId?: string;
  @IsString() @IsOptional() assignToTeamId?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
```

`UpdateRoutingRuleDto` — all fields optional (PartialType of CreateRoutingRuleDto).

`ReorderRulesDto`:
```typescript
class ReorderItemDto {
  @IsString() id: string;
  @IsInt() @Min(1) priorityOrder: number;
}
class ReorderRulesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReorderItemDto) rules: ReorderItemDto[];
}
```

---

### `SlaModule`

**Files:**
- `backend/src/modules/sla/sla.module.ts`
- `backend/src/modules/sla/sla.service.ts`
- `backend/src/modules/sla/sla.controller.ts`
- `backend/src/modules/sla/dto/create-sla-policy.dto.ts`
- `backend/src/modules/sla/dto/update-sla-policy.dto.ts`
- `backend/src/modules/sla/sla.service.spec.ts`

**`SlaService`:**

- `findAll()` — returns all SLA policies.
- `create(dto)` — creates a policy; 409 if `priorityLevel` already has a policy.
- `update(id, dto)` — partial update.
- `remove(id)` — deletes policy.
- `stampDeadlines(ticket)` — called directly from `TicketsService.create()` after ticket creation; finds the `SlaPolicy` matching `ticket.priority`; if found, adds `responseTimeMinutes` and `resolutionTimeMinutes` to `ticket.createdAt` to compute deadlines; updates the ticket with `responseDeadline`, `resolutionDeadline`, and `slaPolicyId`.
- `checkBreaches()` — `@Cron(CronExpression.EVERY_MINUTE)`; queries `tickets` where `slaBreached = false` AND (`responseDeadline < now` OR `resolutionDeadline < now`); for each breached ticket, sets `slaBreached = true`, writes an `AuditLog` entry with `action: 'SLA_BREACHED'`; if policy `breachAction` is `ESCALATE` or `BOTH`, updates `assignedToId` or `teamId` to the policy's escalation target.

**`SlaController`** — all routes require `ADMIN` role:

| Method | Path | Description |
|---|---|---|
| GET | `/sla-policies` | List all policies |
| POST | `/sla-policies` | Create a policy |
| PATCH | `/sla-policies/:id` | Update a policy |
| DELETE | `/sla-policies/:id` | Delete a policy |

**DTOs:**

`CreateSlaPolicyDto`:
```typescript
class CreateSlaPolicyDto {
  @IsString() @IsNotEmpty() name: string;
  @IsEnum(Priority) priorityLevel: Priority;
  @IsInt() @Min(1) responseTimeMinutes: number;
  @IsInt() @Min(1) resolutionTimeMinutes: number;
  @IsEnum(BreachAction) @IsOptional() breachAction?: BreachAction;
  @IsString() @IsOptional() escalateToUserId?: string;
  @IsString() @IsOptional() escalateToTeamId?: string;
}
```

`UpdateSlaPolicyDto` — all fields optional (PartialType of CreateSlaPolicyDto).

---

### `TicketsModule` Changes

- Import `EventEmitterModule` in `AppModule` (`EventEmitterModule.forRoot()`).
- Import `ScheduleModule` in `AppModule` (`ScheduleModule.forRoot()`).
- Inject `EventEmitter2` and `SlaService` into `TicketsService`.
- In `TicketsService.create()`, after the ticket is written to the database:
  1. Call `await this.slaService.stampDeadlines(ticket)` — updates deadlines on the ticket.
  2. Emit `this.eventEmitter.emit('ticket.created', ticket)` — triggers routing async.
- `RoutingModule` imports `TicketsModule`; `SlaModule` imports `TicketsModule`; `TicketsModule` does NOT import either (avoids circular dependency).

---

## Frontend

### Admin Nav

`frontend/src/app/(app)/layout.tsx` — add Admin link conditionally for `ADMIN` and `MANAGER` roles:

```typescript
const NAV: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/tickets', label: 'Tickets' },
];

// inside AppLayout, before render:
const adminRoles = ['ADMIN', 'MANAGER'];
const nav = adminRoles.includes(session.user.role)
  ? [...NAV, { href: '/admin', label: 'Admin' }]
  : NAV;
```

### `/admin/routing-rules`

**File:** `frontend/src/app/(app)/admin/routing-rules/page.tsx`

- Fetches `GET /routing-rules` on mount.
- Renders a table: Priority Order | Conditions | Assigned To | Active | Actions (Edit / Delete).
- Conditions summary rendered as human-readable text: `"category = Networking AND channel = EMAIL"`.
- Up/Down arrow buttons on each row fire `PATCH /routing-rules/reorder` with the updated order array.
- "New Rule" button toggles an inline form below the table:
  - Add/remove condition rows: `field` select → `operator` select → `value` input.
  - "Assign to" toggle: Agent (select from agents list) or Team.
  - Submit fires `POST /routing-rules`; on success, row prepended to table.
- Edit button populates the same form pre-filled; submit fires `PATCH /routing-rules/:id`.
- Delete button fires `DELETE /routing-rules/:id` with a confirmation prompt.

### `/admin/sla-policies`

**File:** `frontend/src/app/(app)/admin/sla-policies/page.tsx`

- Fetches `GET /sla-policies` on mount.
- Renders one row per priority (CRITICAL / HIGH / MEDIUM / LOW) — even unpopulated ones show an "Add" link.
- Each configured row: Priority | Response (min) | Resolution (min) | Breach Action | Escalate To | Edit.
- Edit opens an inline form with all fields; submit fires `PATCH /sla-policies/:id` or `POST /sla-policies` if new.
- Escalation target field: `User` or `Team` toggle with a dropdown, only shown when `breachAction` is `ESCALATE` or `BOTH`.

### `/admin` index

**File:** `frontend/src/app/(app)/admin/page.tsx`

- Simple landing page with two cards linking to `/admin/routing-rules` and `/admin/sla-policies`.

---

## Tests

### Backend — `RoutingService` unit tests

File: `backend/src/modules/routing/routing.service.spec.ts`

- `applyRules()` — first matching rule assigns ticket; second rule skipped after first match; no match leaves ticket unassigned; inactive rules are skipped; `contains` operator matches keyword in title; `contains` operator matches keyword in description; all conditions must match (AND logic).

### Backend — `SlaService` unit tests

File: `backend/src/modules/sla/sla.service.spec.ts`

- `stampDeadlines()` — writes correct `responseDeadline` and `resolutionDeadline` based on policy minutes; no-op when no policy matches ticket priority.
- `checkBreaches()` — sets `slaBreached = true` on overdue tickets; writes `SLA_BREACHED` audit log entry; `ESCALATE` action updates `assignedToId` to escalation target; `FLAG` action does not change assignment; skips already-breached tickets.

### Frontend — component tests

- `RoutingRulesPage` — table renders rules; delete fires `DELETE`; new rule form submits correct payload.
- `SlaPoliciesPage` — rows render for each priority; edit form auto-saves on submit.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| No routing rule matches | Ticket left unassigned — silent |
| Routing assigns to deleted/invalid agent | `TicketsService.update()` throws 404; listener catches, logs, swallows |
| No SLA policy for ticket's priority | Deadlines left null; breach cron skips null-deadline tickets |
| Duplicate priority in SLA policy | 409 from backend; frontend shows inline error |
| Cron job throws | `@nestjs/schedule` logs error; next tick retries |
| `MANAGER` accesses ADMIN-only SLA endpoint | 403 from `RolesGuard` |
| Escalation target user/team deleted | Breach job logs warning, skips escalation assignment |

---

## Out of Scope (Phase 3)

- Real-time notifications on SLA breach (Phase 5)
- SLA pause/resume (e.g., while ticket is PENDING)
- Bulk rule import/export
- Rule condition preview ("how many tickets would this rule match?")
- Team management UI (teams exist in DB but no admin page yet)
