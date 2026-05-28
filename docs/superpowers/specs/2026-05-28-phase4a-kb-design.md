# Phase 4a Design — Knowledge Base (Internal Authoring + Elasticsearch Search)

**Date:** 2026-05-28
**Status:** Approved
**Scope:** Internal KB article authoring (markdown, ADMIN/MANAGER), Elasticsearch full-text search, inline ticket suggestions, and deflection tracking (agent-side resolution + end-user self-serve).

---

## What Was Already Built

Phase 3 shipped with:

- `KbArticle` and `KbSource` Prisma models already defined
- Elasticsearch 8.13 running in Docker Compose on port 9200
- `RoutingModule` and `SlaModule` patterns to follow for the new module
- Global `JwtAuthGuard` + `RolesGuard` via `APP_GUARD`
- `PrismaModule` is `@Global()` — PrismaService injectable everywhere

---

## Architecture

A single **`KbModule`** owns everything: article CRUD, Elasticsearch indexing, full-text search, inline suggestions, and deflection logging. Uses `@nestjs/elasticsearch` injected via `ElasticsearchModule.registerAsync()` in `AppModule`.

**Write flow:** create/update → write to Postgres → if `PUBLISHED`, immediately index to Elasticsearch.  
**Delete flow:** remove from Postgres + Elasticsearch index.  
**Read flow:** single-article fetches from Postgres (with viewCount increment); search and suggestions from Elasticsearch.

No changes to existing modules except `TicketsModule` is imported by `KbModule` (for deflect-to-resolve), and the ticket detail frontend page gains a suggestion panel.

New packages required: `@nestjs/elasticsearch`, `@elastic/elasticsearch` (backend); `react-markdown` (frontend).

---

## Schema Changes

One migration adds two new enums, three new fields to `KbArticle`, and a new `KbDeflection` model:

```prisma
enum KbArticleStatus {
  DRAFT
  PUBLISHED
}

enum DeflectionType {
  AGENT
  END_USER
}

model KbArticle {
  // existing fields unchanged
  id          String          @id @default(cuid())
  title       String
  body        String
  source      KbSource        @default(INTERNAL)
  externalUrl String?
  tags        String[]
  viewCount   Int             @default(0)
  authorId    String?
  author      User?           @relation("KbArticleAuthor", fields: [authorId], references: [id])
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  // new fields
  status      KbArticleStatus @default(DRAFT)
  slug        String          @unique
  publishedAt DateTime?
  deflections KbDeflection[]
}

model KbDeflection {
  id        String         @id @default(cuid())
  articleId String
  article   KbArticle      @relation(fields: [articleId], references: [id])
  ticketId  String?
  ticket    Ticket?        @relation(fields: [ticketId], references: [id])
  type      DeflectionType
  createdAt DateTime       @default(now())

  @@index([articleId])
  @@index([ticketId])
}
```

`Ticket` model gets back-relation: `deflections KbDeflection[]`.

Slug is auto-generated server-side: lowercase title, spaces → hyphens, special chars stripped, short cuid suffix appended to guarantee uniqueness.

---

## Backend

### `KbModule`

**Files:**
- `backend/src/modules/kb/kb.module.ts`
- `backend/src/modules/kb/kb.service.ts`
- `backend/src/modules/kb/kb.controller.ts`
- `backend/src/modules/kb/dto/create-article.dto.ts`
- `backend/src/modules/kb/dto/update-article.dto.ts`
- `backend/src/modules/kb/kb.service.spec.ts`

### `KbController`

