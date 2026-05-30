# Amazon S3 KB Connector — Design Spec

**Goal:** Add a read-only Amazon S3 connector that syncs files from an S3 bucket into the knowledge base, following the same pattern as the existing SharePoint and Confluence connectors.

**Architecture:** `S3ConnectorService` lists objects under a configured bucket+prefix, fetches changed files by ETag comparison, converts content to Markdown, and upserts `KbArticle` records. Config is stored AES-256-GCM encrypted in `AppConfig`. The scheduler integrates into the existing `SyncSchedulerService`. Since the connector is read-only, S3 is always source of truth — no conflict detection, no write-back.

**Tech stack:** `@aws-sdk/client-s3` (v3), `pdf-parse` for PDF text extraction, existing `ContentConverterService` for HTML→Markdown.

---

## Data Model

### Prisma migration
Add `S3` to the `KbSource` enum:
```sql
ALTER TYPE "KbSource" ADD VALUE 'S3';
```
No new models required. `KbArticle` and `KbSyncLog` already support any `KbSource` value.

### Article identity
- `externalId` = `<bucket>/<key>` (e.g. `my-bucket/kb/getting-started.md`)
- `externalVersion` = S3 object ETag (content hash)
- `slug` = `s3-` + key lowercased with non-alphanumeric chars replaced by `-`
- `source` = `KbSource.S3`
- `authorId` = `null` (externally sourced)

### S3Config (stored at AppConfig key `connector.s3`)
```typescript
interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;   // AES-256-GCM encrypted at rest
  region: string;
  bucket: string;
  prefix: string;            // optional folder prefix, e.g. "kb/"
  enabled: boolean;
  syncIntervalMinutes: number;
}
```

---

## Backend Components

### New file: `s3.service.ts`

**`testConnection(): Promise<{ ok: boolean; message: string }>`**
- Creates an S3 client from stored config
- Calls `ListObjectsV2Command` with `MaxKeys: 1`
- Returns `{ ok: true, message: 'Connection successful' }` on success
- Catches all errors and returns `{ ok: false, message: <error message> }` — never throws

**`sync(): Promise<KbSyncLog>`**
1. Load config; throw if not configured
2. Create `KbSyncLog` with `connector: S3, status: 'running'`
3. Paginate `ListObjectsV2Command` with bucket + prefix
4. Filter objects to `.md`, `.html`, `.txt`, `.pdf` extensions only
5. For each object:
   - Skip if ETag matches stored `externalVersion` (unchanged)
   - `GetObjectCommand` to fetch content as Buffer
   - Convert to Markdown by extension:
     - `.md` / `.txt` → raw string
     - `.html` → `ContentConverterService.htmlToMarkdown()`
     - `.pdf` → `pdf-parse(buffer)` → `.text` field; log and skip on parse error
   - Derive title from filename (strip extension, replace `-`/`_` with spaces, title-case)
   - Upsert `KbArticle`: create new (status `PUBLISHED`) or update body/title/`externalVersion`/`lastSyncedAt`
   - Call `KbService.indexArticle()` on published articles
   - Increment `articlesNew` or `articlesUpdated` on the log
6. Finalize `KbSyncLog` with `status: 'success'` (or `'failed'` on uncaught error + `errorMessage`)

**PDF error isolation:** A `pdf-parse` failure on a single file logs a warning and continues — one bad PDF does not abort the sync.

**Zero results:** A prefix that returns no matching files is not an error — sync completes with 0 counts and `status: 'success'`.

### Modified: `connectors-config.service.ts`
- Add `S3Config` interface (exported)
- Add `getConfig('s3')` overload returning `S3Config | null`
- Add `getRedactedConfig('s3')` returning config with `secretAccessKey: '***'`
- Add `saveConfig('s3', config)` overload — encrypts `secretAccessKey`

### Modified: `connectors.controller.ts`
Four new endpoints, all under `@Roles(Role.ADMIN)`:
- `GET /connectors/s3/config`
- `PUT /connectors/s3/config`  — saves config, calls `scheduler.registerS3()`
- `POST /connectors/s3/test`
- `POST /connectors/s3/sync` — returns `KbSyncLog`

