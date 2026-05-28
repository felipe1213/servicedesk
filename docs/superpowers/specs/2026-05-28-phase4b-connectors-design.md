# Phase 4b Design — External KB Connectors (SharePoint + Confluence Bidirectional Sync)

**Date:** 2026-05-28
**Status:** Approved
**Scope:** SharePoint and Confluence bidirectional sync, OAuth/API-token credential storage, scheduled + manual sync, conflict detection and resolution UI.

---

## What Was Already Built

Phase 4a shipped with:

- `KbArticle` model with `source KbSource` (INTERNAL | SHAREPOINT | CONFLUENCE), `externalUrl String?` already defined
- `KbSource` enum already has `SHAREPOINT` and `CONFLUENCE` variants
- `KbModule` owns article CRUD and Elasticsearch indexing — connectors will call into it
- `AppConfig` model (key/value store) available for credential storage
- `@nestjs/schedule` pattern established in the project
- Global `JwtAuthGuard` + `RolesGuard` via `APP_GUARD`

---

## Architecture

A single **`ConnectorsModule`** owns all external sync: OAuth token management, fetch/push logic for both platforms, scheduled cron jobs, conflict detection, and the admin API. It imports `KbModule` (for article CRUD + ES indexing) and reads/writes `AppConfig` via `ConnectorConfigService`.

**Write flow (inbound):** scheduled or manual trigger → fetch external pages → upsert `KbArticle` records → index to Elasticsearch.
**Write flow (outbound):** admin clicks Export or manual sync → convert markdown → push to SharePoint/Confluence → store `externalId`, `externalVersion`.
**Conflict flow:** inbound detects both sides edited → freeze local, set `syncConflict=true`, store remote in `conflictData` → admin resolves in UI.

New packages required: `turndown` + `@types/turndown` (HTML→Markdown), `marked` (Markdown→HTML). No external SDK for SharePoint or Confluence — both use plain HTTPS REST calls.

---

## Schema Changes

One migration adds five fields to `KbArticle` and a new `KbSyncLog` model.

```prisma
model KbArticle {
  // existing fields unchanged
  // new fields:
  externalId      String?   // page/doc ID in SharePoint or Confluence
  externalVersion String?   // ETag (SharePoint) or version int as string (Confluence)
  lastSyncedAt    DateTime? // timestamp of last successful sync for this article
  syncConflict    Boolean   @default(false)
  conflictData    Json?     // { remoteTitle, remoteBody, remoteVersion, detectedAt }
}

model KbSyncLog {
  id              String    @id @default(cuid())
  connector       KbSource  // SHAREPOINT or CONFLUENCE
  startedAt       DateTime
  completedAt     DateTime?
  status          String    // 'running' | 'success' | 'partial' | 'failed'
  articlesNew     Int       @default(0)
  articlesUpdated Int       @default(0)
  conflicts       Int       @default(0)
  errorMessage    String?

  @@index([connector])
}
```

Migration safety: all new `KbArticle` fields are nullable or have defaults — no backfill needed.

---

## Backend

### `ConnectorsModule`

**Files:**
- `backend/src/modules/connectors/connectors.module.ts`
- `backend/src/modules/connectors/connectors.controller.ts`
- `backend/src/modules/connectors/connectors-config.service.ts`
- `backend/src/modules/connectors/sharepoint.service.ts`
- `backend/src/modules/connectors/confluence.service.ts`
- `backend/src/modules/connectors/sync-scheduler.service.ts`
- `backend/src/modules/connectors/content-converter.service.ts`
- `backend/src/modules/connectors/dto/connector-config.dto.ts`
- `backend/src/modules/connectors/dto/resolve-conflict.dto.ts`
- `backend/src/modules/connectors/connectors.service.spec.ts`

### `ConnectorsController`

All routes `@Roles(Role.ADMIN)` only.

