# Phase 2 Design — Tickets Module Completion

**Date:** 2026-05-27  
**Status:** Approved  
**Scope:** Fills the gaps identified after the initial Phase 2 implementation: filtering + search on the ticket list, agent assignment UI, file attachments (MinIO), and unit tests for backend and frontend.

---

## What Was Already Built

Phase 2 shipped with:

- `POST /tickets`, `GET /tickets`, `GET /tickets/stats`, `GET /tickets/:id`, `PATCH /tickets/:id`, `POST /tickets/:id/comments`
- Role-filtered ticket visibility (END_USER sees own; AGENT/ADMIN see all)
- Internal comments (agent-only)
- Audit trail on every status change
- Frontend pages: `/dashboard`, `/tickets`, `/tickets/new`, `/tickets/:id`
- Sidebar nav layout with role-aware session

---

## Gaps Being Addressed

| Gap | Resolution |
|---|---|
| No filter / search on ticket list | Dropdown filters + debounced search bar + URL-param state |
| No assign-ticket UI | Quick-assign on list + dropdown on detail page |
| No file attachments | Full upload/download via MinIO; separate `AttachmentsModule` |
| No tests | Backend unit tests (TicketsService + AttachmentsService) + frontend component tests |

---

## Architecture

### Approach

**Separate `AttachmentsModule` on the backend; in-place extensions for filtering and assignment.**

Attachment handling talks to an external system (MinIO) and has its own error surface — it warrants its own NestJS module. Filtering and assignment are simpler extensions of existing files and don't need their own module.

---

## Backend

### 1. `AttachmentsModule` (new)

**Files:**
- `backend/src/modules/attachments/attachments.module.ts`
- `backend/src/modules/attachments/attachments.service.ts`
- `backend/src/modules/attachments/attachments.controller.ts`

**No Prisma schema changes** — the `Attachment` model already exists.

**`AttachmentsService`:**
- `upload(ticketId, userId, file)` — verifies the ticket exists and the user has access; streams the file to MinIO bucket `servicedesk-attachments` at key `tickets/<ticketId>/<uuid>-<originalname>`; writes an `Attachment` row; returns the record.
- `findByTicket(ticketId, userId, role)` — returns all `Attachment` rows for the ticket; applies same ownership check as `TicketsService`.
- `getPresignedUrl(key)` — returns a 1-hour presigned GET URL; the frontend never contacts MinIO directly.

**`AttachmentsController`:**
- `POST /tickets/:id/attachments` — multipart upload; Multer interceptor with 10 MB per-file limit; all roles allowed (ownership enforced in service).
- `GET /tickets/:id/attachments` — returns attachment list, each record including a presigned `downloadUrl`.

**`AppModule`** — imports `AttachmentsModule`.

---

### 2. `TicketsModule` extensions

#### Filtering + search (`GET /tickets`)

`FindTicketsQueryDto` adds optional query params:
- `status` — one of `NEW | ASSIGNED | IN_PROGRESS | PENDING | RESOLVED | CLOSED`
- `priority` — one of `CRITICAL | HIGH | MEDIUM | LOW`
- `search` — matched against `title` and `description` with Prisma `contains` (case-insensitive)
- `page` (default: 1) / `limit` (default: 25)

`TicketsService.findAll()` ANDs all provided filters on top of the existing role filter. Response shape changes to:

```json
{
  "data": [...],
  "total": 47,
  "page": 1,
  "limit": 25
}
```

#### Assignment (`PATCH /tickets/:id`)

`UpdateTicketDto` already includes `assignedToId`. Service enforces:
- Only `ADMIN`, `MANAGER`, `AGENT` may set `assignedToId`.
- If `assignedToId` is set and current status is `NEW`, status auto-advances to `ASSIGNED`.
- Audit log entry written: `action: ASSIGNED`, `newValue: <agent name>`.

#### Agent list (`GET /users/agents`)

New endpoint on a new `UsersController` (`backend/src/modules/users/`):
- Returns `{ id, name, email }` for all users with role `AGENT | MANAGER | ADMIN`.
- Requires Bearer token; `END_USER` role receives 403.
- Used by frontend assignee dropdowns.

---

## Frontend

