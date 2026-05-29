# Phase 5b — Outbound Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-controlled outbound notifications (in-app inbox + configurable email) for ticket lifecycle events via a new `NotificationsModule` that subscribes to EventEmitter2 events.

**Architecture:** A self-contained `NotificationsModule` subscribes to six ticket/SLA events via `@OnEvent`, reads admin-configured toggles from `AppConfig`, writes `Notification` DB rows for the in-app inbox, and dispatches emails via a pluggable `EmailService` (SMTP via Nodemailer or Microsoft Graph via REST). `TicketsService` gains four new event emissions; `SlaService` gains `sla.breached`. Only `AppModule` (import) is modified beyond the two service files.

**Tech Stack:** NestJS 10, Prisma, EventEmitter2 (@nestjs/event-emitter), Nodemailer, Microsoft Graph REST, Next.js 14 App Router, `useSession()` from next-auth/react, inline styles, `NEXT_PUBLIC_API_URL`

---

## File Map

**Create (backend):**
- `backend/src/modules/notifications/notifications.module.ts`
- `backend/src/modules/notifications/notification.service.ts`
- `backend/src/modules/notifications/notification.controller.ts`
- `backend/src/modules/notifications/notification-config.service.ts`
- `backend/src/modules/notifications/notification-config.controller.ts`
- `backend/src/modules/notifications/email.service.ts`
- `backend/src/modules/notifications/dto/update-event-config.dto.ts`
- `backend/src/modules/notifications/dto/update-email-config.dto.ts`
- `backend/src/modules/notifications/dto/get-notifications-query.dto.ts`
- `backend/src/modules/notifications/notification.service.spec.ts`

**Modify (backend):**
- `backend/prisma/schema.prisma` — add Notification model + `User.notifications` relation
- `backend/src/modules/tickets/tickets.service.ts` — emit 4 new events in `update()` and `addComment()`
- `backend/src/modules/sla/sla.service.ts` — inject EventEmitter2, emit `sla.breached` in `checkBreaches()`
- `backend/src/app.module.ts` — import NotificationsModule

**Create (frontend):**
- `frontend/src/app/(app)/notifications/page.tsx`
- `frontend/src/app/(app)/admin/notifications/page.tsx`

**Modify (frontend):**
- `frontend/src/app/(app)/layout.tsx` — add notification bell with unread badge and dropdown
- `frontend/src/app/(app)/admin/page.tsx` — add 6th card; grid → `repeat(6, 1fr)`, maxWidth 1600

---

### Task 1: Prisma — Add Notification model

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add Notification model and User relation**

In `backend/prisma/schema.prisma`:

a) In the `User` model, add `notifications Notification[]` after the `dashboardConfig` line:

```prisma
dashboardConfig      DashboardConfig?
notifications        Notification[]
```

b) Add new model after the `AppConfig` model:

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

  @@index([userId])
  @@index([userId, read])
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend && npx prisma migrate dev --name add_notification_model
```

Expected: Migration created and applied. `Notification` table exists in the DB.

- [ ] **Step 3: Verify generated client**

```bash
cd backend && npx prisma generate
```

Expected: No errors. `prisma.notification` methods are available.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add Notification model to Prisma schema"
```

---

### Task 2: TicketsService — emit four new ticket events

**Files:**
- Modify: `backend/src/modules/tickets/tickets.service.ts`

Context: EventEmitter2 is already injected in `TicketsService`. The `update()` method already writes audit logs for status and assignment changes — add event emission after each. The `addComment()` method currently returns `this.prisma.comment.create(...)` directly — capture the result, emit, then return.

Event payloads:
- `ticket.assigned`: `{ ticketId, assignedToId, title }`
- `ticket.commented`: `{ ticketId, commentId, authorId, title, creatorId, assignedToId }`
- `ticket.status_changed`: `{ ticketId, status, title, creatorId, assignedToId }` — for all statuses EXCEPT RESOLVED
- `ticket.resolved`: `{ ticketId, title, creatorId }` — when status changes to RESOLVED

- [ ] **Step 1: Write failing tests**

Create `backend/src/modules/tickets/tickets.service.events.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaService } from '../sla/sla.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role, TicketStatus } from '@prisma/client';

describe('TicketsService events', () => {
  let service: TicketsService;
  let emitter: jest.Mocked<EventEmitter2>;
  let prisma: any;

  const mockUser = { id: 'user-1', role: Role.AGENT };
  const baseTicket = {
    id: 'ticket-1', title: 'Test ticket', description: 'Desc',
    status: TicketStatus.NEW, priority: 'MEDIUM' as any,
    createdById: 'creator-1', assignedToId: null,
    createdAt: new Date(), updatedAt: new Date(),
    slaBreached: false, slaPolicyId: null,
    sourceChannel: 'WEB' as any, category: null, teamId: null,
    responseDeadline: null, resolutionDeadline: null,
  };

  beforeEach(async () => {
    emitter = { emit: jest.fn() } as any;
    prisma = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue(baseTicket),
        update: jest.fn().mockResolvedValue({ ...baseTicket, assignedToId: 'agent-1', assignedTo: { name: 'Agent' } }),
      },
      auditLog: { create: jest.fn() },
      comment: {
        create: jest.fn().mockResolvedValue({
          id: 'comment-1', body: 'hello', authorId: 'user-1',
          ticketId: 'ticket-1', isInternal: false, createdAt: new Date(),
          author: { id: 'user-1', name: 'Agent', email: 'agent@test.com' },
        }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SlaService, useValue: { stampDeadlines: jest.fn() } },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get(TicketsService);
  });

  it('emits ticket.assigned when assignedToId changes', async () => {
    await service.update('ticket-1', { assignedToId: 'agent-1' }, mockUser);
    expect(emitter.emit).toHaveBeenCalledWith('ticket.assigned', {
      ticketId: 'ticket-1', assignedToId: 'agent-1', title: 'Test ticket',
    });
  });

  it('emits ticket.status_changed for non-RESOLVED status', async () => {
    prisma.ticket.update.mockResolvedValue({
      ...baseTicket, status: TicketStatus.IN_PROGRESS, assignedToId: null, assignedTo: null,
    });
    await service.update('ticket-1', { status: TicketStatus.IN_PROGRESS }, mockUser);
    expect(emitter.emit).toHaveBeenCalledWith('ticket.status_changed', {
      ticketId: 'ticket-1', status: TicketStatus.IN_PROGRESS, title: 'Test ticket',
      creatorId: 'creator-1', assignedToId: null,
    });
  });

  it('emits ticket.resolved when status changes to RESOLVED', async () => {
    prisma.ticket.update.mockResolvedValue({
      ...baseTicket, status: TicketStatus.RESOLVED, assignedToId: null, assignedTo: null,
    });
    await service.update('ticket-1', { status: TicketStatus.RESOLVED }, mockUser);
    expect(emitter.emit).toHaveBeenCalledWith('ticket.resolved', {
      ticketId: 'ticket-1', title: 'Test ticket', creatorId: 'creator-1',
    });
  });

  it('emits ticket.commented when a comment is created', async () => {
    await service.addComment('ticket-1', { body: 'hello', isInternal: false }, mockUser);
    expect(emitter.emit).toHaveBeenCalledWith('ticket.commented', {
      ticketId: 'ticket-1', commentId: 'comment-1', authorId: 'user-1',
      title: 'Test ticket', creatorId: 'creator-1', assignedToId: null,
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend && npx jest tickets.service.events --no-coverage
```

Expected: FAIL — events not emitted.

- [ ] **Step 3: Modify update() to emit ticket.assigned, ticket.status_changed, ticket.resolved**

Replace the `update()` method body in `backend/src/modules/tickets/tickets.service.ts`. The section after `const effectiveNewStatus = ...` through the end of the method becomes:

```typescript
  async update(id: string, dto: UpdateTicketDto, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();
    if (user.role === Role.END_USER && dto.assignedToId !== undefined) {
      throw new ForbiddenException('End users cannot assign tickets');
    }

    const autoAdvance = !!dto.assignedToId && ticket.status === TicketStatus.NEW;

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { ...dto, ...(autoAdvance ? { status: TicketStatus.ASSIGNED } : {}) },
      include: TICKET_INCLUDE,
    });

    const effectiveNewStatus = autoAdvance ? TicketStatus.ASSIGNED : dto.status;
    if (effectiveNewStatus && effectiveNewStatus !== ticket.status) {
      await this.prisma.auditLog.create({
        data: {
          ticketId: id,
          actorId: user.id,
          action: 'STATUS_CHANGED',
          oldValue: ticket.status,
          newValue: effectiveNewStatus,
        },
      });
      if (effectiveNewStatus === TicketStatus.RESOLVED) {
        this.eventEmitter.emit('ticket.resolved', {
          ticketId: id,
          title: updated.title,
          creatorId: ticket.createdById,
        });
      } else {
        this.eventEmitter.emit('ticket.status_changed', {
          ticketId: id,
          status: effectiveNewStatus,
          title: updated.title,
          creatorId: ticket.createdById,
          assignedToId: updated.assignedToId,
        });
      }
    }

    if (dto.assignedToId && dto.assignedToId !== ticket.assignedToId) {
      await this.prisma.auditLog.create({
        data: {
          ticketId: id,
          actorId: user.id,
          action: 'ASSIGNED',
          newValue: (updated.assignedTo as { name: string } | null)?.name ?? dto.assignedToId,
        },
      });
      this.eventEmitter.emit('ticket.assigned', {
        ticketId: id,
        assignedToId: dto.assignedToId,
        title: updated.title,
      });
    }

    return updated;
  }
```

- [ ] **Step 4: Modify addComment() to capture result and emit ticket.commented**

Replace the `addComment()` method body:

```typescript
  async addComment(ticketId: string, dto: CreateCommentDto, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();

    const isInternal = user.role !== Role.END_USER ? (dto.isInternal ?? false) : false;

    const comment = await this.prisma.comment.create({
      data: { ticketId, authorId: user.id, body: dto.body, isInternal },
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    this.eventEmitter.emit('ticket.commented', {
      ticketId,
      commentId: comment.id,
      authorId: user.id,
      title: ticket.title,
      creatorId: ticket.createdById,
      assignedToId: ticket.assignedToId,
    });

    return comment;
  }
```

- [ ] **Step 5: Run the event tests**

```bash
cd backend && npx jest tickets.service.events --no-coverage
```

Expected: 4/4 PASS.

- [ ] **Step 6: Run the full test suite**

```bash
cd backend && npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/tickets/tickets.service.ts backend/src/modules/tickets/tickets.service.events.spec.ts
git commit -m "feat: emit ticket lifecycle events (assigned, commented, status_changed, resolved)"
```

---

### Task 3: SlaService — emit sla.breached

**Files:**
- Modify: `backend/src/modules/sla/sla.service.ts`

Context: `SlaService` currently does not inject `EventEmitter2`. Because `EventEmitterModule.forRoot()` registers `EventEmitter2` as a global provider, no `SlaModule` changes are needed — just add the constructor parameter. The emit happens AFTER the `$transaction` call succeeds, inside the `try` block.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/sla/sla.service.breach.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { SlaService } from './sla.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BreachAction, Priority, TicketStatus } from '@prisma/client';