### Modified: `dto/connector-config.dto.ts`
```typescript
class SaveS3ConfigDto {
  @IsString() @IsNotEmpty() accessKeyId: string;
  @IsString() @IsNotEmpty() secretAccessKey: string;
  @IsString() @IsNotEmpty() region: string;
  @IsString() @IsNotEmpty() bucket: string;
  @IsString() @IsOptional() prefix?: string;
  @IsBoolean() enabled: boolean;
  @IsNumber() @Min(1) syncIntervalMinutes: number;
}
```

### Modified: `sync-scheduler.service.ts`
- Add `s3Timer: NodeJS.Timeout | null` and `s3Syncing: boolean`
- Add `registerS3()` — loads config, schedules interval if enabled
- Add `runS3()` — guard against concurrent runs, call `s3.sync()`
- Call `registerS3()` in `onModuleInit()`
- Clear `s3Timer` in `onModuleDestroy()`

### Modified: `connectors.module.ts`
- Import `S3ConnectorService` and add to `providers` array

---

## Frontend Components

### New file: `frontend/src/app/(app)/admin/connectors/s3/page.tsx`
Config page following the Confluence page structure:

**Credentials section:**
- Access Key ID (text input)
- Secret Access Key (password input — always blank on load, submit only if non-empty to avoid overwriting stored secret with empty string)
- Region (text input, e.g. `us-east-1`)
- Bucket (text input)
- Prefix (text input, optional, placeholder `kb/`)

**Schedule section:**
- Sync Interval dropdown: 15 min / 30 min / 1 hour / 6 hours
- Enable automatic sync checkbox

**Actions:** Save, Test Connection, Sync Now buttons with inline feedback

**Sync History table:** Same columns as Confluence page (Started, Duration, New, Updated, Conflicts, Status badge), filtered to `connector === 'S3'`

### Modified: `frontend/src/app/(app)/admin/connectors/page.tsx`
- Add `{ label: 'Amazon S3', connector: 's3', href: '/admin/connectors/s3' }` to `CARDS` array
- Add `s3` fetch for config and populate status (enabled, conflicts, lastSyncedAt)
- Update grid to `1fr 1fr 1fr` (3 columns) and `maxWidth: 960`

---

## Error Handling

| Scenario | Handling |
|---|---|
| Wrong credentials / no bucket access | `testConnection` returns `{ ok: false, message }` |
| Bucket not found | Same as above |
| Single PDF parse failure | Log warning, skip file, continue sync |
| Network error mid-sync | Caught, `KbSyncLog.status = 'failed'`, error written to `errorMessage` |
| Config not set when sync fires | `sync()` throws; scheduler catches and logs |
| Zero objects at prefix | Sync succeeds with 0 counts |

---

## Testing

File: `backend/src/modules/connectors/s3.service.spec.ts`

- Mock `@aws-sdk/client-s3` (`S3Client`, `ListObjectsV2Command`, `GetObjectCommand`)
- Mock `pdf-parse`
- Test cases:
  1. `testConnection` — returns `{ ok: true }` when `ListObjectsV2` succeeds
  2. `testConnection` — returns `{ ok: false, message }` on S3 client error
  3. `sync` — creates new `KbArticle` for a new `.md` file
  4. `sync` — skips object when ETag matches stored `externalVersion`
  5. `sync` — updates article when ETag changes
  6. `sync` — converts `.html` file via `ContentConverterService`
  7. `sync` — extracts text from `.pdf` file via `pdf-parse`
  8. `sync` — logs warning and continues when `pdf-parse` throws on one file

---

## Dependencies

```bash
# Backend
npm install @aws-sdk/client-s3 pdf-parse
npm install -D @types/pdf-parse
```

No new frontend dependencies.

---

## File Map

| Action | Path |
|---|---|
| Create | `backend/src/modules/connectors/s3.service.ts` |
| Create | `backend/src/modules/connectors/s3.service.spec.ts` |
| Create | `frontend/src/app/(app)/admin/connectors/s3/page.tsx` |
| Modify | `backend/prisma/schema.prisma` |
| Create | `backend/prisma/migrations/<timestamp>_add_s3_kb_source/migration.sql` |
| Modify | `backend/src/modules/connectors/connectors-config.service.ts` |
| Modify | `backend/src/modules/connectors/connectors.controller.ts` |
| Modify | `backend/src/modules/connectors/connectors.module.ts` |
| Modify | `backend/src/modules/connectors/sync-scheduler.service.ts` |
| Modify | `backend/src/modules/connectors/dto/connector-config.dto.ts` |
| Modify | `frontend/src/app/(app)/admin/connectors/page.tsx` |