| Method | Path | Description |
|---|---|---|
| GET | `/connectors/sharepoint/config` | Get SharePoint config (secrets redacted to `"***"`) |
| PUT | `/connectors/sharepoint/config` | Save SharePoint config |
| POST | `/connectors/sharepoint/test` | Test connection — returns `{ ok: boolean, message: string }` |
| POST | `/connectors/sharepoint/sync` | Trigger manual sync — returns `KbSyncLog` |
| GET | `/connectors/confluence/config` | Get Confluence config (token redacted) |
| PUT | `/connectors/confluence/config` | Save Confluence config |
| POST | `/connectors/confluence/test` | Test connection |
| POST | `/connectors/confluence/sync` | Trigger manual sync |
| GET | `/connectors/conflicts` | List `KbArticle` records where `syncConflict=true` |
| POST | `/connectors/conflicts/:articleId/resolve` | Resolve conflict |
| GET | `/connectors/logs` | Last 20 `KbSyncLog` records across both connectors |

### `ConnectorConfigService`

Reads and writes `AppConfig` records with keys `connector.sharepoint` and `connector.confluence`. Values are JSON strings.

**SharePoint config shape:**
```typescript
interface SharePointConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;   // AES-256 encrypted at rest
  siteUrl: string;
  syncType: 'library' | 'pages';
  libraryName?: string;   // required when syncType = 'library'
  rootPageId?: string;    // optional — scope to page subtree
  enabled: boolean;
  syncIntervalMinutes: number; // 15 | 30 | 60 | 360
}
```

**Confluence config shape:**
```typescript
interface ConfluenceConfig {
  baseUrl: string;        // e.g. https://myorg.atlassian.net
  email: string;
  apiToken: string;       // AES-256 encrypted at rest
  syncType: 'space' | 'pagetree';
  spaceKey?: string;      // required when syncType = 'space'
  rootPageId?: string;    // required when syncType = 'pagetree'
  enabled: boolean;
  syncIntervalMinutes: number;
}
```

**Encryption:** AES-256-GCM using `CONNECTOR_ENCRYPTION_KEY` env var (32-byte hex string). `encrypt(plaintext): string` returns `iv:authTag:ciphertext` hex-encoded. `decrypt(stored): string` reverses it. Only `clientSecret` and `apiToken` fields are encrypted — all other config fields stored plaintext.

`getConfig(connector)` returns the config with secrets decrypted. `getRedactedConfig(connector)` returns config with `clientSecret`/`apiToken` replaced by `"***"` — used by GET endpoints.

### `SharePointService`

**OAuth:** Client credentials flow. On first call (or when cached token expires), POSTs to `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token` with `grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default`. Caches access token + expiry in memory.

**`sync(): Promise<KbSyncLog>`**
1. Creates `KbSyncLog` record with `status='running'`
2. Fetches pages based on `syncType`:
   - `pages`: `GET /sites/{siteId}/pages` via Graph API, filters to published pages
   - `library`: `GET /sites/{siteId}/drives/{driveId}/root:/{libraryName}:/children` filtered to `.md` files; fetches content via `@microsoft.graph.downloadUrl`
3. For each item calls `upsertArticle(item, log)` — see sync flow below
4. Finds local SHAREPOINT articles updated since `lastSyncedAt` and not in conflict → calls `pushArticle(article)`
5. Marks log `completedAt`, `status='success'` (or `'partial'` if `log.conflicts > 0`)
6. Returns log

**`upsertArticle(externalItem, log)`**
- Looks up `KbArticle` by `externalId`
- **New:** `prisma.kbArticle.create(...)`, set `source=SHAREPOINT`, `status=PUBLISHED`, `externalId`, `externalVersion` (ETag from response headers), `externalUrl`, `lastSyncedAt=now()`; convert HTML body to markdown via `ContentConverterService.htmlToMarkdown()`; call `KbService.indexArticle()`; increment `log.articlesNew`
- **Unchanged** (`externalVersion` matches): skip
- **Remote changed, no local edits** (`externalVersion` differs, `article.updatedAt <= article.lastSyncedAt`): update body, externalVersion, lastSyncedAt; re-index; increment `log.articlesUpdated`
- **Conflict** (`externalVersion` differs, `article.updatedAt > article.lastSyncedAt`): set `syncConflict=true`, `conflictData={remoteTitle, remoteBody (markdown), remoteVersion, detectedAt}`; increment `log.conflicts`; do NOT modify local content

**`pushArticle(article)`** — converts `article.body` markdown to HTML via `ContentConverterService.markdownToHtml()`, PATCHes the Graph API page/file, updates `externalVersion`, `lastSyncedAt`.