describe('SlaService.checkBreaches — sla.breached event', () => {
  let service: SlaService;
  let emitter: jest.Mocked<EventEmitter2>;
  let prisma: any;

  const breachingTicket = {
    id: 'ticket-1', title: 'Urgent issue', createdById: 'user-1',
    assignedToId: 'agent-1', priority: Priority.HIGH,
    slaBreached: false, slaPolicyId: 'policy-1',
    slaPolicy: {
      id: 'policy-1', priorityLevel: Priority.HIGH,
      breachAction: BreachAction.FLAG,
      escalateToUserId: null, escalateToTeamId: null,
    },
    status: TicketStatus.IN_PROGRESS,
    createdAt: new Date(Date.now() - 9999999),
    responseDeadline: new Date(Date.now() - 1000),
    resolutionDeadline: new Date(Date.now() - 1000),
  };

  beforeEach(async () => {
    emitter = { emit: jest.fn() } as any;
    prisma = {
      ticket: {
        findMany: jest.fn().mockResolvedValue([breachingTicket]),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(prisma)),
    };

    const module = await Test.createTestingModule({
      providers: [
        SlaService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get(SlaService);
  });

  it('emits sla.breached after the transaction succeeds', async () => {
    await service.checkBreaches();
    expect(emitter.emit).toHaveBeenCalledWith('sla.breached', {
      ticketId: 'ticket-1',
      assignedToId: 'agent-1',
      title: 'Urgent issue',
    });
  });

  it('does not emit sla.breached when the transaction fails', async () => {
    prisma.$transaction.mockRejectedValue(new Error('DB error'));
    await service.checkBreaches();
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend && npx jest sla.service.breach --no-coverage
```

Expected: FAIL — EventEmitter2 not injectable / emit not called.

- [ ] **Step 3: Add EventEmitter2 to SlaService**

At the top of `backend/src/modules/sla/sla.service.ts`, add the import:

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';
```

Replace the constructor:

```typescript
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}
```

In `checkBreaches()`, add the emit call after `await this.prisma.$transaction(...)` succeeds (still inside the `try` block):

```typescript
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.ticket.update({
            where: { id: ticket.id },
            data: { slaBreached: true },
          });

          await tx.auditLog.create({
            data: {
              ticketId: ticket.id,
              actorId: ticket.createdById,
              action: 'SLA_BREACHED',
              newValue: ticket.slaPolicy?.priorityLevel,
            },
          });

          const policy = ticket.slaPolicy;
          if (policy && (policy.breachAction === BreachAction.ESCALATE || policy.breachAction === BreachAction.BOTH)) {
            const updateData: { assignedToId?: string; teamId?: string } = {};
            if (policy.escalateToUserId) updateData.assignedToId = policy.escalateToUserId;
            if (policy.escalateToTeamId) updateData.teamId = policy.escalateToTeamId;
            if (Object.keys(updateData).length > 0) {
              await tx.ticket.update({ where: { id: ticket.id }, data: updateData });
            }
          }
        });

        this.eventEmitter.emit('sla.breached', {
          ticketId: ticket.id,
          assignedToId: ticket.assignedToId,
          title: ticket.title,
        });
      } catch (err) {
        this.logger.error(`Failed to process breach for ticket ${ticket.id}`, err);
      }
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && npx jest sla.service.breach --no-coverage
```

Expected: 2/2 PASS.

- [ ] **Step 5: Run the full test suite**

```bash
cd backend && npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/sla/sla.service.ts backend/src/modules/sla/sla.service.breach.spec.ts
git commit -m "feat: emit sla.breached event from SlaService on breach detection"
```

---

### Task 4: DTOs

**Files:**
- Create: `backend/src/modules/notifications/dto/update-event-config.dto.ts`
- Create: `backend/src/modules/notifications/dto/update-email-config.dto.ts`
- Create: `backend/src/modules/notifications/dto/get-notifications-query.dto.ts`

- [ ] **Step 1: Create UpdateEventConfigDto**

```typescript
// backend/src/modules/notifications/dto/update-event-config.dto.ts
import { IsObject } from 'class-validator';

export class UpdateEventConfigDto {
  @IsObject()
  toggles: Record<string, boolean>;
}
```

- [ ] **Step 2: Create UpdateEmailConfigDto**

```typescript
// backend/src/modules/notifications/dto/update-email-config.dto.ts
import { IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateEmailConfigDto {
  @IsEnum(['SMTP', 'GRAPH', 'NONE'])
  transport: 'SMTP' | 'GRAPH' | 'NONE';

  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() secure?: boolean;
  @IsOptional() @IsString() user?: string;
  @IsOptional() @IsString() pass?: string;

  @IsOptional() @IsEmail() fromAddress?: string;

  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
}
```

- [ ] **Step 3: Create GetNotificationsQueryDto**

```typescript
// backend/src/modules/notifications/dto/get-notifications-query.dto.ts
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  unread?: boolean;
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/notifications/dto/
git commit -m "feat: add DTOs for notifications module"
```

---

### Task 5: NotificationConfigService

**Files:**
- Create: `backend/src/modules/notifications/notification-config.service.ts`

Context: Replicates the AES-256-GCM encrypt/decrypt pattern from `ConnectorConfigService` (`backend/src/modules/connectors/connectors-config.service.ts`) — re-implemented, not imported. Uses the same `CONNECTOR_ENCRYPTION_KEY` env var. The five known event toggle keys are defined as a typed constant to prevent unknown keys from being written.

- [ ] **Step 1: Create the service**

```typescript
// backend/src/modules/notifications/notification-config.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';

export const NOTIFICATION_EVENT_KEYS = [
  'notification.event.ticket_created',
  'notification.event.ticket_assigned',
  'notification.event.ticket_commented',
  'notification.event.ticket_status_changed',
  'notification.event.sla_breach',
] as const;

@Injectable()
export class NotificationConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get encryptionKey(): Buffer {
    const hex = this.config.getOrThrow<string>('CONNECTOR_ENCRYPTION_KEY');
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('CONNECTOR_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    return Buffer.from(hex, 'hex');
  }

  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(stored: string): string {
    const [ivHex, authTagHex, encryptedHex] = stored.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }

  async getEventToggles(): Promise<Record<string, boolean>> {
    const records = await this.prisma.appConfig.findMany({
      where: { key: { in: [...NOTIFICATION_EVENT_KEYS] } },
    });
    const result: Record<string, boolean> = {};
    for (const key of NOTIFICATION_EVENT_KEYS) {
      const record = records.find((r) => r.key === key);
      result[key] = record?.value === 'true';
    }
    return result;
  }

  async updateEventToggles(toggles: Record<string, boolean>): Promise<void> {
    await Promise.all(
      NOTIFICATION_EVENT_KEYS.filter((key) => key in toggles).map((key) =>
        this.prisma.appConfig.upsert({
          where: { key },
          create: { key, value: toggles[key] ? 'true' : 'false' },
          update: { value: toggles[key] ? 'true' : 'false' },
        }),
      ),
    );
  }

  async isEventEnabled(key: string): Promise<boolean> {
    const record = await this.prisma.appConfig.findUnique({ where: { key } });
    return record?.value === 'true';
  }

  async getEmailConfig(): Promise<{ transport: 'SMTP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> }> {
    const transportRecord = await this.prisma.appConfig.findUnique({
      where: { key: 'notification.email.transport' },
    });
    const transport = (transportRecord?.value as 'SMTP' | 'GRAPH' | 'NONE') ?? 'NONE';
    if (transport === 'NONE' || !transportRecord) return { transport: 'NONE', config: {} };

    const configKey = transport === 'SMTP' ? 'notification.email.smtp' : 'notification.email.graph';
    const configRecord = await this.prisma.appConfig.findUnique({ where: { key: configKey } });
    if (!configRecord) return { transport, config: {} };

    try {
      const raw = JSON.parse(configRecord.value) as Record<string, unknown>;
      if (transport === 'SMTP') {
        return { transport, config: { ...raw, pass: this.decrypt(raw.pass as string) } };
      }
      return { transport, config: { ...raw, clientSecret: this.decrypt(raw.clientSecret as string) } };
    } catch {
      return { transport, config: {} };
    }
  }

  async getRedactedEmailConfig(): Promise<{ transport: 'SMTP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> }> {
    const { transport, config } = await this.getEmailConfig();
    if (transport === 'SMTP' && config.pass) return { transport, config: { ...config, pass: '***' } };
    if (transport === 'GRAPH' && config.clientSecret) return { transport, config: { ...config, clientSecret: '***' } };
    return { transport, config };
  }

  async saveEmailConfig(dto: UpdateEmailConfigDto): Promise<void> {
    const { transport } = dto;
    await this.prisma.appConfig.upsert({
      where: { key: 'notification.email.transport' },
      create: { key: 'notification.email.transport', value: transport },
      update: { value: transport },
    });

    if (transport === 'SMTP') {
      if (!dto.host || !dto.port || dto.secure === undefined || !dto.user || !dto.pass || !dto.fromAddress) {
        throw new BadRequestException('SMTP transport requires host, port, secure, user, pass, and fromAddress');
      }
      const toStore = {
        host: dto.host, port: dto.port, secure: dto.secure,
        user: dto.user, pass: this.encrypt(dto.pass), fromAddress: dto.fromAddress,
      };
      await this.prisma.appConfig.upsert({
        where: { key: 'notification.email.smtp' },
        create: { key: 'notification.email.smtp', value: JSON.stringify(toStore) },
        update: { value: JSON.stringify(toStore) },
      });
    } else if (transport === 'GRAPH') {
      if (!dto.tenantId || !dto.clientId || !dto.clientSecret || !dto.fromAddress) {
        throw new BadRequestException('Graph transport requires tenantId, clientId, clientSecret, and fromAddress');
      }
      const toStore = {
        tenantId: dto.tenantId, clientId: dto.clientId,
        clientSecret: this.encrypt(dto.clientSecret), fromAddress: dto.fromAddress,
      };
      await this.prisma.appConfig.upsert({
        where: { key: 'notification.email.graph' },
        create: { key: 'notification.email.graph', value: JSON.stringify(toStore) },
        update: { value: JSON.stringify(toStore) },
      });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/notifications/notification-config.service.ts
git commit -m "feat: add NotificationConfigService with AppConfig operations and AES-256-GCM encryption"
```

---

### Task 6: EmailService

**Files:**
- Create: `backend/src/modules/notifications/email.service.ts`

Context: Uses `fetch` (globally available in Node 18+) for Microsoft Graph REST calls. SMTP uses Nodemailer. If transport is `NONE` or config load fails, `send()` is a silent no-op (logs a warning, never throws). Email send failures are caught and logged — the caller continues processing other recipients.

- [ ] **Step 1: Install nodemailer**

```bash
cd backend && npm install nodemailer && npm install --save-dev @types/nodemailer
```

- [ ] **Step 2: Create EmailService**

```typescript
// backend/src/modules/notifications/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { NotificationConfigService } from './notification-config.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly notificationConfig: NotificationConfigService) {}

  async send(to: string, subject: string, body: string): Promise<void> {
    let emailConfig: { transport: 'SMTP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> };
    try {
      emailConfig = await this.notificationConfig.getEmailConfig();
    } catch (err) {
      this.logger.warn('Failed to load email config — skipping email send', err);
      return;
    }

    if (emailConfig.transport === 'NONE') {
      this.logger.warn('Email transport not configured — skipping email send');
      return;
    }

    if (emailConfig.transport === 'SMTP') {
      await this.sendSmtp(to, subject, body, emailConfig.config);
    } else if (emailConfig.transport === 'GRAPH') {
      await this.sendGraph(to, subject, body, emailConfig.config);
    }
  }

  private async sendSmtp(
    to: string,
    subject: string,
    body: string,
    cfg: Record<string, unknown>,
  ): Promise<void> {
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.host as string,
        port: cfg.port as number,
        secure: cfg.secure as boolean,
        auth: { user: cfg.user as string, pass: cfg.pass as string },
      });
      await transporter.sendMail({
        from: cfg.fromAddress as string,
        to,
        subject,
        text: body,
      });
    } catch (err) {
      this.logger.error(`SMTP send failed to ${to}`, err);
    }
  }

  private async sendGraph(
    to: string,
    subject: string,
    body: string,
    cfg: Record<string, unknown>,
  ): Promise<void> {
    try {
      const tokenRes = await fetch(
        `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: cfg.clientId as string,
            client_secret: cfg.clientSecret as string,
            scope: 'https://graph.microsoft.com/.default',
          }),
        },
      );
      const tokenData = (await tokenRes.json()) as { access_token: string };

      await fetch(
        `https://graph.microsoft.com/v1.0/users/${cfg.fromAddress}/sendMail`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: 'Text', content: body },
              toRecipients: [{ emailAddress: { address: to } }],
            },
          }),
        },
      );
    } catch (err) {
      this.logger.error(`Graph send failed to ${to}`, err);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/notifications/email.service.ts backend/package*.json
git commit -m "feat: add EmailService with SMTP (Nodemailer) and Microsoft Graph transports"
```

---

### Task 7: NotificationService — event handlers

**Files:**
- Create: `backend/src/modules/notifications/notification.service.ts`

Context: Handles 6 events. `handleTicketCreated` receives the full Prisma ticket object (with `createdBy: { id, name, email }` via `TICKET_INCLUDE` in `TicketsService`) — access `event.id`, `event.createdById`, `event.createdBy.email`. The other handlers receive plain payload objects and must fetch user emails via PrismaService. `handleTicketResolved` uses the same `notification.event.ticket_status_changed` toggle (no separate toggle for resolved). `handleSlaBreached` uses a Map to deduplicate MANAGER + assignee recipients.

- [ ] **Step 1: Create NotificationService**

```typescript
// backend/src/modules/notifications/notification.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';
import { NotificationConfigService } from './notification-config.service';

type TicketCreatedPayload = {
  id: string;
  title: string;
  createdById: string;
  createdBy: { id: string; name: string; email: string };
};
type TicketAssignedPayload = { ticketId: string; assignedToId: string; title: string };
type TicketCommentedPayload = {
  ticketId: string; commentId: string; authorId: string;
  title: string; creatorId: string; assignedToId: string | null;
};
type TicketStatusChangedPayload = {
  ticketId: string; status: string; title: string;
  creatorId: string; assignedToId: string | null;
};
type TicketResolvedPayload = { ticketId: string; title: string; creatorId: string };
type SlaBreachedPayload = { ticketId: string; assignedToId: string | null; title: string };

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: NotificationConfigService,
    private readonly emailService: EmailService,
  ) {}

  private async notify(
    userId: string,
    email: string | null,
    title: string,
    body: string,
    ticketId?: string,
  ) {
    await this.prisma.notification.create({ data: { userId, title, body, ticketId } });
    if (email) {
      await this.emailService.send(email, title, body).catch((err) =>
        this.logger.error(`Email to ${email} failed`, err),
      );
    }
  }

  @OnEvent('ticket.created')
  async handleTicketCreated(event: TicketCreatedPayload): Promise<void> {
    if (!(await this.configService.isEventEnabled('notification.event.ticket_created'))) return;

    const title = `Ticket created: ${event.title}`;
    const body = `Your ticket '${event.title}' has been received and will be reviewed shortly.`;
    await this.notify(event.createdById, event.createdBy?.email ?? null, title, body, event.id);
  }

  @OnEvent('ticket.assigned')
  async handleTicketAssigned(event: TicketAssignedPayload): Promise<void> {
    if (!(await this.configService.isEventEnabled('notification.event.ticket_assigned'))) return;

    const user = await this.prisma.user.findUnique({
      where: { id: event.assignedToId },
      select: { id: true, email: true },
    });
    if (!user) return;

    const title = `Ticket assigned to you: ${event.title}`;
    const body = `You have been assigned ticket '${event.title}'.`;
    await this.notify(user.id, user.email, title, body, event.ticketId);
  }

  @OnEvent('ticket.commented')
  async handleTicketCommented(event: TicketCommentedPayload): Promise<void> {
    if (!(await this.configService.isEventEnabled('notification.event.ticket_commented'))) return;

    const ids = [...new Set([event.creatorId, event.assignedToId].filter(Boolean) as string[])];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true },
    });

    const title = `New comment on: ${event.title}`;
    const body = `A new comment was posted on ticket '${event.title}'.`;
    await Promise.all(users.map((u) => this.notify(u.id, u.email, title, body, event.ticketId)));
  }

  @OnEvent('ticket.status_changed')
  async handleStatusChanged(event: TicketStatusChangedPayload): Promise<void> {
    if (!(await this.configService.isEventEnabled('notification.event.ticket_status_changed'))) return;

    const user = await this.prisma.user.findUnique({
      where: { id: event.creatorId },
      select: { id: true, email: true },
    });
    if (!user) return;

    const title = `Ticket status updated: ${event.title}`;
    const body = `Ticket '${event.title}' status changed to ${event.status.replace(/_/g, ' ')}.`;
    await this.notify(user.id, user.email, title, body, event.ticketId);
  }

  @OnEvent('ticket.resolved')
  async handleTicketResolved(event: TicketResolvedPayload): Promise<void> {
    if (!(await this.configService.isEventEnabled('notification.event.ticket_status_changed'))) return;

    const user = await this.prisma.user.findUnique({
      where: { id: event.creatorId },
      select: { id: true, email: true },
    });
    if (!user) return;

    const title = `Ticket resolved: ${event.title}`;
    const body = `Your ticket '${event.title}' has been resolved.`;
    await this.notify(user.id, user.email, title, body, event.ticketId);
  }

  @OnEvent('sla.breached')
  async handleSlaBreached(event: SlaBreachedPayload): Promise<void> {
    if (!(await this.configService.isEventEnabled('notification.event.sla_breach'))) return;

    const managers = await this.prisma.user.findMany({
      where: { role: Role.MANAGER },
      select: { id: true, email: true },
    });

    const recipientMap = new Map<string, string | null>(
      managers.map((m) => [m.id, m.email]),
    );

    if (event.assignedToId) {
      const assignee = await this.prisma.user.findUnique({
        where: { id: event.assignedToId },
        select: { id: true, email: true },
      });
      if (assignee) recipientMap.set(assignee.id, assignee.email);
    }

    const title = `SLA breached: ${event.title}`;
    const body = `Ticket '${event.title}' has breached its SLA deadline.`;
    await Promise.all(
      [...recipientMap.entries()].map(([userId, email]) =>
        this.notify(userId, email, title, body, event.ticketId),
      ),
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/notifications/notification.service.ts
git commit -m "feat: add NotificationService with @OnEvent handlers for all 6 ticket/SLA events"
```

---

### Task 8: NotificationController — inbox endpoints

**Files:**
- Create: `backend/src/modules/notifications/notification.controller.ts`

Context: `PATCH /notifications/read-all` must be declared BEFORE `PATCH /notifications/:id/read` so NestJS routes the static path before the parameterized one. The controller directly uses `PrismaService` since the inbox operations are simple CRUD. `updateMany` with `{ id, userId }` ensures a user cannot mark another user's notification read.

- [ ] **Step 1: Create the controller**

```typescript
// backend/src/modules/notifications/notification.controller.ts
import { Controller, Get, Patch, Param, Query, Request } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';

type RequestUser = { id: string };

@Controller('notifications')
export class NotificationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getNotifications(
    @Request() req: { user: RequestUser },
    @Query() query: GetNotificationsQueryDto,
  ) {
    const limit = Math.min(query.limit ?? 50, 100);
    const where: Record<string, unknown> = { userId: req.user.id };
    if (query.unread === true) where.read = false;

    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  @Patch('read-all')
  async markAllRead(@Request() req: { user: RequestUser }) {
    await this.prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true },
    });
    return { success: true };
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    await this.prisma.notification.updateMany({
      where: { id, userId: req.user.id },
      data: { read: true },
    });
    return { success: true };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/notifications/notification.controller.ts
git commit -m "feat: add NotificationController with inbox endpoints (GET, PATCH read/read-all)"
```

---

### Task 9: NotificationConfigController — admin config endpoints

**Files:**
- Create: `backend/src/modules/notifications/notification-config.controller.ts`

Context: All endpoints require `@Roles(Role.ADMIN)`. The `POST /email-config/test` endpoint reads the current admin's email from the JWT payload (`req.user.email`) and calls `EmailService.send()`. The `@Roles` decorator is at `backend/src/modules/auth/decorators/roles.decorator.ts` (same path used by other admin controllers in the project).

- [ ] **Step 1: Create the controller**

```typescript
// backend/src/modules/notifications/notification-config.controller.ts
import { BadRequestException, Body, Controller, Get, Post, Put, Request } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmailService } from './email.service';
import { NotificationConfigService } from './notification-config.service';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';
import { UpdateEventConfigDto } from './dto/update-event-config.dto';

