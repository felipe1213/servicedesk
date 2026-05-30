# Phase 5c Design — Inbound Email (IMAP + Microsoft Graph)

**Date:** 2026-05-30
**Status:** Approved
**Scope:** Email-to-ticket ingestion — inbound emails at a shared mailbox are converted to tickets or threaded as comments on existing tickets. Admin-configurable transport (IMAP or Microsoft Graph), access control, and credentials (encrypted).

---

## What Was Already Built

- `AppConfig` key/value model — AES-256-GCM encryption via `CONNECTOR_ENCRYPTION_KEY`
- `Channel` enum — already includes `EMAIL` value
- `AttachmentsModule` — existing file storage used for email attachments
- `TicketsService` + `TicketCreatedEvent` — ticket creation and event emission
- `UsersService` / `UsersModule` — user lookup and creation
- `EmailService` (Phase 5b) — outbound email via SMTP or Graph; reuses same OAuth pattern
- Global `JwtAuthGuard` + `RolesGuard` via `APP_GUARD`
- Admin landing page at `/admin` with 6-card grid

---

## Architecture

A new **`InboundEmailModule`** runs a `@Cron`-driven polling loop (every minute via `@nestjs/schedule`). On each tick it reads the configured transport (`IMAP` or `GRAPH`) from `AppConfig`, fetches unseen/unread messages, normalizes them into a common `InboundMessage` shape, and calls `processMessage()` for each. `processMessage` enforces access control, determines whether the email is a new ticket or a reply, creates the appropriate DB record, saves attachments, and fires `TicketCreatedEvent` on new tickets so routing and notifications work automatically.

A `ticketNumber` auto-increment field is added to the `Ticket` model. Phase 5b outbound notification subjects are updated to include `[#ticketNumber]` so replies can be threaded back to the correct ticket.

---

## Data Model

### Prisma Change

Add to `Ticket` model:

```prisma
ticketNumber Int @default(autoincrement()) @unique
```

This enables clean human-readable ticket references in email subjects (e.g. `[#123]`).

### AppConfig Keys

**Transport & credentials:**

| Key | Value |
|---|---|
| `email.inbound.transport` | `"IMAP"` \| `"GRAPH"` \| `"NONE"` |
| `email.inbound.imap` | Encrypted JSON: `{ host, port, secure, user, pass, mailbox }` |
| `email.inbound.graph` | Encrypted JSON: `{ tenantId, clientId, clientSecret, mailboxAddress }` |

**Access control:**

| Key | Value |
|---|---|
| `email.inbound.access.mode` | `"ANYONE"` \| `"DOMAINS"` \| `"USERS"` |
| `email.inbound.access.list` | JSON array of domain strings or email addresses |

All credentials encrypted with AES-256-GCM using `CONNECTOR_ENCRYPTION_KEY` — same helper as `NotificationConfigService`.

---

## Backend

### Files

- Create: `backend/src/modules/inbound-email/inbound-email.module.ts`
- Create: `backend/src/modules/inbound-email/inbound-email.service.ts`
- Create: `backend/src/modules/inbound-email/inbound-email-config.service.ts`
- Create: `backend/src/modules/inbound-email/inbound-email-config.controller.ts`
- Create: `backend/src/modules/inbound-email/dto/update-inbound-config.dto.ts`
- Create: `backend/src/modules/inbound-email/inbound-email.service.spec.ts`
- Modify: `backend/prisma/schema.prisma` — add `ticketNumber` field, new migration
- Modify: `backend/src/app.module.ts` — add `InboundEmailModule` + `ScheduleModule.forRoot()`
- Modify: `backend/src/modules/notifications/notification.service.ts` — include `[#ticketNumber]` in outbound email subjects

### InboundEmailService

```typescript
interface InboundMessage {
  externalId: string;       // IMAP UID or Graph message id (for dedup/mark-read)
  from: string;             // sender email address
  fromName: string;
  subject: string;
  body: string;             // plain text
  attachments: Array<{ filename: string; contentType: string; data: Buffer }>;
}
```

**Polling (`@Cron('* * * * *')`):**