**`testConnection(): { ok: boolean; message: string }`** — fetches OAuth token and calls `GET /sites/{siteId}`. Returns ok+message.

**`exportArticle(articleId, config)`** — called by `POST /kb/:id/export`. Creates a new SharePoint page or `.md` file, stores `externalId`, `externalUrl`, `externalVersion`, `lastSyncedAt`.

### `ConfluenceService`

**Auth:** HTTP Basic auth with `Buffer.from(`${email}:${apiToken}`).toString('base64')` as `Authorization: Basic ...` header.

**`sync(): Promise<KbSyncLog>`** — same structure as SharePointService.sync().

Fetches pages:
- `space`: `GET /wiki/rest/api/content?spaceKey={key}&type=page&status=current&expand=body.storage,version`
- `pagetree`: `GET /wiki/rest/api/content/{rootPageId}/descendant/page?expand=body.storage,version` then recurse

**`upsertArticle`** — same four-case logic as SharePoint. `externalVersion` = Confluence page `version.number` as string. Confluence body is in "storage format" (XML-like HTML) — `ContentConverterService.htmlToMarkdown()` handles it after stripping Confluence-specific tags.

**`pushArticle(article)`** — `PUT /wiki/rest/api/content/{externalId}` with `{ version: { number: currentVersion + 1 }, body: { storage: { value: html, representation: 'storage' } } }`.

**`testConnection()`** — `GET /wiki/rest/api/space` with provided credentials.

### `SyncSchedulerService`

Uses `@nestjs/schedule`. On module init, reads `syncIntervalMinutes` from both connector configs and schedules two independent `setInterval` loops (not `@Cron` decorators, since interval is dynamic). On config update, the intervals are cleared and re-registered.

Prevents concurrent runs: tracks `isSyncing` boolean per connector. If a manual sync is triggered while scheduled sync is running, returns the in-progress log immediately.

Implements `OnModuleDestroy` — clears both `setInterval` handles on shutdown to prevent dangling timers.

### `ContentConverterService`

```typescript
htmlToMarkdown(html: string): string  // uses turndown
markdownToHtml(markdown: string): string  // uses marked
```

`turndown` is configured with `headingStyle: 'atx'` and `codeBlockStyle: 'fenced'`. Confluence storage format tags (`<ac:structured-macro>`, `<ri:*>`) are stripped before passing to turndown.

### `ResolveConflictDto`

```typescript
class ResolveConflictDto {
  @IsEnum(['LOCAL', 'REMOTE', 'MERGED']) resolution: 'LOCAL' | 'REMOTE' | 'MERGED';
  @IsString() @IsOptional() mergedBody?: string; // required when resolution = 'MERGED'
}
```

**Conflict resolution logic** (`POST /connectors/conflicts/:articleId/resolve`):
- `LOCAL`: push local body to external (calls `pushArticle`), clear `syncConflict`, update `externalVersion`
- `REMOTE`: overwrite `body` with `conflictData.remoteBody`, clear `syncConflict`, update `externalVersion`, `lastSyncedAt`; re-index to ES
- `MERGED`: save `mergedBody` as new `body`, push outbound, clear conflict; re-index to ES

Articles with `syncConflict=true` are skipped by the scheduler until resolved.