type RequestUser = { id: string; email: string };

@Controller('notifications')
export class NotificationConfigController {
  constructor(
    private readonly configService: NotificationConfigService,
    private readonly emailService: EmailService,
  ) {}

  @Get('config')
  @Roles(Role.ADMIN)
  getEventConfig() {
    return this.configService.getEventToggles();
  }

  @Put('config')
  @Roles(Role.ADMIN)
  updateEventConfig(@Body() dto: UpdateEventConfigDto) {
    return this.configService.updateEventToggles(dto.toggles);
  }

  @Get('email-config')
  @Roles(Role.ADMIN)
  getEmailConfig() {
    return this.configService.getRedactedEmailConfig();
  }

  @Put('email-config')
  @Roles(Role.ADMIN)
  saveEmailConfig(@Body() dto: UpdateEmailConfigDto) {
    return this.configService.saveEmailConfig(dto);
  }

  @Post('email-config/test')
  @Roles(Role.ADMIN)
  async testEmailConfig(@Request() req: { user: RequestUser }) {
    const { transport } = await this.configService.getEmailConfig();
    if (transport === 'NONE') {
      throw new BadRequestException('Email transport not configured');
    }
    await this.emailService.send(
      req.user.email,
      'Service Desk — Test Email',
      'This is a test email from the Service Desk notification system.',
    );
    return { success: true };
  }
}
```

- [ ] **Step 2: Verify the Roles decorator path**

```bash
ls backend/src/modules/auth/decorators/
```

Expected: `roles.decorator.ts` exists. If the path differs, update the import accordingly.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/notifications/notification-config.controller.ts
git commit -m "feat: add NotificationConfigController with admin config and test-email endpoints"
```

