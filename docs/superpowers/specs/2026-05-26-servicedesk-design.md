# Service Desk Ticketing System — Design Spec

**Date:** 2026-05-26  
**Status:** Approved  

---

## 1. Overview

An enterprise-scale help desk ticketing system inspired by ServiceNow. Users can create and manage tickets through three channels: a web portal, Microsoft Teams, and email. A knowledge base supports both internal article authoring and external source integration (SharePoint, Confluence). A manager dashboard provides real-time visibility into ticket status, SLA compliance, escalations, and agent workload. All SLA policies, routing rules, and dashboard layouts are admin-configurable.

**Target scale:** Enterprise (1000+ users)

---

## 2. Architecture

**Pattern:** NestJS modular monolith backend + Next.js frontend  
**Local deployment:** Docker Compose (path to Azure when production-ready)

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

All three intake channels normalize into a single `TicketCreatedEvent` consumed by the Tickets module. Channel source is recorded on every ticket for reporting.

---

## 3. Modules

| Module | Responsibility |
|---|---|
| **Auth** | Entra ID SSO (MSAL + OAuth 2.0) and local credentials (bcrypt + JWT), role management: admin, agent, manager, end-user |
| **Tickets** | Full ticket lifecycle with state machine, comments (internal/external), and audit trail |
| **Routing** | Admin-configured rules engine — match incoming tickets by category, keyword, or source channel and assign to team or agent |
| **SLA** | Admin-configured priority tiers with response/resolution time targets, breach detection, and escalation triggers |
| **Knowledge Base** | Internal article authoring, SharePoint and Confluence connectors, Elasticsearch-backed full-text search, KB deflection tracking |
| **Notifications** | Outbound messages to Teams, email, and web portal on ticket events (created, updated, SLA warning, resolved) |
| **Admin/Config** | Routing rules, SLA policies, teams, categories, inbound email address, auto-close timeout, dashboard widget defaults |

The **Tickets** module is the core. Every other module either feeds into it (Routing) or reacts to its events (SLA, Notifications).

---

## 4. Ticket State Machine

```
New → Assigned → In Progress → Pending → Resolved → Closed
```

- **New:** Just created, not yet assigned  
- **Assigned:** Routing rule or dispatcher has assigned to a team/agent  
- **In Progress:** Agent is actively working  
- **Pending:** Waiting on end-user response  
- **Resolved:** Agent marked resolved, awaiting user confirmation  
- **Closed:** User confirmed or auto-closed after configurable timeout  

Every state transition is recorded in the Audit Log.

---

## 5. Intake Channels

### Web Portal (Next.js)
- End users authenticate via Entra ID SSO or local credentials
- Submit tickets via form (title, category, description, attachments)
- Track open tickets, view KB articles, comment, and close tickets
- Agents get a work queue view; managers get the dashboard

### Microsoft Teams Bot (Azure Bot Framework SDK)
- Users interact via bot commands: `new ticket`, `my tickets`, `ticket status #123`
- Adaptive cards for structured ticket input
- Bot sends proactive notifications into the user's Teams chat as tickets progress

### Email Inbound (Microsoft Graph API)
- Inbound email address is admin-configurable (not hardcoded)
- Email subject → ticket title, body → description, sender → user lookup
- Reply to email thread → appends as a comment on the ticket
- Access controlled by email domain/address allowlist configured by admins
- Implemented via Microsoft Graph API webhooks (Exchange/Outlook)

---

## 6. Knowledge Base

- Internal authoring: rich text editor, tagging, versioning
- External connectors: SharePoint and Confluence (admin-configured credentials and sync schedule)
- Elasticsearch powers full-text search across all sources
- KB deflection tracking: records when a user views a KB article and subsequently closes their ticket without agent involvement
- Kibana available in Docker Compose for inspecting search indices during development

---

## 7. Manager Dashboard

Configurable per-manager and per-role. Admins set widget defaults; managers personalize their own layout.