### Ticket List (`/tickets`)

**Filter bar** (above the table):
- Status dropdown: All / NEW / ASSIGNED / IN_PROGRESS / PENDING / RESOLVED / CLOSED
- Priority dropdown: All / CRITICAL / HIGH / MEDIUM / LOW
- Search input: debounced 300 ms; clear button
- Any change re-fetches with updated query params; page resets to 1

**Pagination** (below the table):
- "Previous / Next" buttons; "Showing 1–25 of 47" label
- All filter/page state lives in URL search params (`?status=NEW&page=2`) — shareable, back-button friendly

**Quick-assign column:**
- Visible to `ADMIN / MANAGER / AGENT` only
- Each row shows current assignee or "—" as a compact `<select>` populated from `GET /users/agents`
- On change fires `PATCH /tickets/:id` with `{ assignedToId }` and updates the row in-place

---

### Ticket Detail (`/tickets/:id`)

**Assignment dropdown** (agent-only metadata section, alongside status dropdown):
- Populated from `GET /users/agents`; pre-selected to current `assignedTo`
- On change fires `PATCH /tickets/:id` with `{ assignedToId }`

**Attachments card** (below Comments card):
- List: fetched from `GET /tickets/:id/attachments` on load; filename, size, Download link (presigned URL)
- Upload: file input, max 10 MB enforced client-side before POST; progress text while uploading; new attachment appended to list on success
- All roles can upload and download; backend enforces ownership

---

### New Ticket Form (`/tickets/new`)

**Attachments field** (below Category):
- Multi-file input; selected files listed with filename and remove button before submit
- Submit flow (two-step):
  1. `POST /tickets` (JSON) → get `ticket.id`
  2. For each file: `POST /tickets/:id/attachments` (multipart)
- If attachment upload fails after ticket creation, user is redirected to the ticket detail page with a non-blocking warning; the ticket is never lost
- No files selected: form behaves exactly as before

---

## Tests

### Backend — `TicketsService` unit tests

File: `backend/src/modules/tickets/tickets.service.spec.ts`

Prisma mocked with `jest.mock`. Cases:
- `create()` — ticket created with correct fields; audit log entry written
- `findAll()` — END_USER sees only own tickets; AGENT sees all; status/priority/search filters applied; pagination returns correct slice and total
- `findOne()` — internal comments stripped for END_USER; included for AGENT
- `update()` — status change writes audit log; `assignedToId` blocked for END_USER; status auto-advances NEW→ASSIGNED when assignee set
- `addComment()` — `isInternal: true` forced to false for END_USER
- `getStats()` — returns `{ total, byStatus, byPriority }`

### Backend — `AttachmentsService` unit tests

File: `backend/src/modules/attachments/attachments.service.spec.ts`

MinIO client mocked. Cases:
- `upload()` — correct bucket/key; `Attachment` row created; unauthorized user gets 403
- `findByTicket()` — returns rows for correct ticket only
- `getPresignedUrl()` — delegates to MinIO `presignedGetObject` with correct expiry

### Frontend — component tests

Files: `frontend/src/app/(app)/tickets/*.test.tsx`

React Testing Library + Jest. Cases:
- `TicketListPage` — filter dropdowns render and trigger re-fetch; search input debounces; quick-assign column absent for END_USER session mock
- `TicketDetailPage` — assignee dropdown shown for AGENT session; attachment list renders; upload input present
- `NewTicketPage` — file input present; submit without files calls only `POST /tickets`; submit with files calls both endpoints in order

---

## Error Handling

| Scenario | Behavior |
|---|---|
| File > 10 MB (client) | Upload button disabled; inline message shown |
| File > 10 MB (server) | 413 from Multer; frontend shows "File too large" |
| MinIO unavailable | `AttachmentsService` throws 503; ticket creation unaffected |
| Attachment upload fails after ticket creation | Redirect to detail page; non-blocking warning banner |
| Unauthorized assignee change (END_USER) | Backend returns 403; frontend hides the control |

---

## Out of Scope (Phase 2)

- Bulk attachment download (zip)
- Attachment deletion
- Virus scanning on upload
- Real-time notifications on assignment change (Phase 5)
- Full-text search via Elasticsearch (Phase 4)
