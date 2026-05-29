# Phase 5b Design — Outbound Notifications (In-App + Email)

**Date:** 2026-05-29
**Status:** Approved
**Scope:** Admin-controlled outbound notifications on ticket events — in-app inbox and configurable email delivery (SMTP or Microsoft Graph).

---

## What Was Already Built

- `AppConfig` key/value model — used by `ConnectorConfigService` for encrypted credential storage (AES-256-GCM via `CONNECTOR_ENCRYPTION_KEY`)
- `EventEmitter2` + `@nestjs/event-emitter` — already used by `SlaModule` and `RoutingModule` via `@OnEvent`
- `TicketCreatedEvent` — already emitted by `TicketsService` on ticket creation
- Global `JwtAuthGuard` + `RolesGuard` via `APP_GUARD`
- Admin landing page at `/admin` with 5-card grid

---

## Architecture

A new **`NotificationsModule`** subscribes to ticket lifecycle events via `@OnEvent`. It reads admin-controlled toggles from `AppConfig`, writes in-app `Notification` rows to the DB, and dispatches email via a pluggable `EmailService` (SMTP via Nodemailer or Microsoft Graph via REST). `TicketsService` is extended to emit four new events alongside the existing `TicketCreatedEvent`. No module is modified other than `TicketsService` (event emission) and `AppModule` (import).

---

## Data Model

### New Prisma Model

```prisma
model Notification {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  title     String
  body      String
  ticketId  String?
  read      Boolean  @default(false)
  createdAt DateTime @default(now())
}
```

Add `notifications Notification[]` relation to the `User` model.

### AppConfig Keys

**Event toggles** (value `"true"` or `"false"`):

| Key | Description |
|---|---|
| `notification.event.ticket_created` | Email confirmation to submitter on creation |
| `notification.event.ticket_assigned` | In-app + email to assigned agent |
| `notification.event.ticket_commented` | In-app + email to ticket participants (creator + assignee) |
| `notification.event.ticket_status_changed` | In-app + email to ticket creator on status change |
| `notification.event.sla_breach` | In-app + email to assignee and all MANAGER-role users |

**Email transport keys:**

| Key | Value |
|---|---|
| `notification.email.transport` | `"SMTP"` or `"GRAPH"` |
| `notification.email.smtp` | Encrypted JSON: `{ host: string, port: number, secure: boolean, user: string, pass: string, fromAddress: string }` |
| `notification.email.graph` | Encrypted JSON: `{ tenantId: string, clientId: string, clientSecret: string, fromAddress: string }` |

Email credentials are encrypted/decrypted with the same AES-256-GCM helper used by `ConnectorConfigService`, reusing `CONNECTOR_ENCRYPTION_KEY`.

### New Events Emitted by TicketsService

| Event name | Payload | Trigger |
|---|---|---|
| `ticket.assigned` | `{ ticketId, assignedToId, title }` | `assignedToId` changes on PATCH |
| `ticket.commented` | `{ ticketId, commentId, authorId, title, creatorId, assignedToId }` | comment created |
| `ticket.status_changed` | `{ ticketId, status, title, creatorId, assignedToId }` | `status` changes on PATCH to any status **except** RESOLVED (to avoid double-notification with `ticket.resolved`) |
| `ticket.resolved` | `{ ticketId, title, creatorId }` | `status` changes to `RESOLVED` |

`TicketCreatedEvent` (already exists) payload: `{ ticketId, title, creatorId }` — used for the `ticket_created` toggle.

---

## Backend

### Files

- Create: `backend/src/modules/notifications/notifications.module.ts`
- Create: `backend/src/modules/notifications/notification.service.ts`
- Create: `backend/src/modules/notifications/notification.controller.ts`
- Create: `backend/src/modules/notifications/notification-config.service.ts`
- Create: `backend/src/modules/notifications/notification-config.controller.ts`
- Create: `backend/src/modules/notifications/email.service.ts`
- Create: `backend/src/modules/notifications/dto/update-event-config.dto.ts`
- Create: `backend/src/modules/notifications/dto/update-email-config.dto.ts`
- Create: `backend/src/modules/notifications/notification.service.spec.ts`
- Modify: `backend/src/modules/tickets/tickets.service.ts` — emit four new events
- Modify: `backend/src/modules/sla/sla.service.ts` — emit `sla.breached` event when a breach is detected
- Modify: `backend/src/app.module.ts` — add `NotificationsModule`