---

### Task 10: NotificationsModule + AppModule registration

**Files:**
- Create: `backend/src/modules/notifications/notifications.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create NotificationsModule**

```typescript
// backend/src/modules/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailService } from './email.service';
import { NotificationConfigController } from './notification-config.controller';
import { NotificationConfigService } from './notification-config.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationController, NotificationConfigController],
  providers: [NotificationService, NotificationConfigService, EmailService],
})
export class NotificationsModule {}
```

- [ ] **Step 2: Add NotificationsModule to AppModule**

In `backend/src/app.module.ts`, add the import:

```typescript
import { NotificationsModule } from './modules/notifications/notifications.module';
```

Add `NotificationsModule` to the `imports` array after `DashboardModule`:

```typescript
    DashboardModule,
    NotificationsModule,
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Run the full test suite**

```bash
cd backend && npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/notifications/notifications.module.ts backend/src/app.module.ts
git commit -m "feat: wire NotificationsModule into AppModule"
```

---

### Task 11: Backend unit tests

**Files:**
- Create: `backend/src/modules/notifications/notification.service.spec.ts`

Context: 7 tests required by the spec, organized in three describe blocks:
1. `NotificationService` — tests 1–4
2. `EmailService` — tests 5–6
3. `NotificationConfigService` — test 7

The ConfigService mock returns `'a'.repeat(64)` (a valid 64-char hex string — `a` is a valid hex digit) as the encryption key.

- [ ] **Step 1: Write the test file**

```typescript
// backend/src/modules/notifications/notification.service.spec.ts
import { Test } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { EmailService } from './email.service';
import { NotificationConfigService } from './notification-config.service';
import { NotificationService } from './notification.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('nodemailer');

describe('NotificationService', () => {
  let service: NotificationService;
  let emailService: jest.Mocked<EmailService>;
  let configService: jest.Mocked<NotificationConfigService>;
  let prisma: any;

  beforeEach(async () => {
    emailService = { send: jest.fn().mockResolvedValue(undefined) } as any;
    configService = { isEventEnabled: jest.fn() } as any;
    prisma = {
      notification: { create: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn(), findMany: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get(NotificationService);
  });

  it('handleTicketAssigned: creates in-app notification and sends email when toggle is enabled', async () => {
    configService.isEventEnabled.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({ id: 'agent-1', email: 'agent@test.com' });

    await service.handleTicketAssigned({ ticketId: 'ticket-1', assignedToId: 'agent-1', title: 'Fix it' });

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'agent-1', ticketId: 'ticket-1' }),
      }),
    );
    expect(emailService.send).toHaveBeenCalledWith(
      'agent@test.com', expect.any(String), expect.any(String),
    );
  });

  it('handleTicketAssigned: does nothing when toggle is disabled', async () => {
    configService.isEventEnabled.mockResolvedValue(false);

    await service.handleTicketAssigned({ ticketId: 'ticket-1', assignedToId: 'agent-1', title: 'Fix it' });

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('handleTicketCommented: notifies creator and assignee, deduplicates when same user', async () => {
    configService.isEventEnabled.mockResolvedValue(true);
    // creator === assignee → Set deduplicates → findMany returns one user
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'user@test.com' }]);

    await service.handleTicketCommented({
      ticketId: 't1', commentId: 'c1', authorId: 'agent-1',
      title: 'Issue', creatorId: 'user-1', assignedToId: 'user-1',
    });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('handleSlaBreached: notifies assignee and all MANAGER-role users', async () => {
    configService.isEventEnabled.mockResolvedValue(true);
    prisma.user.findMany.mockResolvedValue([
      { id: 'mgr-1', email: 'mgr1@test.com' },
      { id: 'mgr-2', email: 'mgr2@test.com' },
    ]);
    prisma.user.findUnique.mockResolvedValue({ id: 'agent-1', email: 'agent@test.com' });

    await service.handleSlaBreached({ ticketId: 't1', assignedToId: 'agent-1', title: 'SLA' });

    // 2 managers + 1 assignee = 3 unique recipients
    expect(prisma.notification.create).toHaveBeenCalledTimes(3);
    expect(emailService.send).toHaveBeenCalledTimes(3);
  });
});

describe('EmailService', () => {
  let service: EmailService;
  let configService: jest.Mocked<NotificationConfigService>;

  beforeEach(async () => {
    configService = { getEmailConfig: jest.fn() } as any;
    const module = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: NotificationConfigService, useValue: configService },
      ],
    }).compile();
    service = module.get(EmailService);
  });

  it('calls Nodemailer sendMail when transport is SMTP', async () => {
    const mockSendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: mockSendMail });
    configService.getEmailConfig.mockResolvedValue({
      transport: 'SMTP',
      config: { host: 'smtp.test.com', port: 587, secure: false, user: 'u', pass: 'p', fromAddress: 'from@test.com' },
    });

    await service.send('to@test.com', 'Hello', 'World');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'to@test.com', subject: 'Hello' }),
    );
  });

  it('is a no-op and does not call Nodemailer when transport is NONE', async () => {
    const mockSendMail = jest.fn();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: mockSendMail });
    configService.getEmailConfig.mockResolvedValue({ transport: 'NONE', config: {} });

    await service.send('to@test.com', 'Hello', 'World');

    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('NotificationConfigService', () => {
  let service: NotificationConfigService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      appConfig: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        NotificationConfigService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('a'.repeat(64)) },
        },
      ],
    }).compile();

    service = module.get(NotificationConfigService);
  });

  it('encrypts SMTP credentials on save and decrypts them on load', async () => {
    let storedSmtp = '';
    prisma.appConfig.upsert.mockImplementation((args: any) => {
      if (args.where.key === 'notification.email.smtp') storedSmtp = args.create.value;
      return {};
    });

    await service.saveEmailConfig({
      transport: 'SMTP',
      host: 'smtp.test.com', port: 587, secure: false,
      user: 'testuser', pass: 'supersecret', fromAddress: 'from@test.com',
    });

    expect(storedSmtp).toBeTruthy();
    const parsed = JSON.parse(storedSmtp);
    expect(parsed.pass).not.toBe('supersecret'); // must be encrypted

    prisma.appConfig.findUnique.mockImplementation((args: any) => {
      if (args.where.key === 'notification.email.transport') return { value: 'SMTP' };
      if (args.where.key === 'notification.email.smtp') return { value: storedSmtp };
      return null;
    });

    const loaded = await service.getEmailConfig();
    expect(loaded.config.pass).toBe('supersecret'); // decrypted correctly
  });
});
```

