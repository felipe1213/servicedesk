# ServiceDesk

An enterprise-scale help desk ticketing system built with NestJS and Next.js, inspired by ServiceNow. Supports ticket creation through a web portal, Microsoft Teams bot, and email; a knowledge base with internal authoring and external integrations; SLA tracking; and a configurable manager dashboard.

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
- [Planned Features](#planned-features)

---

## Features

- **Multi-channel ticket intake** — web portal, Microsoft Teams bot, inbound email (admin-configurable address)
- **Full ticket lifecycle** — New → Assigned → In Progress → Pending → Resolved → Closed with audit trail on every transition
- **SLA policies** — admin-configured response and resolution time targets per priority tier, breach detection and escalation
- **Routing rules engine** — admin-configured rules match tickets by category, keyword, or channel and auto-assign to a team or agent
- **Knowledge base** — internal article authoring, SharePoint and Confluence connectors, Elasticsearch full-text search, KB deflection tracking
- **Manager dashboard** — live ticket overview, SLA compliance, escalations, agent workload, trends; layout configurable per user and per role
- **Auth** — Entra ID SSO (Azure AD) and local username/password; JWT access + rotating refresh tokens
- **Role-based access control** — Admin, Manager, Agent, End User enforced globally on all routes
- **File attachments** — MinIO (S3-compatible) in Docker Compose; maps to Azure Blob Storage in production

---

## Architecture

```
[Web Portal]   [Teams Bot]   [Email Inbound]
      \              |              /
       [NestJS API — Modular Monolith]
              |
  ┌───────────────────────────────┐
  │  Auth  │ Tickets │  Routing  │
  │  SLA   │   KB    │  Notify   │
  │        Admin/Config           │
  └───────────────────────────────┘
        |           |          |
   PostgreSQL     Redis    Elasticsearch
```

All three intake channels normalise into a single `TicketCreatedEvent` consumed by the Tickets module. Channel source is recorded on every ticket for reporting.

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
| Email Integration | Microsoft Graph API |
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
#    JWT_SECRET, JWT_REFRESH_SECRET, NEXTAUTH_SECRET
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

### Creating the first admin user

There is no seed file. Register a user through the API, then promote it to ADMIN via Postgres:

```bash
# 1. Register
curl -s -X POST http://localhost:4000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Admin","email":"admin@example.com","password":"yourpassword"}'

# 2. Promote to ADMIN
docker exec servicedesk-postgres-1 psql -U servicedesk -d servicedesk \
  -c "UPDATE \"User\" SET role = 'ADMIN' WHERE email = 'admin@example.com';"
```

Log in at http://localhost:3000 with those credentials. Admin and Manager roles see the **Admin** link in the sidebar for managing routing rules, SLA policies, and knowledge base articles. All authenticated users see the **Knowledge Base** link for browsing and searching published articles.

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
| `NEXT_PUBLIC_API_URL` | Backend URL used by the browser (Next.js rewrite source) | `http://localhost:4000` |
| `BACKEND_URL` | Backend URL used server-side (NextAuth login call inside the container) | `http://backend:4000` |

---

## Project Structure

```
servicedesk/
├── backend/                    # NestJS modular monolith
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema (11 models, 6 enums)
│   │   └── migrations/         # Prisma migration files
│   ├── src/
│   │   ├── main.ts             # Bootstrap — ValidationPipe, CORS, shutdown hooks
│   │   ├── app.module.ts       # Root module — global guards registered here
│   │   ├── prisma/             # PrismaModule (@Global) + PrismaService
│   │   └── modules/
│   │       ├── auth/           # Auth module (Phase 1)
│   │       │   ├── strategies/ # passport-local, passport-jwt
│   │       │   ├── guards/     # JwtAuthGuard, LocalAuthGuard, RolesGuard
│   │       │   ├── decorators/ # @Public(), @Roles()
│   │       │   ├── dto/        # LoginDto, RegisterDto (class-validator)
│   │       │   ├── auth.service.ts
│   │       │   └── auth.controller.ts
│   │       ├── tickets/        # Tickets module (Phase 2)
│   │       │   ├── dto/        # CreateTicketDto, UpdateTicketDto, CreateCommentDto, FindTicketsQueryDto
│   │       │   ├── tickets.service.ts
│   │       │   └── tickets.controller.ts
│   │       ├── attachments/    # File attachments — MinIO wrapper (Phase 2 completion)
│   │       │   ├── attachments.service.ts
│   │       │   └── attachments.controller.ts
│   │       ├── users/          # Agent list endpoint (Phase 2 completion)
│   │       │   ├── users.service.ts
│   │       │   └── users.controller.ts
│   │       └── kb/             # Knowledge base module (Phase 4a)
│   │           ├── dto/        # CreateArticleDto, UpdateArticleDto
│   │           ├── kb.service.ts
│   │           └── kb.controller.ts
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
│   │   │   └── (app)/          # Authenticated route group (Phase 2)
│   │   │       ├── layout.tsx  # Sidebar nav layout
│   │   │       ├── dashboard/  # Stats overview
│   │   │       ├── tickets/    # Ticket list, new ticket, ticket detail
│   │   │       ├── kb/         # Knowledge base browse + article view (Phase 4a)
│   │   │       └── admin/      # Routing rules, SLA policies, KB management
│   │   ├── components/
│   │   │   └── session-provider.tsx  # Client wrapper for NextAuth SessionProvider
│   │   ├── lib/
│   │   │   └── api.ts          # Axios instance (baseURL: /api/backend)
│   │   ├── middleware.ts        # Route protection (/dashboard, /tickets, /admin)
│   │   └── types/
│   │       ├── auth.ts         # Shared auth types
│   │       └── next-auth.d.ts  # Session type augmentation (accessToken)
│   ├── next.config.js          # Rewrite /api/backend/* → NestJS
│   ├── jest.config.ts
│   ├── Dockerfile
│   └── package.json
│
├── docs/
│   └── superpowers/
│       ├── specs/              # Design specification
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

- Passwords are hashed with bcrypt (cost 10); accepted length is 8–128 characters to prevent DoS via large bcrypt inputs.
- Access tokens expire in 15 minutes; refresh tokens expire in 7 days.
- The two JWT secrets are intentionally separate — a compromised access-token secret cannot be used to forge refresh tokens.

### Entra ID SSO (Azure AD)

Handled by NextAuth `AzureADProvider` on the frontend. On successful sign-in, NextAuth calls `POST /auth/entra` on the backend, which upserts the user by their Entra Object ID (`entraOid`). Identity is tied to the OID rather than the email address, which prevents account takeover if an email changes or is reused.

### Role-based access control

Four roles: `ADMIN`, `MANAGER`, `AGENT`, `END_USER`.

All routes are protected by a global `JwtAuthGuard`. Endpoints decorated with `@Public()` bypass the JWT check (login, register, refresh). Role restrictions are applied with `@Roles(Role.ADMIN)` and enforced by the global `RolesGuard`.

---

## API Reference

### Auth endpoints (all public)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` | `{ id, name, email, role, createdAt }` |
| POST | `/auth/login` | `{ email, password }` | `{ accessToken, refreshToken }` |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` |

### Auth endpoints (protected)

| Method | Path | Description |
|---|---|---|
| GET | `/auth/me` | Returns the authenticated user's profile |

### Ticket endpoints (all protected — require Bearer token)

| Method | Path | Body / Notes | Response |
|---|---|---|---|
| POST | `/tickets` | `{ title, description, priority?, category?, sourceChannel }` | Created ticket |
| GET | `/tickets` | Query: `status?`, `priority?`, `search?`, `page?`, `limit?` — role-filtered | `{ data, total, page, limit }` |
| GET | `/tickets/stats` | — | `{ total, byStatus, byPriority }` |
| GET | `/tickets/:id` | — Internal comments filtered for end users | Full ticket with comments + audit log |
| PATCH | `/tickets/:id` | Any subset of `{ title, description, priority, category, status, assignedToId }` | Updated ticket |
| POST | `/tickets/:id/comments` | `{ body, isInternal? }` — `isInternal` ignored for end users | Created comment |
| GET | `/tickets/:id/attachments` | — | Attachment list with presigned download URLs |
| POST | `/tickets/:id/attachments` | Multipart file upload, max 10 MB | Created attachment record |

### User endpoints (protected)

| Method | Path | Description |
|---|---|---|
| GET | `/users/agents` | Returns `{ id, name, email }` for all agent-or-above users — used to populate assignee dropdowns. `END_USER` role receives 403. |

### Routing Rules endpoints (ADMIN or MANAGER only)

| Method | Path | Description |
|---|---|---|
| GET | `/routing-rules` | List all rules ordered by priorityOrder |
| POST | `/routing-rules` | Create a routing rule |
| PATCH | `/routing-rules/reorder` | Bulk-update rule order |
| PATCH | `/routing-rules/:id` | Update a routing rule |
| DELETE | `/routing-rules/:id` | Delete a routing rule |

### SLA Policy endpoints (ADMIN only)

| Method | Path | Description |
|---|---|---|
| GET | `/sla-policies` | List all SLA policies |
| POST | `/sla-policies` | Create an SLA policy |
| PATCH | `/sla-policies/:id` | Update an SLA policy |
| DELETE | `/sla-policies/:id` | Delete an SLA policy |

### Knowledge Base endpoints (Phase 4a)

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/kb` | All | List published articles (ADMIN/MANAGER see drafts too) |
| POST | `/kb` | ADMIN, MANAGER | Create article |
| GET | `/kb/search?q=` | All | Elasticsearch full-text search |
| GET | `/kb/suggest?ticketId=` | AGENT+ | Top 5 article suggestions for a ticket |
| GET | `/kb/:id` | All | View article (increments viewCount) |
| PATCH | `/kb/:id` | ADMIN, MANAGER | Update article |
| DELETE | `/kb/:id` | ADMIN | Delete article |
| POST | `/kb/:id/deflect` | All | Log deflection (`{ type: 'AGENT'\|'END_USER', ticketId? }`) |

`sourceChannel` must be one of `WEB`, `TEAMS`, `EMAIL`.  
`priority` must be one of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` (defaults to `MEDIUM`).  
`status` must be one of `NEW`, `ASSIGNED`, `IN_PROGRESS`, `PENDING`, `RESOLVED`, `CLOSED`.

All protected endpoints require `Authorization: Bearer <accessToken>` in the request header.

Rate limiting is applied globally at 10 requests per minute per IP via `@nestjs/throttler`.

---

## Development Commands

Run commands inside the container or locally if you have Node 20 installed.

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

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov
```

### Frontend

```bash
# Enter the frontend container shell
docker compose exec frontend sh

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Docker Compose

```bash
# Start all services (detached)
docker compose up -d

# Tail logs for a specific service
docker compose logs -f backend

# Rebuild a single service after code changes to its Dockerfile
docker compose up -d --build backend

# Stop and remove all containers (keeps volumes)
docker compose down

# Stop and remove all containers AND volumes (resets all data)
docker compose down -v
```

---

## Database Schema

Key models and relationships:

| Model | Purpose |
|---|---|
| `User` | Accounts — local or Entra ID, with role and optional team membership |
| `Team` | Groups of agents; tickets and routing rules can target a team |
| `Ticket` | Core entity — title, description, status, priority, source channel, SLA deadlines |
| `Comment` | Thread on a ticket; `isInternal` separates agent notes from end-user messages |
| `AuditLog` | Immutable record of every ticket state change |
| `SlaPolicy` | Per-priority response and resolution time targets |
| `RoutingRule` | Ordered rules that auto-assign new tickets to a team or agent |
| `KbArticle` | Knowledge base articles (internal, SharePoint, or Confluence source); status DRAFT/PUBLISHED, slug, viewCount |
| `KbDeflection` | Tracks when a KB article resolved a ticket (AGENT) or satisfied an end user (END_USER) |
| `Attachment` | File metadata; binary stored in MinIO |
| `DashboardConfig` | Per-user widget layout stored as JSON |
| `AppConfig` | Key/value store for admin-configurable settings |

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
| Phase 2 | Tickets module — full CRUD, state machine, comments, audit log; web portal UI (dashboard, ticket list, detail, new ticket form) | ✅ Complete |
| Phase 2 (completion) | Filter + search on ticket list, agent assignment UI, file attachments (MinIO), backend + frontend unit tests | ✅ Complete |
| Phase 3 | Routing rules engine, SLA policies, breach detection, configurable escalation, admin UI | ✅ Complete |
| Phase 4a | Knowledge base — internal authoring (markdown), Elasticsearch search, inline ticket suggestions, deflection tracking | ✅ Complete |
| Phase 4b | External KB connectors — SharePoint and Confluence bidirectional sync, OAuth flows, conflict resolution | 🔜 Planned |
| Phase 5 | Notifications (Teams, email), manager dashboard widgets, Teams bot, email-to-ticket via Microsoft Graph | 🔜 Planned |

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
