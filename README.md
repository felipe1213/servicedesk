# ServiceDesk

An enterprise-scale help desk ticketing system built with NestJS and Next.js, inspired by ServiceNow. Supports ticket creation through a web portal, Microsoft Teams bot, and email; a knowledge base with internal authoring and external integrations; SLA tracking; a configurable manager dashboard; and outbound notifications via in-app inbox and email.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Authentication](#authentication)
- [API Reference](#api-reference)
- [Development Commands](#development-commands)
- [Database Schema](#database-schema)
- [Build Status](#build-status)
- [Production Path](#production-path)

---

## Features

- **Multi-channel ticket intake** — web portal, Microsoft Teams bot, inbound email (admin-configurable address)
- **Full ticket lifecycle** — New → Assigned → In Progress → Pending → Resolved → Closed with audit trail on every transition
- **SLA policies** — admin-configured response and resolution time targets per priority tier, breach detection and escalation
- **Routing rules engine** — admin-configured rules match tickets by category, keyword, or channel and auto-assign to a team or agent
- **Knowledge base** — internal article authoring, SharePoint, Confluence, and Amazon S3 read-only connectors, Elasticsearch full-text search, KB deflection tracking
- **Inbound email** — shared mailbox polling (IMAP or Microsoft Graph) converts incoming emails into tickets; replies thread back to the original ticket via `[#N]` subject tag; admin-configurable access control (anyone, approved domains, or specific users)
- **Outbound notifications** — admin-controlled in-app inbox (bell with unread badge) and email delivery (SMTP or Microsoft Graph) triggered by ticket lifecycle events and SLA breaches
- **Configurable dashboard** — live ticket overview with drag-and-drop widget reordering and visibility toggles; per-user layout with admin-settable role defaults
- **Auth** — Entra ID SSO (Azure AD) and local username/password; JWT access + rotating refresh tokens
- **Role-based access control** — Admin, Manager, Agent, End User enforced globally on all routes
- **User management** — Admin can view all users, search by name/email, and change roles from the admin panel
- **File attachments** — MinIO (S3-compatible) in Docker Compose; maps to Azure Blob Storage in production

---

## Architecture

```
[Web Portal]   [Teams Bot]   [Email Inbound]
      \              |              /
       [NestJS API — Modular Monolith]
              |
  ┌─────────────────────────────────────┐
  │  Auth   │ Tickets  │    Routing     │
  │  SLA    │   KB     │  Connectors   │
  │  Notify │ Dashboard│    Users      │
  └─────────────────────────────────────┘
        |           |          |
   PostgreSQL     Redis    Elasticsearch
```

All three intake channels normalise into a single `TicketCreatedEvent` consumed by the Tickets module. Channel source is recorded on every ticket for reporting.

The `NotificationsModule` subscribes to ticket lifecycle and SLA events via EventEmitter2. It checks admin-controlled toggles in `AppConfig`, writes `Notification` rows for the in-app inbox, and dispatches emails via a pluggable `EmailService` (SMTP via Nodemailer or Microsoft Graph via REST).

The frontend proxies all backend calls through a Next.js rewrite (`/api/backend/*` → NestJS on port 4000), which avoids Docker hostname resolution issues on the client side.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (React, TypeScript, App Router) |
| Auth (frontend) | NextAuth v4 — AzureADProvider + CredentialsProvider |
| Backend | NestJS 10 (Node.js, TypeScript) |
| ORM / Migrations | Prisma 5 |
| Primary Database | PostgreSQL 16 |
| Cache / Session | Redis 7 |
| Search | Elasticsearch 8.13 |
| File Storage (local) | MinIO (S3-compatible) |
| File Storage (prod) | Azure Blob Storage |
| Teams Integration | Azure Bot Framework SDK |
| Email (SMTP) | Nodemailer |
| Email (Graph) | Microsoft Graph API (client-credentials OAuth) |
| Inbound Email (IMAP) | imapflow + mailparser |
| S3 Connector | AWS SDK v3 (`@aws-sdk/client-s3`) + pdf-parse |
| Auth (SSO) | MSAL + OAuth 2.0 (Entra ID / Azure AD) |
| Auth (local) | bcrypt + JWT (access + refresh) |
| Containerisation | Docker + Docker Compose |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose V2)
- Git

No local Node.js installation is required — everything runs inside containers.

---

## Quickstart

```bash
# 1. Clone the repository
git clone https://github.com/felipe1213/servicedesk.git
cd servicedesk

# 2. Create your local environment file
cp .env.example .env

# 3. Edit .env — at minimum, set these secrets:
#    JWT_SECRET, JWT_REFRESH_SECRET, NEXTAUTH_SECRET, CONNECTOR_ENCRYPTION_KEY
#    (see Environment Variables section for all options)

# 4. Start the full stack
docker compose up --build
```

Once all containers are healthy:

| Service | URL |
|---|---|
| Web portal | http://localhost:3000 |
| NestJS API | http://localhost:4000 |
| MinIO console | http://localhost:9001 |
| Kibana (dev) | http://localhost:5601 |
| Elasticsearch | http://localhost:9200 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

The backend runs `prisma migrate deploy` automatically on startup — no manual migration step needed.

> **Elasticsearch disk warning:** If your machine's disk is >90% full, Elasticsearch will refuse to create indexes and the KB search feature will be unavailable. Disable the threshold check with:
> ```bash
> curl -X PUT http://localhost:9200/_cluster/settings \
>   -H 'Content-Type: application/json' \
>   -d '{"transient":{"cluster.routing.allocation.disk.threshold_enabled":false}}'
> ```

### Creating the first admin user

A seed script creates three users automatically:

| Email | Password | Role |
|---|---|---|
| admin@inktel.com | Admin123! | ADMIN |
| agent@inktel.com | Agent123! | AGENT |
| user@inktel.com | User123! | END_USER |

To run the seed manually:

```bash
cd backend
DATABASE_URL=postgresql://servicedesk:servicedesk_pass@localhost:5432/servicedesk \
  npx ts-node -r tsconfig-paths/register prisma/seed.ts
```

Or to create users without the seed, register through the API then promote via Postgres:

```bash
# 1. Register
curl -s -X POST http://localhost:4000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Admin","email":"admin@example.com","password":"Admin1234!"}'

# 2. Promote to ADMIN
docker exec servicedesk-postgres-1 psql -U servicedesk -d servicedesk \
  -c "UPDATE \"User\" SET role = 'ADMIN' WHERE email = 'admin@example.com';"
```

Log in at http://localhost:3000. Admin and Manager roles see the **Admin** link in the sidebar for managing routing rules, SLA policies, knowledge base articles, connectors, dashboard defaults, and notification settings.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values below.

### Database

| Variable | Description | Default |
|---|---|---|
| `POSTGRES_USER` | PostgreSQL username | `servicedesk` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `servicedesk_pass` |
| `POSTGRES_DB` | Database name | `servicedesk` |
| `DATABASE_URL` | Full Prisma connection string | `postgresql://servicedesk:servicedesk_pass@postgres:5432/servicedesk` |

### Redis

| Variable | Description | Default |
|---|---|---|
| `REDIS_URL` | Redis connection URL | `redis://redis:6379` |

### JWT (change all secrets before any real deployment)

| Variable | Description | Default |
|---|---|---|
| `JWT_SECRET` | Signs access tokens | `change_me_in_production` |
| `JWT_REFRESH_SECRET` | Signs refresh tokens (must differ from `JWT_SECRET`) | `change_refresh_secret_in_production` |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | `7d` |

### Entra ID / Azure AD (optional — skip if using local auth only)

| Variable | Description |
|---|---|
| `ENTRA_CLIENT_ID` | Azure AD app client ID |
| `ENTRA_CLIENT_SECRET` | Azure AD app client secret |
| `ENTRA_TENANT_ID` | Azure AD tenant ID |
| `ENTRA_REDIRECT_URI` | OAuth callback URL (e.g. `http://localhost:3000/auth/callback`) |

### MinIO (file attachments)

| Variable | Description | Default |
|---|---|---|
| `MINIO_ROOT_USER` | MinIO admin username | `minioadmin` |
| `MINIO_ROOT_PASSWORD` | MinIO admin password | `minioadmin` |
| `MINIO_ENDPOINT` | MinIO service URL | `http://minio:9000` |
| `MINIO_BUCKET` | Bucket for ticket attachments | `servicedesk-attachments` |

### Elasticsearch

| Variable | Description | Default |
|---|---|---|
| `ELASTICSEARCH_URL` | Elasticsearch URL | `http://elasticsearch:9200` |

### Encryption (connectors + notification email credentials)

| Variable | Description |
|---|---|
| `CONNECTOR_ENCRYPTION_KEY` | 64-character hex string (32 bytes) used for AES-256-GCM encryption of connector credentials and email transport credentials. Generate with: `openssl rand -hex 32` |

### Backend

| Variable | Description | Default |
|---|---|---|
| `PORT` | NestJS listen port | `4000` |
| `NODE_ENV` | Node environment | `development` |

### Frontend

| Variable | Description | Default |
|---|---|---|
| `NEXTAUTH_URL` | Canonical URL of the Next.js app | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Signs NextAuth JWTs — **must be set** | — |
| `NEXT_PUBLIC_API_URL` | Backend URL used by the browser | `http://localhost:4000` |
| `BACKEND_URL` | Backend URL used server-side (NextAuth login call inside the container) | `http://backend:4000` |

---

## Project Structure

```
servicedesk/
├── backend/                    # NestJS modular monolith
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema (13 models, 6 enums)
│   │   └── migrations/         # Prisma migration files
│   ├── src/
│   │   ├── main.ts             # Bootstrap — ValidationPipe, CORS, shutdown hooks
│   │   ├── app.module.ts       # Root module — global guards registered here
│   │   ├── prisma/             # PrismaModule (@Global) + PrismaService
│   │   └── modules/
│   │       ├── auth/           # Auth module — local + Entra ID, JWT, RBAC
│   │       ├── tickets/        # Tickets — CRUD, state machine, comments, attachments, events
│   │       ├── attachments/    # File attachments — MinIO wrapper
│   │       ├── users/          # Agent list endpoint
│   │       ├── sla/            # SLA policies, breach detection, escalation
│   │       ├── routing/        # Routing rules engine
│   │       ├── kb/             # Knowledge base — authoring, search, deflection
│   │       ├── connectors/     # SharePoint + Confluence bidirectional sync
│   │       ├── dashboard/      # Per-user widget layout, role defaults
│   │       └── notifications/  # In-app inbox + SMTP/Graph email notifications
│   │           ├── dto/        # UpdateEventConfigDto, UpdateEmailConfigDto, GetNotificationsQueryDto
│   │           ├── email.service.ts
│   │           ├── notification-config.service.ts
│   │           ├── notification-config.controller.ts
│   │           ├── notification.service.ts
│   │           ├── notification.controller.ts
│   │           └── notifications.module.ts
│   ├── Dockerfile
│   ├── nest-cli.json
│   ├── tsconfig.json
│   └── package.json
│
├── frontend/                   # Next.js 14 App Router
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx      # Root layout with SessionProvider
│   │   │   ├── page.tsx        # Landing / redirect
│   │   │   ├── auth/login/     # Login page
│   │   │   ├── api/auth/[...nextauth]/  # NextAuth route handler
│   │   │   └── (app)/          # Authenticated route group
│   │   │       ├── layout.tsx  # Sidebar nav + notification bell with unread badge
│   │   │       ├── dashboard/  # Configurable widget dashboard (DnD reorder + show/hide)
│   │   │       ├── tickets/    # Ticket list, new ticket, ticket detail
│   │   │       ├── kb/         # Knowledge base browse + article view
│   │   │       ├── notifications/  # Full notification inbox
│   │   │       └── admin/      # Admin pages
│   │   │           ├── routing-rules/
│   │   │           ├── sla-policies/
│   │   │           ├── kb/
│   │   │           ├── connectors/
│   │   │           ├── dashboard-defaults/
│   │   │           └── notifications/  # Event toggles + email delivery config
│   │   ├── components/
│   │   │   └── session-provider.tsx
│   │   ├── middleware.ts        # Route protection
│   │   └── types/
│   │       ├── auth.ts
│   │       └── next-auth.d.ts
│   ├── next.config.js
│   ├── jest.config.ts
│   ├── Dockerfile
│   └── package.json
│
├── docs/
│   └── superpowers/
│       ├── specs/              # Design specifications
│       └── plans/              # Implementation plans
│
├── docker-compose.yml          # 7-service stack
├── .env.example                # Template for all environment variables
└── .gitignore
```

---

## Authentication

### Local auth flow

```
POST /auth/register   { name, email, password }  →  201 { id, name, email, role }
POST /auth/login      { email, password }         →  200 { accessToken, refreshToken }
POST /auth/refresh    { refreshToken }            →  200 { accessToken, refreshToken }
GET  /auth/me                                     →  200 { id, name, email, role, ... }
```

- Passwords are hashed with bcrypt (cost 10); accepted length is 8–128 characters.
- Access tokens expire in 15 minutes; refresh tokens expire in 7 days.
- The two JWT secrets are intentionally separate.

### Entra ID SSO

Handled by NextAuth `AzureADProvider`. On sign-in, NextAuth calls `POST /auth/entra`, which upserts the user by Entra Object ID (`entraOid`).

### Role-based access control

Four roles: `ADMIN`, `MANAGER`, `AGENT`, `END_USER`.

All routes are protected by a global `JwtAuthGuard`. Endpoints decorated with `@Public()` bypass the JWT check. Role restrictions use `@Roles(Role.ADMIN)` enforced by the global `RolesGuard`.

---

## API Reference

### Auth (public)

| Method | Path | Body |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` |
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/refresh` | `{ refreshToken }` |
| GET | `/auth/me` | — (protected) |

### Tickets (all protected)

| Method | Path | Notes |
|---|---|---|
| POST | `/tickets` | `{ title, description, priority?, category?, sourceChannel }` |
| GET | `/tickets` | Query: `status?`, `priority?`, `search?`, `page?`, `limit?` — role-filtered |
| GET | `/tickets/stats` | `{ total, byStatus, byPriority }` |
| GET | `/tickets/:id` | Internal comments filtered for end users |
| PATCH | `/tickets/:id` | Any subset of ticket fields |
| POST | `/tickets/:id/comments` | `{ body, isInternal? }` |
| GET | `/tickets/:id/attachments` | Presigned download URLs |
| POST | `/tickets/:id/attachments` | Multipart upload, max 10 MB |

### Users

| Method | Path | Roles |
|---|---|---|
| GET | `/users/agents` | AGENT+ |
| GET | `/users` | ADMIN |
| PATCH | `/users/:id/role` | ADMIN |

### Routing Rules (ADMIN or MANAGER)

| Method | Path |
|---|---|
| GET | `/routing-rules` |
| POST | `/routing-rules` |
| PATCH | `/routing-rules/reorder` |
| PATCH | `/routing-rules/:id` |
| DELETE | `/routing-rules/:id` |

### SLA Policies (ADMIN only)

| Method | Path |
|---|---|
| GET | `/sla-policies` |
| POST | `/sla-policies` |
| PATCH | `/sla-policies/:id` |
| DELETE | `/sla-policies/:id` |

### Knowledge Base

| Method | Path | Roles |
|---|---|---|
| GET | `/kb` | All |
| POST | `/kb` | ADMIN, MANAGER |
| GET | `/kb/search?q=` | All |
| GET | `/kb/suggest?ticketId=` | AGENT+ |
| GET | `/kb/:id` | All |
| PATCH | `/kb/:id` | ADMIN, MANAGER |
| DELETE | `/kb/:id` | ADMIN |
| POST | `/kb/:id/deflect` | All |

### Connectors (ADMIN only)

| Method | Path | Description |
|---|---|---|
| GET | `/connectors/sharepoint/config` | Get SharePoint config (secret redacted) |
| PUT | `/connectors/sharepoint/config` | Save SharePoint credentials |
| POST | `/connectors/sharepoint/test` | Test SharePoint connection |
| POST | `/connectors/sharepoint/sync` | Manual SharePoint sync |
| GET | `/connectors/confluence/config` | Get Confluence config (token redacted) |
| PUT | `/connectors/confluence/config` | Save Confluence credentials |
| POST | `/connectors/confluence/test` | Test Confluence connection |
| POST | `/connectors/confluence/sync` | Manual Confluence sync |
| GET | `/connectors/s3/config` | Get S3 config (secret redacted) |
| PUT | `/connectors/s3/config` | Save S3 credentials |
| POST | `/connectors/s3/test` | Test S3 connection |
| POST | `/connectors/s3/sync` | Manual S3 sync |
| GET | `/connectors/conflicts` | List sync conflicts |
| POST | `/connectors/conflicts/:articleId/resolve` | Resolve a conflict |
| GET | `/connectors/logs` | Last 20 sync log entries |
| POST | `/connectors/export/:articleId` | Export KB article to SharePoint or Confluence |

### Dashboard

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/dashboard/config` | All | Get caller's widget layout (personal → role default → hardcoded fallback) |
| PUT | `/dashboard/config` | All | Save personal widget layout |
| GET | `/dashboard/defaults/:role` | ADMIN | Get role default layout |
| PUT | `/dashboard/defaults/:role` | ADMIN | Save role default layout |

### Notifications

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/notifications` | All | Fetch inbox — `limit` (default 50, max 100), `unread` (boolean) |
| PATCH | `/notifications/read-all` | All | Mark all notifications read |
| PATCH | `/notifications/:id/read` | All | Mark one notification read |
| GET | `/notifications/config` | ADMIN | Get event toggle settings |
| PUT | `/notifications/config` | ADMIN | Update event toggles |
| GET | `/notifications/email-config` | ADMIN | Get email transport + redacted credentials |
| PUT | `/notifications/email-config` | ADMIN | Save email transport + credentials |
| POST | `/notifications/email-config/test` | ADMIN | Send a test email to the authenticated admin |

#### Notification event toggles

| AppConfig key | Event |
|---|---|
| `notification.event.ticket_created` | Email confirmation to submitter on creation |
| `notification.event.ticket_assigned` | In-app + email to assigned agent |
| `notification.event.ticket_commented` | In-app + email to ticket participants |
| `notification.event.ticket_status_changed` | In-app + email to creator on status change (includes resolved) |
| `notification.event.sla_breach` | In-app + email to assignee and all MANAGER-role users |

---

## Development Commands

### Backend

```bash
# Enter the backend container shell
docker compose exec backend sh

# Generate Prisma client after schema changes
npm run db:generate

# Open Prisma Studio (database GUI)
npm run db:studio

# Run tests
npm test

# Run tests with coverage
npm run test:cov
```

### Frontend

```bash
# Enter the frontend container shell
docker compose exec frontend sh

# Run tests
npm test
```

### Docker Compose

```bash
docker compose up -d                        # Start all services
docker compose logs -f backend              # Tail backend logs
docker compose up -d --build backend        # Rebuild one service
docker compose down                         # Stop (keep volumes)
docker compose down -v                      # Stop and wipe all data
```

---

## Database Schema

| Model | Purpose |
|---|---|
| `User` | Accounts — local or Entra ID, role, optional team membership |
| `Team` | Groups of agents |
| `Ticket` | Core entity — title, description, status, priority, source channel, SLA deadlines, auto-increment ticket number |
| `Comment` | Thread on a ticket; `isInternal` separates agent notes from end-user messages |
| `AuditLog` | Immutable record of every ticket state change |
| `Attachment` | File metadata; binary stored in MinIO |
| `SlaPolicy` | Per-priority response and resolution time targets |
| `RoutingRule` | Ordered rules that auto-assign new tickets to a team or agent |
| `KbArticle` | Knowledge base articles (INTERNAL / SHAREPOINT / CONFLUENCE / S3 source) |
| `KbDeflection` | Tracks when a KB article resolved a ticket |
| `DashboardConfig` | Per-user widget layout stored as JSON |
| `AppConfig` | Key/value store for admin-configurable settings (connector credentials, notification config) |
| `Notification` | In-app notification rows — userId, title, body, ticketId, read flag |

### Ticket state machine

```
New → Assigned → In Progress → Pending → Resolved → Closed
```

Every transition is written to `AuditLog` with the actor, old value, and new value.

---

## Build Status

| Phase | Scope | Status |
|---|---|---|
| Phase 1 | Foundation — Docker Compose, Prisma schema, Auth module (local + Entra ID), RBAC | ✅ Complete |
| Phase 2 | Tickets module — full CRUD, state machine, comments, audit log; web portal UI | ✅ Complete |
| Phase 2 (completion) | Filter + search, agent assignment UI, file attachments (MinIO), backend + frontend tests | ✅ Complete |
| Phase 3 | Routing rules engine, SLA policies, breach detection, configurable escalation, admin UI | ✅ Complete |
| Phase 4a | Knowledge base — internal authoring (markdown), Elasticsearch search, inline ticket suggestions, deflection tracking | ✅ Complete |
| Phase 4b | External KB connectors — SharePoint and Confluence bidirectional sync, OAuth flows, conflict resolution | ✅ Complete |
| Phase 5a | Configurable dashboard — drag-and-drop widget reordering, per-user layouts, admin role defaults | ✅ Complete |
| Phase 5b | Outbound notifications — in-app inbox (bell + badge), SMTP + Microsoft Graph email, 6 event types, admin config | ✅ Complete |
| Phase 5c | Inbound email — IMAP + Microsoft Graph polling, email-to-ticket + reply threading, access control, attachments | ✅ Complete |
| S3 Connector | Amazon S3 read-only KB connector — .md/.html/.txt/.pdf sync, ETag change detection, scheduled polling | ✅ Complete |
| User Management | Admin panel — user list with search, inline role editing | ✅ Complete |

---

## Production Path

Each Docker service maps 1:1 to an Azure equivalent with only connection string changes:

| Docker | Azure |
|---|---|
| PostgreSQL | Azure Database for PostgreSQL |
| Redis | Azure Cache for Redis |
| Elasticsearch | Azure AI Search |
| MinIO | Azure Blob Storage |
| Backend container | Azure App Service / Container Apps |
| Frontend container | Azure Static Web Apps or Container Apps |