### NotificationController

All routes require authentication (global `JwtAuthGuard`).

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/notifications` | All | Fetch caller's inbox — query params: `limit` (default 50, max 100), `unread` (boolean, filters to unread only) |
| PATCH | `/notifications/:id/read` | All | Mark one notification read |
| PATCH | `/notifications/read-all` | All | Mark all caller's notifications read |

### NotificationConfigController

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/notifications/config` | ADMIN | Get all event toggles as `{ [key]: boolean }` |
| PUT | `/notifications/config` | ADMIN | Update event toggles |
| GET | `/notifications/email-config` | ADMIN | Get transport + redacted credentials |
| PUT | `/notifications/email-config` | ADMIN | Save transport + credentials (encrypted) |
| POST | `/notifications/email-config/test` | ADMIN | Send a test email to the authenticated admin |

### NotificationService

```typescript
// Event handlers
@OnEvent('ticket.created')
handleTicketCreated(event: TicketCreatedEvent): Promise<void>

@OnEvent('ticket.assigned')
handleTicketAssigned(event: TicketAssignedEvent): Promise<void>

@OnEvent('ticket.commented')
handleTicketCommented(event: TicketCommentedEvent): Promise<void>

@OnEvent('ticket.status_changed')
handleStatusChanged(event: TicketStatusChangedEvent): Promise<void>

@OnEvent('ticket.resolved')
handleTicketResolved(event: TicketResolvedEvent): Promise<void>

@OnEvent('sla.breached')
handleSlaBreached(event: SlaBreachedEvent): Promise<void>
```

Each handler:
1. Checks the relevant `notification.event.*` toggle via `NotificationConfigService`
2. If enabled: creates `Notification` rows for target users, calls `EmailService.send()` for each recipient who has an email address

### NotificationConfigService

```typescript
getEventToggles(): Promise<Record<string, boolean>>
updateEventToggles(toggles: Record<string, boolean>): Promise<void>
isEventEnabled(key: string): Promise<boolean>
getEmailConfig(): Promise<{ transport: 'SMTP' | 'GRAPH'; config: Record<string, unknown> }>
getRedactedEmailConfig(): Promise<{ transport: 'SMTP' | 'GRAPH'; config: Record<string, string> }>
saveEmailConfig(transport: 'SMTP' | 'GRAPH', config: Record<string, unknown>): Promise<void>
```

### EmailService

```typescript
send(to: string, subject: string, body: string): Promise<void>
```

Reads `notification.email.transport` from config. Routes to:
- **SMTP**: Nodemailer `createTransport` with decrypted SMTP credentials; `transporter.sendMail()`
- **Graph**: `POST https://graph.microsoft.com/v1.0/users/{fromAddress}/sendMail` with a client-credentials OAuth token obtained via `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`

If no transport is configured, `send()` is a no-op (logs a warning, does not throw).

### DTOs

```typescript
class UpdateEventConfigDto {
  @IsObject()
  @ValidateNested()
  toggles: Record<string, boolean>;  // keys must match known notification.event.* keys
}

class SmtpConfigDto {
  @IsString() host: string;
  @IsInt() @Min(1) @Max(65535) port: number;
  @IsBoolean() secure: boolean;
  @IsString() user: string;
  @IsString() pass: string;
  @IsEmail() fromAddress: string;
}

class GraphConfigDto {
  @IsString() tenantId: string;
  @IsString() clientId: string;
  @IsString() clientSecret: string;
  @IsEmail() fromAddress: string;
}

class UpdateEmailConfigDto {
  @IsEnum(['SMTP', 'GRAPH', 'NONE']) transport: 'SMTP' | 'GRAPH' | 'NONE';

  // SMTP fields — required when transport = SMTP
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() secure?: boolean;
  @IsOptional() @IsString() user?: string;
  @IsOptional() @IsString() pass?: string;

  // Shared field
  @IsOptional() @IsEmail() fromAddress?: string;

  // Graph fields — required when transport = GRAPH
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
}
// Service validates field completeness based on transport value
```