**Available widgets:**

| Widget | Description |
|---|---|
| Live Overview | Open ticket count by status, priority, and team. Auto-refreshes every 60 seconds |
| SLA Tracking | Tickets approaching breach (warning), actively breached, and historical SLA compliance rate |
| Escalations | Tickets flagged for escalation with assignee, age, and last activity |
| Agent Workload | Tickets per agent, average handle time, resolution rate |
| Trends & Reports | Ticket volume over time, channel breakdown, category distribution, KB deflection rate |

- Widget layout, order, and settings (time window, team filter) are configurable per user
- Admins set role-level defaults for all managers
- Heavy aggregation queries are Redis-cached with a short TTL for performance at enterprise scale

---

## 8. Data Model

| Entity | Key Fields |
|---|---|
| **User** | id, name, email, role, auth_provider (entra/local), team_id |
| **Ticket** | id, title, description, status, priority, category, source_channel, created_by, assigned_to, team_id, created_at, updated_at |
| **Comment** | id, ticket_id, author_id, body, is_internal |
| **Audit Log** | id, ticket_id, actor_id, action, old_value, new_value, timestamp |
| **SLA Policy** | id, name, priority_level, response_time_minutes, resolution_time_minutes |
| **Routing Rule** | id, priority_order, conditions (JSON), assign_to_team_id, assign_to_agent_id |
| **KB Article** | id, title, body, source (internal/sharepoint/confluence), tags, view_count |
| **Attachment** | id, ticket_id, filename, mime_type, storage_path, uploaded_by, created_at |
| **Dashboard Config** | id, user_id, role, widget_layout (JSON) |

`is_internal` on Comment distinguishes agent-only notes from messages visible to end users. The Audit Log provides a full history of every state change — critical for SLA disputes and compliance.

---

## 9. Auth

- **Entra ID SSO:** MSAL + OAuth 2.0, handled in the Auth module
- **Local credentials:** bcrypt-hashed passwords, short-lived JWT access tokens, rotating refresh tokens stored in Redis
- **Roles:** admin, manager, agent, end-user — enforced via NestJS Guards on all routes
- **Email-based access:** admins configure allowed email domains/addresses for email-channel ticket creation

---

## 10. Deployment (Docker Compose)

| Service | Image |
|---|---|
| Frontend (Next.js) | Custom Dockerfile |
| Backend (NestJS) | Custom Dockerfile |
| PostgreSQL | `postgres:16` |
| Redis | `redis:7-alpine` |
| Elasticsearch | `elasticsearch:8` |
| Kibana (dev) | `kibana:8` |
| MinIO (file storage) | `minio/minio` |

- All services on a shared Docker network
- Environment variables (DB credentials, Teams bot secret, Entra ID client ID/secret, inbound email config) via `.env` (gitignored)
- NestJS backend runs database migrations on startup (Prisma)
- Single `docker compose up` brings up the full stack

**Production path:** When ready, each Docker service maps 1:1 to its Azure equivalent (Azure App Service, Azure Database for PostgreSQL, Azure Cache for Redis, Azure AI Search) with no code changes — only connection string swaps via environment variables.

---

## 11. Tech Stack Summary

| Layer | Choice |
|---|---|
| Frontend | Next.js (React, TypeScript) |
| Backend | NestJS (Node.js, TypeScript) |
| ORM / Migrations | Prisma |
| Primary Database | PostgreSQL 16 |
| Cache / Session Store | Redis 7 |
| Search | Elasticsearch 8 |
| Teams Integration | Azure Bot Framework SDK |
| Email Integration | Microsoft Graph API |
| Auth (SSO) | MSAL + OAuth 2.0 (Entra ID) |
| Auth (local) | bcrypt + JWT |
| File Storage (local) | MinIO (S3-compatible) |
| File Storage (prod) | Azure Blob Storage |
| Containerization | Docker + Docker Compose |
| CI/CD (future) | GitHub Actions |