**`KbController` addition** — one new route added to the existing KB controller:

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/kb/:id/export` | ADMIN, MANAGER | Export an INTERNAL article to a connector — body: `{ connector: 'SHAREPOINT' \| 'CONFLUENCE' }` |

### `AppModule` changes

- Add `ConnectorsModule` to imports after `KbModule`
- Add `CONNECTOR_ENCRYPTION_KEY` to required env vars (validated in `ConfigModule`)
- `ConnectorsModule` imports `KbModule` (already exported — no circular dep)

### New env var

```
CONNECTOR_ENCRYPTION_KEY=   # 32-byte hex string, e.g. openssl rand -hex 32
```

Add to `.env.example`.

---

## Frontend

### New pages

**`/admin/connectors`** — connector landing
- File: `frontend/src/app/(app)/admin/connectors/page.tsx`
- Two cards: SharePoint, Confluence
- Each card: enabled badge, last sync timestamp, conflict count (red badge if > 0), link to config page

**`/admin/connectors/sharepoint`** — SharePoint config
- File: `frontend/src/app/(app)/admin/connectors/sharepoint/page.tsx`
- Credentials section: Tenant ID, Client ID, Client Secret (password input)
- Site URL input
- Sync scope radio: Document Library | Site Pages
- Conditional: Library Name (if library) or Root Page ID (optional, if pages)
- Sync interval select: 15min / 30min / 1hr / 6hr
- Enable/disable toggle
- "Test Connection" button → inline success/error message
- "Sync Now" button → shows spinner, then result summary (X new, Y updated, Z conflicts)
- Sync history table: last 10 logs (started, duration, new, updated, conflicts, status badge)

**`/admin/connectors/confluence`** — Confluence config
- File: `frontend/src/app/(app)/admin/connectors/confluence/page.tsx`
- Same structure as SharePoint page but with: Base URL, Email, API Token fields
- Sync scope radio: Full Space | Page Tree
- Conditional: Space Key (if space) or Root Page ID (if pagetree)

**`/admin/connectors/conflicts`** — conflict resolution
- File: `frontend/src/app/(app)/admin/connectors/conflicts/page.tsx`
- Table: Article Title | Connector | Detected At | Actions
- Clicking a row opens a panel below with side-by-side diff:
  - Left: current local `body` (rendered as markdown preview)
  - Right: `conflictData.remoteBody` (rendered as markdown preview)
- Three buttons: Keep Local | Accept Remote | Edit Merged
- Edit Merged opens a textarea pre-filled with local body; Save Merged button
- On resolution, row disappears from table

### Changes to existing pages

**`/admin/page.tsx`** — add fourth card linking to `/admin/connectors` (grid becomes `1fr 1fr 1fr 1fr` or wraps to two rows)

**`/admin/kb/page.tsx`** — two additions:
- Source badge in Status column: INTERNAL (grey) | SHAREPOINT (blue) | CONFLUENCE (teal)
- "Export" button in Actions column for INTERNAL articles only → opens modal: "Export to SharePoint" / "Export to Confluence" radio + Confirm button → `POST /kb/:id/export { connector }`

---

## Tests

### Backend unit tests (`connectors.service.spec.ts`)

- `SharePointService.upsertArticle()` — creates new article when externalId not found
- `SharePointService.upsertArticle()` — skips when externalVersion matches
- `SharePointService.upsertArticle()` — updates article when remote changed and no local edits
- `SharePointService.upsertArticle()` — sets syncConflict when both sides edited
- `ConfluenceService.upsertArticle()` — same four cases
- `ContentConverterService.htmlToMarkdown()` — converts basic HTML
- `ContentConverterService.markdownToHtml()` — converts basic markdown
- Conflict resolution — LOCAL keeps local, pushes outbound
- Conflict resolution — REMOTE overwrites local body
- Conflict resolution — MERGED saves mergedBody, pushes outbound
- `ConnectorConfigService` — encrypts secret on save, decrypts on load, redacts on GET

### Frontend component tests

- `ConnectorsPage` — renders both connector cards with status
- `ConflictsPage` — renders conflict table; resolution buttons visible

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| OAuth token fetch fails (SharePoint) | Log error, mark sync log `failed`, do not update any articles |
| External API 401 (Confluence) | Same — log, fail sync log |
| External API 429 (rate limited) | Retry after `Retry-After` header value; max 3 retries |
| ES indexing fails during sync | Log warning, continue — article saved to Postgres, ES will catch up on next update |
| Sync already running | Return in-progress log, skip duplicate run |
| `CONNECTOR_ENCRYPTION_KEY` missing | Config module validation throws on startup |
| Article in conflict skipped by scheduler | Logged as skipped in sync log, not counted as error |
| Export to external fails | Return 502 with error message; no local state change |

---

## Out of Scope (Phase 4b)

- Attachment/file sync (only page content synced, not embedded images or files)
- Confluence Data Center / Server (Cloud only)
- SharePoint on-premises
- Webhook-driven real-time sync
- Per-article sync frequency overrides
- Analytics dashboard for sync health
- Multi-site SharePoint connectors (one site per connector instance)

---

## Environment Variables (additions)

| Variable | Description | Default |
|---|---|---|
| `CONNECTOR_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption of stored secrets | — (required if connectors used) |