---

## Frontend

### Files

- Modify: `frontend/src/app/(app)/layout.tsx` — add notification bell with unread count badge + dropdown
- Create: `frontend/src/app/(app)/notifications/page.tsx` — full notification inbox
- Create: `frontend/src/app/(app)/admin/notifications/page.tsx` — admin notification settings
- Modify: `frontend/src/app/(app)/admin/page.tsx` — add 6th card; grid → `repeat(6, 1fr)`, maxWidth 1600

### Sidebar Bell (`layout.tsx`)

On mount (when session is available), fetch `GET /notifications?limit=5&unread=true` to get unread count. Render a bell icon in the header bar. If `unreadCount > 0`, show a red badge with the count (max displayed: `9+`).

Clicking the bell opens an inline dropdown showing the 5 most recent notifications:
- Title (bold if unread)
- Body (truncated to 80 chars)
- Relative timestamp
- Clicking an item: marks it read (`PATCH /notifications/:id/read`), navigates to the linked ticket

Footer row: "Mark all read" (PATCH `/notifications/read-all`) + "View all →" link to `/notifications`.

### Notification Inbox (`/notifications`)

Full list of caller's notifications, sorted newest-first. Unread items have a left border accent (`#3b82f6`). Clicking an item marks it read and links to `/tickets/:ticketId`. "Mark all read" button at the top. Empty state: "No notifications yet."

### Admin Notifications Page (`/admin/notifications`)

Two sections:

**Event Toggles:**
- A checkbox per event key with a human-readable label
- "Save" button: PUT `/notifications/config`
- Inline success/error message

**Email Delivery:**
- Radio: SMTP / Graph (/ None — disables email)
- Conditional form fields:
  - SMTP: Host, Port (number), Secure (checkbox), Username, Password, From Address
  - Graph: Tenant ID, Client ID, Client Secret, From Address
- Password/secret fields show `***` when a value is saved (redacted from GET response)
- "Save Email Config" button: PUT `/notifications/email-config`
- "Send Test Email" button: POST `/notifications/email-config/test` — sends to the logged-in admin's email; shows inline success/error

### Admin Landing Page (`/admin`)

Add 6th card:
- Title: "Notifications"
- Description: "Configure outbound notification events and email delivery."
- Link: `/admin/notifications`
- Grid: `repeat(6, 1fr)`, maxWidth 1600

---

## Tests

### Backend Unit Tests (`notification.service.spec.ts`)

- `handleTicketAssigned` creates in-app notification and sends email when toggle is enabled
- `handleTicketAssigned` does nothing when toggle is disabled
- `handleTicketCommented` notifies both creator and assignee (deduplicates if same user)
- `handleSlaBreached` notifies assignee and all MANAGER-role users
- `EmailService.send()` calls Nodemailer when transport is SMTP
- `EmailService.send()` is a no-op when no transport is configured
- `NotificationConfigService` encrypts email credentials on save and decrypts on load

### Frontend Component Tests

- Notification inbox renders unread items with accent styling
- Clicking a notification marks it read (fires PATCH)
- Admin notifications page renders event toggles from GET response
- SMTP fields shown when transport is SMTP; Graph fields shown when transport is GRAPH

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Email send fails (SMTP error / Graph 4xx) | Logs error, does not throw — in-app notification still created |
| `GET /notifications` fails in sidebar | Bell renders with no badge; no crash |
| Admin saves invalid SMTP config | 400 from DTO validation |
| Test email sent with unconfigured transport | 400 with message "Email transport not configured" |
| Toggle update with unknown event key | Silently ignored (unknown keys not written to AppConfig) |

---

## Out of Scope (Phase 5b)

- Teams channel notifications (deferred to Phase 5c when Teams bot is built)
- Per-user notification preferences (admin controls all toggles globally)
- Real-time push (WebSocket/SSE) — inbox is polled on page load
- Notification retention / auto-delete policy
- Digest emails (batching multiple events into one email)
- Email templates (HTML) — plain text body only