- Reads transport from `InboundEmailConfigService`
- `IMAP` → `pollImap()`: connects with `imapflow`, searches `UNSEEN`, fetches each message, marks `SEEN` after `processMessage()`
- `GRAPH` → `pollGraph()`: obtains OAuth token via client-credentials, `GET /users/{mailboxAddress}/messages?$filter=isRead eq false&$top=50`, marks each message read after `processMessage()`
- `NONE` → no-op
- Entire cron handler wrapped in try/catch; errors are logged, never thrown

**`processMessage(msg: InboundMessage)`:**

1. **Access control check** — read `email.inbound.access.mode` and `email.inbound.access.list`:
   - `DOMAINS`: extract sender domain; discard if not in list
   - `USERS`: discard if `msg.from` not in list
   - `ANYONE`: pass through
2. **Reply detection** — regex `subject` for `\[#(\d+)\]`; if matched, look up ticket by `ticketNumber`
   - If ticket found: create `Comment` (body = `msg.body`, internal = false, authorId = resolved user id); save attachments to ticket; done
   - If ticket not found: treat as new ticket
3. **New ticket path**:
   - Look up `User` by `msg.from` email
   - If not found and mode is `ANYONE` or `DOMAINS`: create `User` (`role: END_USER`, `email: msg.from`, `name: msg.fromName`, `authProvider: LOCAL`, no password)
   - If not found and mode is `USERS`: discard (sender passed the list check but has no account — shouldn't happen, but guard anyway)
   - Create `Ticket`: `title = msg.subject`, `description = msg.body`, `sourceChannel = EMAIL`, `priority = MEDIUM`, `status = NEW`, `createdById = user.id`
   - Fire `TicketCreatedEvent` (routing + notifications pick up automatically)
   - Save attachments to new ticket

### InboundEmailConfigService

Same AES-256-GCM pattern as `NotificationConfigService`:

```typescript
getConfig(): Promise<{ transport: 'IMAP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> }>
getRedactedConfig(): Promise<{ transport: 'IMAP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> }>
saveConfig(dto: UpdateInboundTransportDto): Promise<void>
getAccessControl(): Promise<{ mode: 'ANYONE' | 'DOMAINS' | 'USERS'; list: string[] }>
saveAccessControl(mode: string, list: string[]): Promise<void>
```

`saveConfig` validates all required fields for the chosen transport before any DB write (mirrors `NotificationConfigService.saveEmailConfig` validate-before-write pattern).

### InboundEmailConfigController

All routes `@Roles(Role.ADMIN)`:

| Method | Path | Description |
|---|---|---|
| GET | `/inbound-email/config` | Transport + redacted credentials |
| PUT | `/inbound-email/config` | Save transport + credentials (encrypted) |
| GET | `/inbound-email/access` | Access mode + list |
| PUT | `/inbound-email/access` | Save access mode + list |
| POST | `/inbound-email/test` | Trigger one immediate poll; returns `{ processed: number }` |

`POST /inbound-email/test` throws `BadRequestException('Inbound email transport not configured')` when transport is `NONE`.

### DTOs

```typescript
class UpdateInboundTransportDto {
  @IsEnum(['IMAP', 'GRAPH', 'NONE']) transport: 'IMAP' | 'GRAPH' | 'NONE';

  // IMAP fields — required when transport = IMAP
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() secure?: boolean;
  @IsOptional() @IsString() user?: string;
  @IsOptional() @IsString() pass?: string;
  @IsOptional() @IsString() mailbox?: string;  // defaults to 'INBOX' in service

  // Graph fields — required when transport = GRAPH
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
  @IsOptional() @IsEmail() mailboxAddress?: string;
}

class UpdateInboundAccessDto {
  @IsEnum(['ANYONE', 'DOMAINS', 'USERS']) mode: 'ANYONE' | 'DOMAINS' | 'USERS';
  @IsOptional() @IsArray() @IsString({ each: true }) list?: string[];
}
```

### Module

```typescript
@Module({
  imports: [PrismaModule, TicketsModule, UsersModule, AttachmentsModule],
  controllers: [InboundEmailConfigController],
  providers: [InboundEmailService, InboundEmailConfigService],
})
export class InboundEmailModule {}
```

### New npm dependency

`imapflow` — modern Node.js IMAP client. No new dependencies for Graph (reuses existing `fetch` + client-credentials OAuth pattern from `EmailService`).

### AppModule changes

```typescript
ScheduleModule.forRoot(),   // add to imports (not already present)
InboundEmailModule,         // add after NotificationsModule
```

### NotificationService change

Update all outbound email subject lines to include `[#ticketNumber]`. Requires fetching `ticketNumber` from the ticket in each handler (already fetches ticket data for title). Example: `subject: \`[#${ticket.ticketNumber}] Ticket Assigned: ${event.title}\``.

---

## Frontend

### Files

- Modify: `frontend/src/app/(app)/admin/page.tsx` — add 7th card; grid → `repeat(7, 1fr)`, maxWidth 1800
- Create: `frontend/src/app/(app)/admin/inbound-email/page.tsx`

### Admin Landing Page

7th card:
- Title: "Inbound Email"
- Description: "Configure email-to-ticket ingestion via IMAP or Microsoft Graph."
- Link: `/admin/inbound-email`

### Admin Inbound Email Page (`/admin/inbound-email`)

Two sections:

**Transport & Credentials:**
- Radio: IMAP / Graph / None
- IMAP fields (shown when IMAP selected): Host, Port (number), Secure (checkbox), Username, Password, Mailbox (text, placeholder `INBOX`)
- Graph fields (shown when Graph selected): Tenant ID, Client ID, Client Secret, Mailbox Address (email)
- Password/secret fields display `***` placeholder when a saved value exists (loaded from redacted GET response)
- "Save" button → `PUT /inbound-email/config`; inline success/error feedback
- "Test Poll" button → `POST /inbound-email/test`; shows `"Processed N email(s)"` on success; disabled when transport is `NONE`

**Access Control:**
- Radio: Anyone / Approved Domains / Specific Users
- Approved Domains: tag-style text input — user types a domain and presses Enter to add; × to remove
- Specific Users: tag-style text input — same UX but for email addresses
- "Save" button → `PUT /inbound-email/access`; inline success/error feedback

---

## Tests

### Backend Unit Tests (`inbound-email.service.spec.ts`)

- `processMessage` creates a ticket when sender domain is in the DOMAINS allowlist
- `processMessage` discards email when sender domain is not in DOMAINS list
- `processMessage` discards email when mode is USERS and sender not in list
- `processMessage` threads reply as comment when subject contains `[#123]` and ticket exists
- `processMessage` treats email as new ticket when `[#123]` subject tag matches no ticket
- `processMessage` auto-creates END_USER account when sender unknown and mode is ANYONE
- `processMessage` saves attachments to the created ticket
- `pollImap` marks messages as SEEN after processing
- `InboundEmailConfigService` encrypts IMAP credentials on save, decrypts on load

### Frontend Component Tests

- IMAP fields shown when transport is IMAP; Graph fields hidden
- Graph fields shown when transport is GRAPH; IMAP fields hidden
- Domain tag input rendered when access mode is DOMAINS; hidden when ANYONE
- Test Poll button disabled when transport is NONE

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| IMAP connection fails (bad credentials, unreachable host) | Log error, skip poll — retry next minute |
| Graph token request fails | Log error with status code, skip poll |
| Email body is empty | Use `"(no body)"` as ticket description or comment body |
| `[#123]` in subject but ticket not found | Treat as new ticket (tag remains in title) |
| Attachment download fails | Log warning, skip attachment — ticket/comment still created |
| Auto-created user email conflict (race condition) | Catch unique constraint error, re-fetch user by email |
| Access list empty when mode is DOMAINS or USERS | Discard all emails (empty list = no one allowed) |
| `POST /inbound-email/test` when transport is NONE | 400 `"Inbound email transport not configured"` |

---

## Out of Scope (Phase 5c)

- Microsoft Teams Bot notifications (deferred — requires Azure Bot Framework)
- Inbound email via Gmail API (IMAP covers Gmail via app password or OAuth XOAUTH2)
- HTML email rendering (plain text body only; HTML stripped or used as-is)
- Bounce/NDR handling (undeliverable reply emails)
- Per-ticket email address routing (single shared mailbox only)
- Digest / batched polling (always processes all unseen messages per poll)