All routes require authentication (global `JwtAuthGuard`). Role restrictions per route:

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/kb` | All | List published articles; ADMIN/MANAGER also see drafts |
| POST | `/kb` | ADMIN, MANAGER | Create article |
| GET | `/kb/search?q=` | All | Elasticsearch full-text search |
| GET | `/kb/suggest?ticketId=` | AGENT, MANAGER, ADMIN | Top 5 suggestions from ticket title/description |
| GET | `/kb/:id` | All | View article, increments viewCount |
| PATCH | `/kb/:id` | ADMIN, MANAGER | Update article |
| DELETE | `/kb/:id` | ADMIN | Delete article |
| POST | `/kb/:id/deflect` | All | Log deflection |

Note: `search` and `suggest` routes must be declared before `/:id` in the controller.

### `KbService`

**`create(dto, user)`**
- Generates slug from title (lowercase, hyphens, strip non-alphanumeric, append `-${cuid().slice(0,6)}`)
- Writes to Postgres
- If `status === PUBLISHED`, sets `publishedAt = new Date()` and calls `indexArticle(article)`
- Returns created article

**`update(id, dto)`**
- Finds article, throws `NotFoundException` if missing
- Partial update via Prisma
- If newly published (`status` changing to `PUBLISHED` and `publishedAt` was null), sets `publishedAt`
- If `PUBLISHED` after update, calls `indexArticle()`; if changed to `DRAFT`, calls `removeFromIndex(id)`
- Returns updated article

**`remove(id)`**
- Deletes from Postgres
- Calls `removeFromIndex(id)` — logs warning if ES delete fails, does not throw

**`search(q)`**
- Queries Elasticsearch `kb_articles` index with multi-match across `title` (boost 3), `body`, `tags`
- Returns `{ id, title, slug, tags, excerpt }` array (excerpt from first 200 chars of body)
- If ES unavailable, throws `ServiceUnavailableException`

**`suggest(ticketId)`**
- Loads ticket from Prisma, throws `NotFoundException` if missing
- Builds query text from `ticket.title + ' ' + ticket.description`
- Calls ES `more_like_this` on `title` and `body` fields, filtered to `status: PUBLISHED`
- Returns top 5 matches as `{ id, title, slug }`

**`deflect(articleId, ticketId, type, user)`**
- Verifies article exists
- If `ticketId` provided, verifies ticket exists; if END_USER, verifies `ticket.createdById === user.id`
- Creates `KbDeflection` record
- If `type === AGENT`, calls `TicketsService.update(ticketId, { status: RESOLVED }, user)` — wraps in try/catch, logs if it fails
- Returns created deflection

**`indexArticle(article)` (private)**
- Calls `elasticsearchService.index({ index: 'kb_articles', id: article.id, document: { title, body, tags, slug, publishedAt } })`
- Logs warning on failure, does not throw

**`removeFromIndex(id)` (private)**
- Calls `elasticsearchService.delete({ index: 'kb_articles', id })`
- Logs warning if not found (idempotent)

**`onModuleInit()`**
- Calls `elasticsearchService.indices.exists({ index: 'kb_articles' })`
- If not exists, creates index with mappings: `title` (text), `body` (text), `tags` (keyword), `slug` (keyword), `publishedAt` (date)
- Note: boost is applied at query time in `search()` — not in the mapping (ES 8.x removed field-level boost from mappings)

### DTOs

**`CreateArticleDto`:**
```typescript
class CreateArticleDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsString() @IsNotEmpty() body: string;
  @IsArray() @IsString({ each: true }) @IsOptional() tags?: string[];
  @IsEnum(KbArticleStatus) @IsOptional() status?: KbArticleStatus;
}
```

**`UpdateArticleDto`** — `PartialType(CreateArticleDto)`.

**Deflect body** — inline in controller, validated with `@IsEnum(DeflectionType)` and `@IsString() @IsOptional() ticketId?`.

### `AppModule` changes

- Add `ElasticsearchModule.registerAsync({ useFactory: (config) => ({ node: config.get('ELASTICSEARCH_URL') }), inject: [ConfigService] })`
- Add `KbModule` to imports
- `KbModule` imports `TicketsModule` (for deflect-to-resolve)

---

## Frontend

### New pages

**`/kb` — Knowledge Base browse**
- File: `frontend/src/app/(app)/kb/page.tsx`
- Search input at top; 300ms debounce triggers `GET /kb/search?q=`; when empty, fetches `GET /kb`
- Article cards: title, tag chips, 160-char excerpt, view count
- Links to `/kb/[id]`

**`/kb/[id]` — Article view**
- File: `frontend/src/app/(app)/kb/[id]/page.tsx`
- Renders `body` via `react-markdown`
- Shows title, tags, author, published date, view count
- "This solved my issue" button for END_USER → `POST /kb/:id/deflect` with `{ type: 'END_USER' }`
- `ticketId` omitted for end-user portal deflection

**`/admin/kb` — KB management (ADMIN/MANAGER)**
- File: `frontend/src/app/(app)/admin/kb/page.tsx`
- Table: Title | Status | Tags | Author | Updated | Actions (Edit / Delete)
- Draft badge (grey) vs Published badge (green)
- Inline form (toggle via "New Article" button or "Edit"): title input, markdown textarea with live preview side-by-side, comma-separated tags input, Draft/Published toggle
- Submit → POST or PATCH; on success, reload list

### Nav changes

**`frontend/src/app/(app)/layout.tsx`:**
```typescript
const BASE_NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/tickets', label: 'Tickets' },
  { href: '/kb', label: 'Knowledge Base' },
];
```

**`frontend/src/app/(app)/admin/page.tsx`** — add third card linking to `/admin/kb`.

### Ticket detail inline suggestions

**`frontend/src/app/(app)/tickets/[id]/page.tsx`** — add "Suggested Articles" collapsible panel below comments:
- Fetches `GET /kb/suggest?ticketId=:id` on mount (AGENT/MANAGER/ADMIN only)
- Renders up to 5 article titles as links opening `/kb/[id]`
- AGENT/MANAGER/ADMIN see "Resolved by this article" button per suggestion
- On click → `POST /kb/:articleId/deflect` with `{ ticketId, type: 'AGENT' }` → on success, refresh ticket (status shows RESOLVED)
- END_USER does not see the suggestion panel

---

## Tests

### Backend — `KbService` unit tests

File: `backend/src/modules/kb/kb.service.spec.ts`

- `create()` — indexes to Elasticsearch when status is PUBLISHED
- `create()` — skips ES sync when status is DRAFT
- `update()` — re-indexes when article transitions from DRAFT to PUBLISHED; sets `publishedAt`
- `update()` — removes from ES index when article changes from PUBLISHED to DRAFT
- `update()` — throws NotFoundException for unknown id
- `remove()` — deletes from both Postgres and ES
- `search()` — calls ES multi-match query with title boost
- `suggest()` — fetches ticket, calls ES more_like_this, returns top 5
- `suggest()` — throws NotFoundException for unknown ticketId
- `deflect()` — AGENT type calls TicketsService.update() with RESOLVED status
- `deflect()` — END_USER type does not call TicketsService.update()
- `deflect()` — END_USER with mismatched ticket.createdById throws ForbiddenException

### Frontend — component tests

- `KbPage` — renders article cards from API; search input triggers search endpoint
- `AdminKbPage` — renders all articles including drafts; draft badge visible; edit form opens on click

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Elasticsearch down on write | Log warning, Postgres write succeeds; ES synced on next update |
| Elasticsearch down on search | 503 `{ message: 'Search unavailable' }` |
| Suggest with invalid ticketId | 404 |
| Deflect on already-RESOLVED or CLOSED ticket | Idempotent — writes KbDeflection, skips status update |
| Duplicate slug | Append `-2`, `-3` until unique (retry loop) |
| Non-ADMIN tries DELETE | 403 from RolesGuard |
| END_USER deflects ticket they don't own | 403 |
| Article not found on view/update/delete | 404 |

---

## Out of Scope (Phase 4a)

- SharePoint / Confluence connectors (Phase 4b)
- Article versioning / revision history
- Comments on KB articles
- KB article approval workflow (draft → review → published)
- Analytics dashboard for deflection rate
- Article recommendations based on user history