- [ ] **Step 2: Run the spec**

```bash
cd backend && npx jest notification.service.spec --no-coverage
```

Expected: 7/7 PASS.

- [ ] **Step 3: Run the full test suite**

```bash
cd backend && npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/notifications/notification.service.spec.ts
git commit -m "test: add 7 backend unit tests for NotificationsModule"
```

---

### Task 12: Frontend — notification bell in layout.tsx

**Files:**
- Modify: `frontend/src/app/(app)/layout.tsx`

Context: The current layout has a sidebar + `<main>`. A top header bar is added wrapping `<main>` so the bell is visible on all pages. Layout becomes: sidebar + `<div flexCol>` → `<header>` (bell) + `<main>` (children). Token is at `(session as any)?.accessToken`. Bell fetches `GET /notifications?limit=5&unread=true` on mount. Clicking outside the dropdown closes it via `useRef` + `mousedown` listener.

- [ ] **Step 1: Replace layout.tsx**

```typescript
// frontend/src/app/(app)/layout.tsx
'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const BASE_NAV: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/tickets', label: 'Tickets' },
  { href: '/kb', label: 'Knowledge Base' },
];

const API = process.env.NEXT_PUBLIC_API_URL;

type Notification = {
  id: string;
  title: string;
  body: string;
  ticketId?: string;
  read: boolean;
  createdAt: string;
};

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const bellRef = useRef<HTMLDivElement>(null);

  const token = (session as any)?.accessToken;
  const role = (session?.user as any)?.role ?? '';
  const nav = ['ADMIN', 'MANAGER'].includes(role)
    ? [...BASE_NAV, { href: '/admin', label: 'Admin' }]
    : BASE_NAV;

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/login');
  }, [status, router]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/notifications?limit=5&unread=true`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => setNotifications(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!bellOpen) return;
    function handleOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [bellOpen]);

  async function markRead(notif: Notification) {
    if (!notif.read && token) {
      await fetch(`${API}/notifications/${notif.id}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    }
    setBellOpen(false);
    if (notif.ticketId) router.push(`/tickets/${notif.ticketId}`);
  }

  async function markAllRead() {
    if (!token) return;
    await fetch(`${API}/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    setNotifications([]);
  }

  const unreadCount = notifications.filter((n) => !n.read).length;
  const countLabel = unreadCount >= 5 ? '5+' : String(unreadCount);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' }}>
        Loading…
      </div>
    );
  }
  if (!session) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
      <nav style={{ width: 220, background: '#0f172a', color: '#94a3b8', display: 'flex', flexDirection: 'column', padding: '24px 0', flexShrink: 0 }}>
        <div style={{ padding: '0 20px 24px', borderBottom: '1px solid #1e293b' }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#f1f5f9' }}>Service Desk</span>
        </div>
        <ul style={{ listStyle: 'none', padding: '16px 0', margin: 0, flex: 1 }}>
          {nav.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                style={{
                  display: 'block',
                  padding: '10px 20px',
                  color: pathname.startsWith(href) ? '#f1f5f9' : '#94a3b8',
                  background: pathname.startsWith(href) ? '#1e293b' : 'transparent',
                  textDecoration: 'none',
                  fontSize: 14,
                  borderLeft: pathname.startsWith(href) ? '3px solid #3b82f6' : '3px solid transparent',
                }}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <div style={{ padding: '16px 20px', borderTop: '1px solid #1e293b' }}>
          <div style={{ fontSize: 13, marginBottom: 8, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.user?.email}
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/auth/login' })}
            style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13, width: '100%' }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <header style={{ height: 48, background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 24px', flexShrink: 0 }}>
          <div ref={bellRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setBellOpen((o) => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'relative', padding: 4 }}
              aria-label="Notifications"
            >
              <span style={{ fontSize: 20 }}>🔔</span>
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: -2, right: -2,
                  background: '#ef4444', color: '#fff',
                  borderRadius: '50%', width: 18, height: 18,
                  fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700,
                }}>
                  {countLabel}
                </span>
              )}
            </button>
            {bellOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 340, zIndex: 100,
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                  Notifications
                </div>
                {notifications.length === 0 ? (
                  <div style={{ padding: 16, color: '#64748b', fontSize: 14, textAlign: 'center' }}>
                    No unread notifications
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {notifications.slice(0, 5).map((n) => (
                      <li
                        key={n.id}
                        onClick={() => markRead(n)}
                        style={{
                          padding: '10px 16px', cursor: 'pointer',
                          borderBottom: '1px solid #f8fafc',
                          background: n.read ? '#fff' : '#f0f9ff',
                        }}
                      >
                        <div style={{ fontWeight: n.read ? 400 : 600, fontSize: 13, color: '#0f172a', marginBottom: 2 }}>
                          {n.title}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>
                          {n.body.length > 80 ? n.body.slice(0, 80) + '…' : n.body}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{relativeTime(n.createdAt)}</div>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    onClick={markAllRead}
                    style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 13, padding: 0 }}
                  >
                    Mark all read
                  </button>
                  <Link
                    href="/notifications"
                    onClick={() => setBellOpen(false)}
                    style={{ color: '#3b82f6', fontSize: 13, textDecoration: 'none' }}
                  >
                    View all →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </header>
        <main style={{ flex: 1, padding: 32, overflow: 'auto' }}>{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/(app)/layout.tsx
git commit -m "feat: add notification bell with unread badge and dropdown to app layout"
```

---

### Task 13: Frontend — notification inbox page

**Files:**
- Create: `frontend/src/app/(app)/notifications/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
// frontend/src/app/(app)/notifications/page.tsx
'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL;

type Notification = {
  id: string;
  title: string;
  body: string;
  ticketId?: string;
  read: boolean;
  createdAt: string;
};

export default function NotificationsPage() {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const token = (session as any)?.accessToken;

  async function load() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/notifications?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setNotifications(Array.isArray(data) ? data : []);
    } catch {
      // page stays empty
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [token]);

  async function markRead(id: string) {
    if (!token) return;
    await fetch(`${API}/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  async function markAllRead() {
    if (!token) return;
    await fetch(`${API}/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  if (loading) return <div style={{ color: '#64748b' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>Notifications</h1>
        <button
          onClick={markAllRead}
          style={{ background: 'none', border: '1px solid #e2e8f0', color: '#3b82f6', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
        >
          Mark all read
        </button>
      </div>
      {notifications.length === 0 ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 48 }}>No notifications yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {notifications.map((n) => (
            <li
              key={n.id}
              onClick={() => markRead(n.id)}
              style={{
                background: '#fff',
                borderRadius: 8,
                padding: '14px 16px',
                borderLeft: n.read ? '4px solid transparent' : '4px solid #3b82f6',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                cursor: 'pointer',
              }}
            >
              {n.ticketId ? (
                <Link
                  href={`/tickets/${n.ticketId}`}
                  style={{ textDecoration: 'none' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ fontWeight: n.read ? 400 : 600, fontSize: 14, color: '#0f172a', marginBottom: 4 }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>{n.body}</div>
                </Link>
              ) : (
                <>
                  <div style={{ fontWeight: n.read ? 400 : 600, fontSize: 14, color: '#0f172a', marginBottom: 4 }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>{n.body}</div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/(app)/notifications/page.tsx
git commit -m "feat: add notification inbox page at /notifications"
```

---

### Task 14: Frontend — admin notifications settings page

**Files:**
- Create: `frontend/src/app/(app)/admin/notifications/page.tsx`

Context: Two sections — Event Toggles (checkboxes + Save) and Email Delivery (radio SMTP/GRAPH/NONE, conditional fields, Save + Test). Password/secret fields use `type="password"`. Redacted values (`***`) show as placeholder hint. `handleSave()` captures form state before the async call to avoid stale closure issues.

- [ ] **Step 1: Create the page**

```typescript
// frontend/src/app/(app)/admin/notifications/page.tsx
'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL;

const EVENT_LABELS: Record<string, string> = {
  'notification.event.ticket_created': 'Ticket created — email confirmation to submitter',
  'notification.event.ticket_assigned': 'Ticket assigned — in-app + email to assignee',
  'notification.event.ticket_commented': 'New comment — in-app + email to participants',
  'notification.event.ticket_status_changed': 'Status changed — in-app + email to creator',
  'notification.event.sla_breach': 'SLA breached — in-app + email to assignee and managers',
};

export default function AdminNotificationsPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;

  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [toggleSaving, setToggleSaving] = useState(false);
  const [toggleMsg, setToggleMsg] = useState('');

  const [transport, setTransport] = useState<'SMTP' | 'GRAPH' | 'NONE'>('NONE');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  async function loadToggles() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/notifications/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setToggles(await res.json());
    } catch {}
  }

  async function loadEmailConfig() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/notifications/email-config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setTransport(data.transport ?? 'NONE');
      if (data.transport === 'SMTP' && data.config) {
        setSmtpHost(data.config.host ?? '');
        setSmtpPort(String(data.config.port ?? ''));
        setSmtpSecure(data.config.secure ?? false);
        setSmtpUser(data.config.user ?? '');
        setSmtpPass(data.config.pass ?? '');
        setFromAddress(data.config.fromAddress ?? '');
      } else if (data.transport === 'GRAPH' && data.config) {
        setTenantId(data.config.tenantId ?? '');
        setClientId(data.config.clientId ?? '');
        setClientSecret(data.config.clientSecret ?? '');
        setFromAddress(data.config.fromAddress ?? '');
      }
    } catch {}
  }

  useEffect(() => {
    loadToggles();
    loadEmailConfig();
  }, [token]);

  async function saveToggles() {
    if (!token) return;
    const toSave = toggles;
    setToggleSaving(true);
    setToggleMsg('');
    try {
      const res = await fetch(`${API}/notifications/config`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toggles: toSave }),
      });
      setToggleMsg(res.ok ? 'Saved.' : 'Error saving toggles.');
    } catch {
      setToggleMsg('Error saving toggles.');
    } finally {
      setToggleSaving(false);
    }
  }

  async function saveEmailConfig() {
    if (!token) return;
    const currentTransport = transport;
    const body: Record<string, unknown> = { transport: currentTransport };
    if (currentTransport === 'SMTP') {
      Object.assign(body, {
        host: smtpHost, port: parseInt(smtpPort, 10), secure: smtpSecure,
        user: smtpUser, pass: smtpPass, fromAddress,
      });
    } else if (currentTransport === 'GRAPH') {
      Object.assign(body, { tenantId, clientId, clientSecret, fromAddress });
    }
    setEmailSaving(true);
    setEmailMsg('');
    try {
      const res = await fetch(`${API}/notifications/email-config`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setEmailMsg(res.ok ? 'Email config saved.' : 'Error saving email config.');
    } catch {
      setEmailMsg('Error saving email config.');
    } finally {
      setEmailSaving(false);
    }
  }

  async function sendTestEmail() {
    if (!token) return;
    setTestLoading(true);
    setTestMsg('');
    try {
      const res = await fetch(`${API}/notifications/email-config/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestMsg(res.ok ? 'Test email sent.' : (data.message ?? 'Error sending test email.'));
    } catch {
      setTestMsg('Error sending test email.');
    } finally {
      setTestLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0',
    borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: '#475569', marginBottom: 4, display: 'block',
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Notifications</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>
        Configure outbound notification events and email delivery.
      </p>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 16, marginTop: 0 }}>Event Toggles</h2>
        {Object.entries(EVENT_LABELS).map(([key, label]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!toggles[key]}
              onChange={(e) => setToggles((prev) => ({ ...prev, [key]: e.target.checked }))}
              style={{ marginTop: 2 }}
            />
            <span style={{ fontSize: 14, color: '#334155' }}>{label}</span>
          </label>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button
            onClick={saveToggles}
            disabled={toggleSaving}
            style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14 }}
          >
            {toggleSaving ? 'Saving…' : 'Save'}
          </button>
          {toggleMsg && (
            <span style={{ fontSize: 13, color: toggleMsg.startsWith('Error') ? '#ef4444' : '#22c55e' }}>
              {toggleMsg}
            </span>
          )}
        </div>
      </section>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 16, marginTop: 0 }}>Email Delivery</h2>
        <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
          {(['NONE', 'SMTP', 'GRAPH'] as const).map((t) => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
              <input type="radio" name="transport" value={t} checked={transport === t} onChange={() => setTransport(t)} />
              {t === 'NONE' ? 'None (disabled)' : t === 'SMTP' ? 'SMTP' : 'Microsoft Graph'}
            </label>
          ))}
        </div>

        {transport === 'SMTP' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Host</label>
              <input style={inputStyle} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div>
              <label style={labelStyle}>Port</label>
              <input style={inputStyle} type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="secure" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
              <label htmlFor="secure" style={{ fontSize: 14, cursor: 'pointer' }}>Use TLS/SSL</label>
            </div>
            <div>
              <label style={labelStyle}>Username</label>
              <input style={inputStyle} value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input
                style={inputStyle}
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={smtpPass === '***' ? 'saved — enter to change' : ''}
              />
            </div>
            <div>
              <label style={labelStyle}>From Address</label>
              <input style={inputStyle} type="email" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="noreply@example.com" />
            </div>
          </div>
        )}

        {transport === 'GRAPH' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Tenant ID</label>
              <input style={inputStyle} value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Client ID</label>
              <input style={inputStyle} value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Client Secret</label>
              <input
                style={inputStyle}
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={clientSecret === '***' ? 'saved — enter to change' : ''}
              />
            </div>
            <div>
              <label style={labelStyle}>From Address</label>
              <input style={inputStyle} type="email" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="noreply@example.com" />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={saveEmailConfig}
            disabled={emailSaving}
            style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14 }}
          >
            {emailSaving ? 'Saving…' : 'Save Email Config'}
          </button>
          <button
            onClick={sendTestEmail}
            disabled={testLoading || transport === 'NONE'}
            style={{ background: '#fff', color: '#3b82f6', border: '1px solid #3b82f6', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14 }}
          >
            {testLoading ? 'Sending…' : 'Send Test Email'}
          </button>
          {emailMsg && (
            <span style={{ fontSize: 13, color: emailMsg.startsWith('Error') ? '#ef4444' : '#22c55e' }}>
              {emailMsg}
            </span>
          )}
          {testMsg && (
            <span style={{ fontSize: 13, color: testMsg.startsWith('Error') ? '#ef4444' : '#22c55e' }}>
              {testMsg}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/(app)/admin/notifications/page.tsx
git commit -m "feat: add admin notifications settings page with event toggles and email config"
```

---

### Task 15: Frontend — admin landing page 6th card

**Files:**
- Modify: `frontend/src/app/(app)/admin/page.tsx`

Current state: 5 cards, `repeat(5, 1fr)`, maxWidth 1400. Required: 6 cards, `repeat(6, 1fr)`, maxWidth 1600.

- [ ] **Step 1: Add the Notifications card and update grid**

Full replacement of `frontend/src/app/(app)/admin/page.tsx`:

```typescript
'use client';

import Link from 'next/link';

export default function AdminPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Admin</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>
        Configure routing rules, SLA policies, knowledge base articles, external connectors, dashboard defaults, and notifications.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 20, maxWidth: 1600 }}>
        <Link href="/admin/routing-rules" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Routing Rules</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Auto-assign tickets to agents or teams based on conditions.</div>
          </div>
        </Link>
        <Link href="/admin/sla-policies" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>SLA Policies</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Set response and resolution deadlines per priority level.</div>
          </div>
        </Link>
        <Link href="/admin/kb" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Knowledge Base</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Author and publish KB articles; track ticket deflection.</div>
          </div>
        </Link>
        <Link href="/admin/connectors" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Connectors</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Sync articles with SharePoint and Confluence.</div>
          </div>
        </Link>
        <Link href="/admin/dashboard-defaults" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Dashboard Defaults</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Set the default widget layout for each role.</div>
          </div>
        </Link>
        <Link href="/admin/notifications" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Notifications</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Configure outbound notification events and email delivery.</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/(app)/admin/page.tsx
git commit -m "feat: add Notifications card to admin landing (6 cards, repeat(6,1fr), maxWidth 1600)"
```

---

### Task 16: Frontend component tests

**Files:**
- Create: `frontend/src/app/(app)/notifications/page.test.tsx`
- Create: `frontend/src/app/(app)/admin/notifications/page.test.tsx`

- [ ] **Step 1: Create notification inbox tests**

```typescript
// frontend/src/app/(app)/notifications/page.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotificationsPage from './page';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' }, status: 'authenticated' }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

const mockNotifications = [
  { id: 'n1', title: 'Unread notification', body: 'Body text here', ticketId: 't1', read: false, createdAt: new Date().toISOString() },
  { id: 'n2', title: 'Read notification', body: 'Already read', ticketId: 't2', read: true, createdAt: new Date().toISOString() },
];

global.fetch = jest.fn();

describe('NotificationsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockNotifications,
    });
  });

  it('renders unread items with left accent border (#3b82f6)', async () => {
    render(<NotificationsPage />);
    await waitFor(() => screen.getByText('Unread notification'));
    const unreadItem = screen.getByText('Unread notification').closest('li');
    expect(unreadItem).toHaveStyle({ borderLeft: '4px solid #3b82f6' });
  });

  it('renders read items without accent border', async () => {
    render(<NotificationsPage />);
    await waitFor(() => screen.getByText('Read notification'));
    const readItem = screen.getByText('Read notification').closest('li');
    expect(readItem).toHaveStyle({ borderLeft: '4px solid transparent' });
  });

  it('fires PATCH on click to mark notification read', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

    render(<NotificationsPage />);
    await waitFor(() => screen.getByText('Unread notification'));

    fireEvent.click(screen.getByText('Unread notification').closest('li')!);

    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(
        calls.some((c: any[]) => String(c[0]).includes('/notifications/n1/read') && c[1]?.method === 'PATCH'),
      ).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Create admin notifications page tests**

```typescript
// frontend/src/app/(app)/admin/notifications/page.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import AdminNotificationsPage from './page';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' }, status: 'authenticated' }),
}));

global.fetch = jest.fn();

describe('AdminNotificationsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'notification.event.ticket_created': true,
          'notification.event.ticket_assigned': false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transport: 'SMTP',
          config: { host: 'smtp.test.com', port: 587, secure: false, user: 'u', pass: '***', fromAddress: 'from@test.com' },
        }),
      });
  });

  it('renders event toggle checkboxes from the GET /config response', async () => {
    render(<AdminNotificationsPage />);
    await waitFor(() => screen.getByText(/Ticket created/));
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
  });

  it('shows SMTP fields when transport is SMTP', async () => {
    render(<AdminNotificationsPage />);
    await waitFor(() => screen.getByDisplayValue('smtp.test.com'));
    expect(screen.getByPlaceholderText('smtp.example.com')).toBeInTheDocument();
  });

  it('does not show Graph fields when transport is SMTP', async () => {
    render(<AdminNotificationsPage />);
    await waitFor(() => screen.getByDisplayValue('smtp.test.com'));
    expect(screen.queryByText('Tenant ID')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the frontend notification tests**

```bash
cd frontend && npx jest notifications --no-coverage
```

Expected: 6/6 PASS.

- [ ] **Step 4: Run the full frontend test suite**

```bash
cd frontend && npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/(app)/notifications/page.test.tsx frontend/src/app/(app)/admin/notifications/page.test.tsx
git commit -m "test: add frontend component tests for notifications inbox and admin page"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| Notification Prisma model with @@index([userId]) | Task 1 |
| User.notifications relation | Task 1 |
| 5 AppConfig event toggle keys | Task 5 |
| AppConfig smtp/graph/transport keys + encryption | Task 5 |
| ticket.assigned event payload | Task 2 |
| ticket.commented event payload | Task 2 |
| ticket.status_changed (all statuses except RESOLVED) | Task 2 |
| ticket.resolved event payload | Task 2 |
| sla.breached event (emitted after transaction) | Task 3 |
| @OnEvent handlers for all 6 events | Task 7 |
| handleTicketResolved uses ticket_status_changed toggle | Task 7 |
| Deduplication in handleTicketCommented | Task 7 |
| MANAGER + assignee dedup in handleSlaBreached | Task 7 |
| Email send failure does not prevent in-app notification | Task 7 (catch in notify()) |
| NotificationController GET /notifications (limit, unread params) | Task 8 |
| NotificationController PATCH /notifications/read-all (before :id) | Task 8 |
| NotificationController PATCH /notifications/:id/read | Task 8 |
| updateMany with userId guard in markRead | Task 8 |
| NotificationConfigController GET /config (ADMIN) | Task 9 |
| NotificationConfigController PUT /config (ADMIN) | Task 9 |
| NotificationConfigController GET /email-config redacted | Task 9 |
| NotificationConfigController PUT /email-config | Task 9 |
| NotificationConfigController POST /email-config/test | Task 9 |
| 400 when test email sent with no transport | Task 9 |
| Nodemailer SMTP transport | Task 6 |
| Microsoft Graph REST transport | Task 6 |
| EmailService no-op when NONE | Task 6 |
| EmailService no-op on config load failure | Task 6 |
| Backend unit tests (7 required tests) | Task 11 |
| Sidebar bell with unread count badge | Task 12 |
| Bell dropdown (5 items, body truncated to 80 chars) | Task 12 |
| Click item: mark read + navigate to ticket | Task 12 |
| "Mark all read" + "View all →" in dropdown footer | Task 12 |
| Bell fails silently (GET fails → no badge, no crash) | Task 12 (catch → {}) |
| Notification inbox page, newest-first, unread accent border | Task 13 |
| Inbox "Mark all read" button | Task 13 |
| Inbox empty state "No notifications yet." | Task 13 |
| Admin notifications page — event toggle checkboxes | Task 14 |
| Admin notifications page — SMTP/GRAPH/NONE radio | Task 14 |
| Conditional form fields (SMTP vs Graph) | Task 14 |
| Redacted password/secret placeholder | Task 14 |
| "Save" + inline message for toggles | Task 14 |
| "Save Email Config" + "Send Test Email" buttons | Task 14 |
| Admin landing 6th card, repeat(6,1fr), maxWidth 1600 | Task 15 |
| Frontend component tests (4 required) | Task 16 |

All spec requirements covered.

### Placeholder scan

No TBDs, TODOs, or incomplete stubs found.

### Type consistency

- `TicketAssignedPayload.ticketId` consistent in Tasks 2 and 7
- `Notification` frontend type consistent across Tasks 12 and 13
- `NOTIFICATION_EVENT_KEYS` exported from Task 5, used for filtering in `updateEventToggles`
- `UpdateEmailConfigDto` used identically in Tasks 5 (service) and 9 (controller)
- `@Roles(Role.ADMIN)` decorator path assumed to be `../auth/decorators/roles.decorator` — Task 9 Step 2 instructs implementer to verify

### Ambiguity resolved

- `ticket.resolved` uses `notification.event.ticket_status_changed` toggle — there are only 5 toggle keys; no separate resolved key exists in the spec
- `PATCH /read-all` declared before `PATCH /:id/read` in NotificationController — noted in Task 8
- `handleTicketCreated` receives full Prisma ticket object (not typed class) because `TicketsService` emits the raw DB result — noted in Task 7 context
