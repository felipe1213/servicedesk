# Phase 5c — Inbound Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert inbound emails at a shared mailbox into tickets (or reply comments), with admin-configurable IMAP/Graph transport and ANYONE/DOMAINS/USERS access control.

**Architecture:** A new `InboundEmailModule` runs a `@Cron('* * * * *')` poller using `@nestjs/schedule` (already registered in AppModule). Each tick it reads the configured transport from `AppConfig`, fetches unseen/unread messages via IMAP (`imapflow` + `mailparser`) or Microsoft Graph (same client-credentials OAuth as `EmailService`), normalizes them into `InboundMessage`, and calls `processMessage()`. That function enforces access control, detects reply threads via `[#ticketNumber]` in the subject, creates tickets or comments, saves attachments, and fires `TicketCreatedEvent` automatically via `TicketsService.create()`. Ticket numbers added to outbound email subjects in Phase 5b's `NotificationService`.

**Tech Stack:** NestJS 10, Prisma, `imapflow` (IMAP), `mailparser` (raw RFC 2822 parsing), `fetch` + client-credentials OAuth (Graph), `@nestjs/schedule` (already installed), AES-256-GCM via `CONNECTOR_ENCRYPTION_KEY` (same as `NotificationConfigService`).

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `backend/prisma/schema.prisma` | Add `ticketNumber Int @default(autoincrement()) @unique` to Ticket |
| Modify | `backend/src/modules/attachments/attachments.service.ts` | Add `uploadBuffer()` for raw Buffer uploads |
| Modify | `backend/src/modules/tickets/tickets.service.ts` | Add `ticketNumber` to event payloads |
| Modify | `backend/src/modules/sla/sla.service.ts` | Add `ticketNumber` to `sla.breached` payload |
| Modify | `backend/src/modules/notifications/notification.service.ts` | Add `ticketNumber` to payload types; add `[#N]` to all email subjects |
| Create | `backend/src/modules/inbound-email/dto/update-inbound-config.dto.ts` | Two DTOs: transport + access |
| Create | `backend/src/modules/inbound-email/inbound-email-config.service.ts` | AppConfig read/write with AES-256-GCM |
| Create | `backend/src/modules/inbound-email/inbound-email-config.controller.ts` | 5 admin-only endpoints |
| Create | `backend/src/modules/inbound-email/inbound-email.service.ts` | Cron poller + processMessage |
| Create | `backend/src/modules/inbound-email/inbound-email.module.ts` | Module wiring |
| Modify | `backend/src/app.module.ts` | Register InboundEmailModule |
| Create | `backend/src/modules/inbound-email/inbound-email.service.spec.ts` | Unit tests |
| Create | `frontend/src/app/(app)/admin/inbound-email/page.tsx` | Admin config page |
| Modify | `frontend/src/app/(app)/admin/page.tsx` | Add 7th card |

---

## Task 1: Add `ticketNumber` to Ticket (Prisma migration)

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add `ticketNumber` field to the Ticket model**

Open `backend/prisma/schema.prisma`. In the `model Ticket` block, add this line **before** `createdAt`:

```prisma
ticketNumber       Int          @default(autoincrement()) @unique
```

The Ticket model block should now contain:
```prisma
model Ticket {
  id                 String       @id @default(cuid())
  title              String
  description        String
  status             TicketStatus @default(NEW)
  priority           Priority     @default(MEDIUM)
  category           String?
  sourceChannel      Channel
  createdById        String
  createdBy          User         @relation("CreatedBy", fields: [createdById], references: [id])
  assignedToId       String?
  assignedTo         User?        @relation("AssignedTo", fields: [assignedToId], references: [id])
  teamId             String?
  team               Team?        @relation(fields: [teamId], references: [id])
  comments           Comment[]
  auditLogs          AuditLog[]
  attachments        Attachment[]
  deflections        KbDeflection[]
  slaPolicyId        String?
  slaPolicy          SlaPolicy?   @relation(fields: [slaPolicyId], references: [id])
  slaBreached        Boolean      @default(false)
  responseDeadline   DateTime?
  resolutionDeadline DateTime?
  ticketNumber       Int          @default(autoincrement()) @unique
  createdAt          DateTime     @default(now())
  updatedAt          DateTime     @updatedAt

  @@index([createdById])
  @@index([assignedToId])
  @@index([status, priority])
  @@index([teamId])
}
```

- [ ] **Step 2: Create and run the migration**

```bash
cd backend
npx prisma migrate dev --name add_ticket_number
```

Expected: Migration created and applied. The `Ticket` table now has a `ticketNumber` column.

- [ ] **Step 3: Verify the Prisma client is regenerated**

```bash
npx prisma generate
```

Expected: `@prisma/client` regenerated — no TypeScript errors on `ticket.ticketNumber`.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add ticketNumber auto-increment field to Ticket"
```

---

## Task 2: Add `uploadBuffer` to AttachmentsService

**Files:**
- Modify: `backend/src/modules/attachments/attachments.service.ts`

**Context:** `AttachmentsService.upload()` requires `Express.Multer.File`. Email attachments arrive as raw `Buffer`. Add a companion method that accepts Buffer directly, bypassing the Multer type requirement. It stores the file in MinIO and creates an `Attachment` record — same logic as `upload()`.

- [ ] **Step 1: Write the failing test in a new test file**

Create `backend/src/modules/attachments/attachments.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AttachmentsService } from './attachments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MINIO_CLIENT } from './attachments.constants';

describe('AttachmentsService.uploadBuffer', () => {
  let service: AttachmentsService;
  let minio: any;
  let prisma: any;

  beforeEach(async () => {
    minio = { putObject: jest.fn().mockResolvedValue(undefined) };
    prisma = { attachment: { create: jest.fn().mockResolvedValue({ id: 'att-1' }) } };

    const module = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MINIO_CLIENT, useValue: minio },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('servicedesk-attachments') } },
      ],
    }).compile();

    service = module.get(AttachmentsService);
  });

  it('uploadBuffer: stores file in MinIO and creates Attachment record', async () => {
    const buf = Buffer.from('hello');
    await service.uploadBuffer('ticket-1', 'user-1', 'test.txt', 'text/plain', buf);

    expect(minio.putObject).toHaveBeenCalledWith(
      'servicedesk-attachments',
      expect.stringContaining('tickets/ticket-1/'),
      buf,
      5,
      { 'Content-Type': 'text/plain' },
    );
    expect(prisma.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: 'ticket-1',
        uploadedById: 'user-1',
        filename: 'test.txt',
        mimeType: 'text/plain',
      }),
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend
npx jest attachments.service.spec.ts --no-coverage
```

Expected: FAIL — `uploadBuffer is not a function`

- [ ] **Step 3: Add `uploadBuffer` to `AttachmentsService`**

Open `backend/src/modules/attachments/attachments.service.ts`. After the existing `upload()` method, add:

```typescript
async uploadBuffer(
  ticketId: string,
  userId: string,
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<void> {
  const key = `tickets/${ticketId}/${crypto.randomUUID()}-${filename}`;
  await this.minio.putObject(this.bucket, key, buffer, buffer.length, { 'Content-Type': mimeType });
  await this.prisma.attachment.create({
    data: { ticketId, filename, mimeType, storagePath: key, uploadedById: userId },
  });
}
```

**Check:** The existing `upload()` method already uses `crypto.randomUUID()` — verify the file already has `import * as crypto from 'crypto'` or that `crypto` is available globally. If not, add `import * as crypto from 'crypto';` at the top of the file.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest attachments.service.spec.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Run full backend test suite to check for regressions**

```bash
npx jest --no-coverage
```

Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/attachments/attachments.service.ts backend/src/modules/attachments/attachments.service.spec.ts
git commit -m "feat: add uploadBuffer method to AttachmentsService for raw Buffer uploads"
```

---

## Task 3: Add `[#ticketNumber]` to outbound email subjects

**Files:**
- Modify: `backend/src/modules/tickets/tickets.service.ts`
- Modify: `backend/src/modules/sla/sla.service.ts`
- Modify: `backend/src/modules/notifications/notification.service.ts`

**Context:** For reply threading to work, outbound notification emails must include `[#123]` in their subjects. This requires: (1) adding `ticketNumber` to every event payload in `TicketsService` and `SlaService`, (2) updating the payload types in `NotificationService`, (3) using `ticketNumber` in every email subject string.

After the Prisma migration in Task 1, all `Ticket` objects returned by Prisma automatically include `ticketNumber` (it's a scalar field, always selected unless using `select`).

- [ ] **Step 1: Update `TicketsService` event emissions to include `ticketNumber`**

Open `backend/src/modules/tickets/tickets.service.ts`.

**Change 1** — `ticket.resolved` emission (around line 132):
```typescript
this.eventEmitter.emit('ticket.resolved', {
  ticketId: id,
  ticketNumber: updated.ticketNumber,
  title: updated.title,
  creatorId: ticket.createdById,
});
```

**Change 2** — `ticket.status_changed` emission (around line 138):
```typescript
this.eventEmitter.emit('ticket.status_changed', {
  ticketId: id,
  ticketNumber: updated.ticketNumber,
  status: effectiveNewStatus,
  title: updated.title,
  creatorId: ticket.createdById,
  assignedToId: updated.assignedToId,
});
```

**Change 3** — `ticket.assigned` emission (around line 157):
```typescript
this.eventEmitter.emit('ticket.assigned', {
  ticketId: id,
  ticketNumber: updated.ticketNumber,
  assignedToId: dto.assignedToId,
  title: updated.title,
});
```

**Change 4** — `ticket.commented` emission in `addComment()` (around line 180):
```typescript
this.eventEmitter.emit('ticket.commented', {
  ticketId,
  ticketNumber: ticket.ticketNumber,
  commentId: comment.id,
  authorId: user.id,
  title: ticket.title,
  creatorId: ticket.createdById,
  assignedToId: ticket.assignedToId,
});
```

- [ ] **Step 2: Update `SlaService` sla.breached emission**

Open `backend/src/modules/sla/sla.service.ts`. Find the `this.eventEmitter.emit('sla.breached', ...)` call (around line 121). Update it to:

```typescript
this.eventEmitter.emit('sla.breached', {
  ticketId: ticket.id,
  ticketNumber: ticket.ticketNumber,
  assignedToId: effectiveAssignedToId,
  title: ticket.title,
});
```

Note: `ticket` is fetched by `findMany` with no `select`, so `ticket.ticketNumber` is available.

- [ ] **Step 3: Update payload types and email subjects in `NotificationService`**

Open `backend/src/modules/notifications/notification.service.ts`. Replace the payload type declarations and update each handler's email subject as follows.

**Updated payload types** (replace the existing type block at the top):

```typescript
type TicketCreatedPayload = {
  id: string;
  ticketNumber: number;
  title: string;
  createdById: string;
  createdBy: { id: string; name: string; email: string };
};
type TicketAssignedPayload = { ticketId: string; ticketNumber: number; assignedToId: string; title: string };
type TicketCommentedPayload = {
  ticketId: string; ticketNumber: number; commentId: string; authorId: string;
  title: string; creatorId: string; assignedToId: string | null;
};
type TicketStatusChangedPayload = {
  ticketId: string; ticketNumber: number; status: string; title: string;
  creatorId: string; assignedToId: string | null;
};
type TicketResolvedPayload = { ticketId: string; ticketNumber: number; title: string; creatorId: string };
type SlaBreachedPayload = { ticketId: string; ticketNumber: number; assignedToId: string | null; title: string };
```

**Updated `notify()` call sites** — change each `title` argument to include the ticket number:

In `handleTicketCreated`:
```typescript
const title = `[#${event.ticketNumber}] Ticket created: ${event.title}`;
```

In `handleTicketAssigned`:
```typescript
const title = `[#${event.ticketNumber}] Ticket assigned to you: ${event.title}`;
```

In `handleTicketCommented`:
```typescript
const title = `[#${event.ticketNumber}] New comment on: ${event.title}`;
```

In `handleStatusChanged`:
```typescript
const title = `[#${event.ticketNumber}] Ticket status updated: ${event.title}`;
```

In `handleTicketResolved`:
```typescript
const title = `[#${event.ticketNumber}] Ticket resolved: ${event.title}`;
```

In `handleSlaBreached`:
```typescript
const title = `[#${event.ticketNumber}] SLA breached: ${event.title}`;
```

- [ ] **Step 4: Run full backend tests**

```bash
cd backend
npx jest --no-coverage
```

Expected: All tests pass. The existing `notification.service.spec.ts` tests pass `ticketNumber` in the payload — if they fail with "received 0 calls", add `ticketNumber: 1` to any payload objects in the test assertions.

Fix any test failures by adding `ticketNumber: 1` to the mock event objects in `notification.service.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tickets/tickets.service.ts \
        backend/src/modules/sla/sla.service.ts \
        backend/src/modules/notifications/notification.service.ts
git commit -m "feat: add ticketNumber to event payloads and [#N] prefix to email subjects"
```

---

## Task 4: DTOs

**Files:**
- Create: `backend/src/modules/inbound-email/dto/update-inbound-config.dto.ts`

- [ ] **Step 1: Create the DTO file**

```bash
mkdir -p backend/src/modules/inbound-email/dto
```

Create `backend/src/modules/inbound-email/dto/update-inbound-config.dto.ts`:

```typescript
import { IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateInboundTransportDto {
  @IsEnum(['IMAP', 'GRAPH', 'NONE'])
  transport!: 'IMAP' | 'GRAPH' | 'NONE';

  // IMAP fields — required when transport = IMAP
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() secure?: boolean;
  @IsOptional() @IsString() user?: string;
  @IsOptional() @IsString() pass?: string;
  @IsOptional() @IsString() mailbox?: string;

  // Graph fields — required when transport = GRAPH
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
  @IsOptional() @IsEmail() mailboxAddress?: string;
}

export class UpdateInboundAccessDto {
  @IsEnum(['ANYONE', 'DOMAINS', 'USERS'])
  mode!: 'ANYONE' | 'DOMAINS' | 'USERS';

  @IsOptional() @IsArray() @IsString({ each: true }) list?: string[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/inbound-email/dto/update-inbound-config.dto.ts
git commit -m "feat: add UpdateInboundTransportDto and UpdateInboundAccessDto"
```

---

## Task 5: `InboundEmailConfigService`

**Files:**
- Create: `backend/src/modules/inbound-email/inbound-email-config.service.ts`

**Context:** Identical AES-256-GCM pattern as `NotificationConfigService`. Manages five `AppConfig` keys: `email.inbound.transport`, `email.inbound.imap`, `email.inbound.graph`, `email.inbound.access.mode`, `email.inbound.access.list`. Validate-before-write pattern: check all required fields before any DB upsert.

- [ ] **Step 1: Create the service**

Create `backend/src/modules/inbound-email/inbound-email-config.service.ts`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateInboundTransportDto, UpdateInboundAccessDto } from './dto/update-inbound-config.dto';

@Injectable()
export class InboundEmailConfigService {
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
    const parts = stored.split(':');
    if (parts.length !== 3) throw new Error('Malformed ciphertext — expected iv:authTag:ciphertext');
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }

  async getConfig(): Promise<{ transport: 'IMAP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> }> {
    const transportRecord = await this.prisma.appConfig.findUnique({
      where: { key: 'email.inbound.transport' },
    });
    const transport = (transportRecord?.value as 'IMAP' | 'GRAPH' | 'NONE') ?? 'NONE';
    if (transport === 'NONE' || !transportRecord) return { transport: 'NONE', config: {} };

    const configKey = transport === 'IMAP' ? 'email.inbound.imap' : 'email.inbound.graph';
    const configRecord = await this.prisma.appConfig.findUnique({ where: { key: configKey } });
    if (!configRecord) return { transport, config: {} };

    try {
      const raw = JSON.parse(configRecord.value) as Record<string, unknown>;
      if (transport === 'IMAP') {
        return { transport, config: { ...raw, pass: this.decrypt(raw.pass as string) } };
      }
      return { transport, config: { ...raw, clientSecret: this.decrypt(raw.clientSecret as string) } };
    } catch {
      return { transport, config: {} };
    }
  }

  async getRedactedConfig(): Promise<{ transport: 'IMAP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> }> {
    const { transport, config } = await this.getConfig();
    if (transport === 'IMAP' && config.pass) return { transport, config: { ...config, pass: '***' } };
    if (transport === 'GRAPH' && config.clientSecret) return { transport, config: { ...config, clientSecret: '***' } };
    return { transport, config };
  }

  async saveConfig(dto: UpdateInboundTransportDto): Promise<void> {
    const { transport } = dto;

    if (transport === 'IMAP') {
      if (!dto.host || !dto.port || dto.secure === undefined || !dto.user || !dto.pass) {
        throw new BadRequestException('IMAP transport requires host, port, secure, user, and pass');
      }
      const toStore = {
        host: dto.host,
        port: dto.port,
        secure: dto.secure,
        user: dto.user,
        pass: this.encrypt(dto.pass),
        mailbox: dto.mailbox ?? 'INBOX',
      };
      await this.prisma.appConfig.upsert({
        where: { key: 'email.inbound.transport' },
        create: { key: 'email.inbound.transport', value: transport },
        update: { value: transport },
      });
      await this.prisma.appConfig.upsert({
        where: { key: 'email.inbound.imap' },
        create: { key: 'email.inbound.imap', value: JSON.stringify(toStore) },
        update: { value: JSON.stringify(toStore) },
      });
    } else if (transport === 'GRAPH') {
      if (!dto.tenantId || !dto.clientId || !dto.clientSecret || !dto.mailboxAddress) {
        throw new BadRequestException('Graph transport requires tenantId, clientId, clientSecret, and mailboxAddress');
      }
      const toStore = {
        tenantId: dto.tenantId,
        clientId: dto.clientId,
        clientSecret: this.encrypt(dto.clientSecret),
        mailboxAddress: dto.mailboxAddress,
      };
      await this.prisma.appConfig.upsert({
        where: { key: 'email.inbound.transport' },
        create: { key: 'email.inbound.transport', value: transport },
        update: { value: transport },
      });
      await this.prisma.appConfig.upsert({
        where: { key: 'email.inbound.graph' },
        create: { key: 'email.inbound.graph', value: JSON.stringify(toStore) },
        update: { value: JSON.stringify(toStore) },
      });
    } else {
      await this.prisma.appConfig.upsert({
        where: { key: 'email.inbound.transport' },
        create: { key: 'email.inbound.transport', value: 'NONE' },
        update: { value: 'NONE' },
      });
    }
  }

  async getAccessControl(): Promise<{ mode: 'ANYONE' | 'DOMAINS' | 'USERS'; list: string[] }> {
    const modeRecord = await this.prisma.appConfig.findUnique({ where: { key: 'email.inbound.access.mode' } });
    const mode = (modeRecord?.value as 'ANYONE' | 'DOMAINS' | 'USERS') ?? 'ANYONE';
    const listRecord = await this.prisma.appConfig.findUnique({ where: { key: 'email.inbound.access.list' } });
    const list: string[] = listRecord ? (JSON.parse(listRecord.value) as string[]) : [];
    return { mode, list };
  }

  async saveAccessControl(dto: UpdateInboundAccessDto): Promise<void> {
    await this.prisma.appConfig.upsert({
      where: { key: 'email.inbound.access.mode' },
      create: { key: 'email.inbound.access.mode', value: dto.mode },
      update: { value: dto.mode },
    });
    await this.prisma.appConfig.upsert({
      where: { key: 'email.inbound.access.list' },
      create: { key: 'email.inbound.access.list', value: JSON.stringify(dto.list ?? []) },
      update: { value: JSON.stringify(dto.list ?? []) },
    });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/inbound-email/inbound-email-config.service.ts
git commit -m "feat: add InboundEmailConfigService with AES-256-GCM credential storage"
```

---

## Task 6: `InboundEmailConfigController`

**Files:**
- Create: `backend/src/modules/inbound-email/inbound-email-config.controller.ts`

**Context:** All 5 endpoints require `@Roles(Role.ADMIN)`. The POST `/inbound-email/test` triggers a single poll — it calls `InboundEmailService.pollOnce()` which is defined in Task 7.

- [ ] **Step 1: Create the controller**

Create `backend/src/modules/inbound-email/inbound-email-config.controller.ts`:

```typescript
import { BadRequestException, Body, Controller, Get, Post, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { InboundEmailConfigService } from './inbound-email-config.service';
import { InboundEmailService } from './inbound-email.service';
import { UpdateInboundTransportDto, UpdateInboundAccessDto } from './dto/update-inbound-config.dto';

@Controller('inbound-email')
export class InboundEmailConfigController {
  constructor(
    private readonly configService: InboundEmailConfigService,
    private readonly inboundEmailService: InboundEmailService,
  ) {}

  @Get('config')
  @Roles(Role.ADMIN)
  getConfig() {
    return this.configService.getRedactedConfig();
  }

  @Put('config')
  @Roles(Role.ADMIN)
  saveConfig(@Body() dto: UpdateInboundTransportDto) {
    return this.configService.saveConfig(dto);
  }

  @Get('access')
  @Roles(Role.ADMIN)
  getAccess() {
    return this.configService.getAccessControl();
  }

  @Put('access')
  @Roles(Role.ADMIN)
  saveAccess(@Body() dto: UpdateInboundAccessDto) {
    return this.configService.saveAccessControl(dto);
  }

  @Post('test')
  @Roles(Role.ADMIN)
  async testPoll() {
    const { transport } = await this.configService.getConfig();
    if (transport === 'NONE') {
      throw new BadRequestException('Inbound email transport not configured');
    }
    return this.inboundEmailService.pollOnce();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: No errors. (Ignore "InboundEmailService not found" — it's in the next task.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/inbound-email/inbound-email-config.controller.ts
git commit -m "feat: add InboundEmailConfigController with 5 admin endpoints"
```

---

## Task 7: `InboundEmailService`

**Files:**
- Create: `backend/src/modules/inbound-email/inbound-email.service.ts`

**Context:** Install `imapflow` and `mailparser` first. The service has three public methods: `scheduledPoll()` (cron), `pollOnce()` (called by controller), `processMessage()` (tested in unit tests). IMAP uses `imapflow` to connect, search UNSEEN messages, and mark SEEN after processing. Graph uses `fetch` + client-credentials OAuth, fetches `isRead eq false`, marks read via PATCH. Both normalize to `InboundMessage` before calling `processMessage()`. All errors are caught and logged; exceptions never propagate.

- [ ] **Step 1: Install new npm dependencies**

```bash
cd backend
npm install imapflow mailparser
npm install --save-dev @types/mailparser
```

Expected: `imapflow` and `mailparser` added to `package.json`.

- [ ] **Step 2: Create the service**

Create `backend/src/modules/inbound-email/inbound-email.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthProvider, Channel, Priority, Role } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { InboundEmailConfigService } from './inbound-email-config.service';

interface InboundMessage {
  externalId: string;
  from: string;
  fromName: string;
  subject: string;
  body: string;
  attachments: Array<{ filename: string; contentType: string; data: Buffer }>;
}

@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsService: TicketsService,
    private readonly attachmentsService: AttachmentsService,
    private readonly configService: InboundEmailConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron('* * * * *')
  async scheduledPoll(): Promise<void> {
    try {
      await this.pollOnce();
    } catch (err) {
      this.logger.error('Scheduled email poll failed', err);
    }
  }

  async pollOnce(): Promise<{ processed: number }> {
    const { transport } = await this.configService.getConfig();
    if (transport === 'IMAP') return { processed: await this.pollImap() };
    if (transport === 'GRAPH') return { processed: await this.pollGraph() };
    return { processed: 0 };
  }

  private async pollImap(): Promise<number> {
    const { config } = await this.configService.getConfig();
    const cfg = config as { host: string; port: number; secure: boolean; user: string; pass: string; mailbox: string };

    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      logger: false,
    });

    let processed = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock(cfg.mailbox || 'INBOX');
      try {
        const uids = await client.search({ seen: false }, { uid: true });
        if (uids.length === 0) return 0;

        for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
          try {
            const parsed = await simpleParser(msg.source as Buffer);
            const from = (parsed.from?.value?.[0]?.address ?? '') as string;
            const fromName = (parsed.from?.value?.[0]?.name ?? from) as string;
            const attachments = (parsed.attachments ?? [])
              .filter((a) => a.content)
              .map((a) => ({
                filename: a.filename ?? 'attachment',
                contentType: a.contentType ?? 'application/octet-stream',
                data: a.content,
              }));

            await this.processMessage({
              externalId: String(msg.uid),
              from,
              fromName,
              subject: parsed.subject ?? '(no subject)',
              body: parsed.text ?? parsed.html ?? '(no body)',
              attachments,
            });

            await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true });
            processed++;
          } catch (err) {
            this.logger.error(`Failed to process IMAP message uid=${msg.uid}`, err);
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return processed;
  }

  private async pollGraph(): Promise<number> {
    const { config } = await this.configService.getConfig();
    const cfg = config as { tenantId: string; clientId: string; clientSecret: string; mailboxAddress: string };

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
      },
    );
    if (!tokenRes.ok) {
      this.logger.error(`Graph token request failed (${tokenRes.status}): ${await tokenRes.text()}`);
      return 0;
    }
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) {
      this.logger.error('Graph token response missing access_token');
      return 0;
    }

    const listRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${cfg.mailboxAddress}/messages?$filter=isRead eq false&$top=50&$select=id,from,subject,body,hasAttachments`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    if (!listRes.ok) {
      this.logger.error(`Graph messages fetch failed (${listRes.status}): ${await listRes.text()}`);
      return 0;
    }
    const { value: messages } = (await listRes.json()) as { value: any[] };

    let processed = 0;
    for (const msg of messages) {
      try {
        let attachments: InboundMessage['attachments'] = [];
        if (msg.hasAttachments) {
          const attRes = await fetch(
            `https://graph.microsoft.com/v1.0/users/${cfg.mailboxAddress}/messages/${msg.id}/attachments`,
            { headers: { Authorization: `Bearer ${access_token}` } },
          );
          if (attRes.ok) {
            const { value } = (await attRes.json()) as { value: any[] };
            attachments = value
              .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes)
              .map((a) => ({
                filename: a.name ?? 'attachment',
                contentType: a.contentType ?? 'application/octet-stream',
                data: Buffer.from(a.contentBytes as string, 'base64'),
              }));
          }
        }

        await this.processMessage({
          externalId: msg.id as string,
          from: (msg.from?.emailAddress?.address ?? '') as string,
          fromName: (msg.from?.emailAddress?.name ?? msg.from?.emailAddress?.address ?? '') as string,
          subject: (msg.subject ?? '(no subject)') as string,
          body: (msg.body?.content ?? '(no body)') as string,
          attachments,
        });

        await fetch(
          `https://graph.microsoft.com/v1.0/users/${cfg.mailboxAddress}/messages/${msg.id}`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ isRead: true }),
          },
        );
        processed++;
      } catch (err) {
        this.logger.error(`Failed to process Graph message id=${msg.id}`, err);
      }
    }
    return processed;
  }

  async processMessage(msg: InboundMessage): Promise<void> {
    if (!msg.from) return;

    // 1. Access control
    const { mode, list } = await this.configService.getAccessControl();
    const domain = msg.from.split('@')[1]?.toLowerCase() ?? '';
    if (mode === 'DOMAINS' && !list.map((d) => d.toLowerCase()).includes(domain)) return;
    if (mode === 'USERS' && !list.map((e) => e.toLowerCase()).includes(msg.from.toLowerCase())) return;

    // 2. Reply threading — look for [#123] in subject
    const match = /\[#(\d+)\]/.exec(msg.subject);
    if (match) {
      const ticketNumber = parseInt(match[1], 10);
      const ticket = await this.prisma.ticket.findUnique({ where: { ticketNumber } });
      if (ticket) {
        const user = await this.findOrCreateUser(msg.from, msg.fromName, mode);
        if (!user) return;

        const comment = await this.prisma.comment.create({
          data: {
            ticketId: ticket.id,
            authorId: user.id,
            body: msg.body || '(no body)',
            isInternal: false,
          },
        });

        this.eventEmitter.emit('ticket.commented', {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          commentId: comment.id,
          authorId: user.id,
          title: ticket.title,
          creatorId: ticket.createdById,
          assignedToId: ticket.assignedToId,
        });

        for (const att of msg.attachments) {
          await this.attachmentsService
            .uploadBuffer(ticket.id, user.id, att.filename, att.contentType, att.data)
            .catch((err) => this.logger.warn(`Attachment upload failed: ${att.filename}`, err));
        }
        return;
      }
    }

    // 3. New ticket
    const user = await this.findOrCreateUser(msg.from, msg.fromName, mode);
    if (!user) return;

    const ticket = await this.ticketsService.create(
      {
        title: msg.subject || '(no subject)',
        description: msg.body || '(no body)',
        sourceChannel: Channel.EMAIL,
        priority: Priority.MEDIUM,
      },
      user.id,
    );

    for (const att of msg.attachments) {
      await this.attachmentsService
        .uploadBuffer(ticket.id, user.id, att.filename, att.contentType, att.data)
        .catch((err) => this.logger.warn(`Attachment upload failed: ${att.filename}`, err));
    }
  }

  private async findOrCreateUser(
    email: string,
    name: string,
    mode: string,
  ): Promise<{ id: string } | null> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing;

    if (mode === 'USERS') return null;

    try {
      return await this.prisma.user.create({
        data: {
          email,
          name: name || email,
          role: Role.END_USER,
          authProvider: AuthProvider.LOCAL,
        },
      });
    } catch {
      // Race condition — re-fetch
      return this.prisma.user.findUnique({ where: { email } });
    }
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/inbound-email/inbound-email.service.ts backend/package.json backend/package-lock.json
git commit -m "feat: add InboundEmailService with IMAP and Graph polling"
```

---

## Task 8: Module wiring

**Files:**
- Create: `backend/src/modules/inbound-email/inbound-email.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create `InboundEmailModule`**

Create `backend/src/modules/inbound-email/inbound-email.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { InboundEmailConfigController } from './inbound-email-config.controller';
import { InboundEmailConfigService } from './inbound-email-config.service';
import { InboundEmailService } from './inbound-email.service';

@Module({
  imports: [PrismaModule, TicketsModule, AttachmentsModule],
  controllers: [InboundEmailConfigController],
  providers: [InboundEmailService, InboundEmailConfigService],
})
export class InboundEmailModule {}
```

- [ ] **Step 2: Register `InboundEmailModule` in `AppModule`**

Open `backend/src/app.module.ts`. Add the import and add to the imports array after `NotificationsModule`:

```typescript
import { InboundEmailModule } from './modules/inbound-email/inbound-email.module';
```

In the `@Module({ imports: [...] })` array, add `InboundEmailModule` after `NotificationsModule`:

```typescript
NotificationsModule,
InboundEmailModule,
```

Note: `ScheduleModule.forRoot()` is ALREADY in `AppModule` — do NOT add it again.

- [ ] **Step 3: Run the full backend test suite**

```bash
cd backend
npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/inbound-email/inbound-email.module.ts backend/src/app.module.ts
git commit -m "feat: create InboundEmailModule and register in AppModule"
```

---

## Task 9: Backend unit tests

**Files:**
- Create: `backend/src/modules/inbound-email/inbound-email.service.spec.ts`

**Context:** `processMessage()` is the unit-testable core. `pollImap()` and `pollGraph()` use external I/O and are covered by the `imapflow`/`fetch` mock in one integration-style unit test. Mock `InboundEmailConfigService`, `PrismaService`, `TicketsService`, `AttachmentsService`, and `EventEmitter2`. Mock `imapflow` with `jest.mock('imapflow')`.

- [ ] **Step 1: Write the tests**

Create `backend/src/modules/inbound-email/inbound-email.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InboundEmailService } from './inbound-email.service';
import { InboundEmailConfigService } from './inbound-email-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuthProvider, Role } from '@prisma/client';

jest.mock('imapflow');

describe('InboundEmailService', () => {
  let service: InboundEmailService;
  let configService: jest.Mocked<InboundEmailConfigService>;
  let prisma: any;
  let ticketsService: jest.Mocked<TicketsService>;
  let attachmentsService: jest.Mocked<AttachmentsService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  beforeEach(async () => {
    configService = {
      getConfig: jest.fn(),
      getAccessControl: jest.fn(),
    } as any;

    prisma = {
      ticket: { findUnique: jest.fn() },
      comment: { create: jest.fn().mockResolvedValue({ id: 'comment-1' }) },
      user: { findUnique: jest.fn(), create: jest.fn() },
    };

    ticketsService = { create: jest.fn().mockResolvedValue({ id: 'ticket-new', ticketNumber: 1 }) } as any;
    attachmentsService = { uploadBuffer: jest.fn().mockResolvedValue(undefined) } as any;
    eventEmitter = { emit: jest.fn() } as any;

    const module = await Test.createTestingModule({
      providers: [
        InboundEmailService,
        { provide: InboundEmailConfigService, useValue: configService },
        { provide: PrismaService, useValue: prisma },
        { provide: TicketsService, useValue: ticketsService },
        { provide: AttachmentsService, useValue: attachmentsService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(InboundEmailService);
  });

  const baseMsg = {
    externalId: 'msg-1',
    from: 'alice@contoso.com',
    fromName: 'Alice',
    subject: 'Need help',
    body: 'My printer is broken.',
    attachments: [],
  };

  it('creates a ticket when mode is ANYONE and sender is unknown', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'ANYONE', list: [] });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-user' });

    await service.processMessage(baseMsg);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'alice@contoso.com', role: Role.END_USER, authProvider: AuthProvider.LOCAL }),
    });
    expect(ticketsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Need help', sourceChannel: 'EMAIL' }),
      'new-user',
    );
  });

  it('creates a ticket when sender domain is in DOMAINS allowlist', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'DOMAINS', list: ['contoso.com'] });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

    await service.processMessage(baseMsg);

    expect(ticketsService.create).toHaveBeenCalledTimes(1);
  });

  it('discards message when sender domain is NOT in DOMAINS allowlist', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'DOMAINS', list: ['fabrikam.com'] });

    await service.processMessage(baseMsg);

    expect(ticketsService.create).not.toHaveBeenCalled();
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('discards message when mode is USERS and sender not in list', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'USERS', list: ['bob@contoso.com'] });

    await service.processMessage(baseMsg);

    expect(ticketsService.create).not.toHaveBeenCalled();
  });

  it('creates a comment when subject contains [#N] matching an existing ticket', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'ANYONE', list: [] });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.ticket.findUnique.mockResolvedValue({
      id: 'ticket-1', ticketNumber: 42, title: 'Printer issue',
      createdById: 'user-1', assignedToId: null,
    });

    await service.processMessage({ ...baseMsg, subject: '[#42] Re: Printer issue' });

    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ticketId: 'ticket-1', authorId: 'user-1', isInternal: false }),
    });
    expect(ticketsService.create).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith('ticket.commented', expect.objectContaining({ ticketNumber: 42 }));
  });

  it('creates a new ticket when [#N] subject tag does not match any ticket', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'ANYONE', list: [] });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.ticket.findUnique.mockResolvedValue(null);

    await service.processMessage({ ...baseMsg, subject: '[#999] orphan reply' });

    expect(ticketsService.create).toHaveBeenCalledTimes(1);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('saves attachments to the created ticket', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'ANYONE', list: [] });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    ticketsService.create.mockResolvedValue({ id: 'ticket-new', ticketNumber: 2 } as any);

    await service.processMessage({
      ...baseMsg,
      attachments: [{ filename: 'log.txt', contentType: 'text/plain', data: Buffer.from('err') }],
    });

    expect(attachmentsService.uploadBuffer).toHaveBeenCalledWith(
      'ticket-new', 'user-1', 'log.txt', 'text/plain', expect.any(Buffer),
    );
  });

  it('returns processed:0 when transport is NONE', async () => {
    configService.getConfig = jest.fn().mockResolvedValue({ transport: 'NONE', config: {} });

    const result = await service.pollOnce();

    expect(result).toEqual({ processed: 0 });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd backend
npx jest inbound-email.service.spec.ts --no-coverage
```

Expected: All 7 tests PASS.

- [ ] **Step 3: Run full suite**

```bash
npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/inbound-email/inbound-email.service.spec.ts
git commit -m "test: add unit tests for InboundEmailService processMessage and pollOnce"
```

---

## Task 10: Frontend — admin inbound email page

**Files:**
- Create: `frontend/src/app/(app)/admin/inbound-email/page.tsx`

**Context:** Follows the exact same pattern as `frontend/src/app/(app)/admin/notifications/page.tsx` — `'use client'`, `useSession()`, token at `(session as any)?.accessToken`, `NEXT_PUBLIC_API_URL`, inline styles, two sections with save buttons and inline feedback. Tag-style input for domains/users list (type + Enter to add, × to remove).

- [ ] **Step 1: Create the page**

```bash
mkdir -p frontend/src/app/\(app\)/admin/inbound-email
```

Create `frontend/src/app/(app)/admin/inbound-email/page.tsx`:

```typescript
'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, KeyboardEvent } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL;

export default function AdminInboundEmailPage() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken;

  // Transport section
  const [transport, setTransport] = useState<'IMAP' | 'GRAPH' | 'NONE'>('NONE');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('');
  const [imapSecure, setImapSecure] = useState(false);
  const [imapUser, setImapUser] = useState('');
  const [imapPass, setImapPass] = useState('');
  const [imapMailbox, setImapMailbox] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [mailboxAddress, setMailboxAddress] = useState('');
  const [transportSaving, setTransportSaving] = useState(false);
  const [transportMsg, setTransportMsg] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  // Access control section
  const [mode, setMode] = useState<'ANYONE' | 'DOMAINS' | 'USERS'>('ANYONE');
  const [list, setList] = useState<string[]>([]);
  const [listInput, setListInput] = useState('');
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessMsg, setAccessMsg] = useState('');

  async function loadConfig() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/inbound-email/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setTransport(data.transport ?? 'NONE');
      if (data.transport === 'IMAP' && data.config) {
        setImapHost(data.config.host ?? '');
        setImapPort(String(data.config.port ?? ''));
        setImapSecure(data.config.secure ?? false);
        setImapUser(data.config.user ?? '');
        setImapPass(data.config.pass ?? '');
        setImapMailbox(data.config.mailbox ?? '');
      } else if (data.transport === 'GRAPH' && data.config) {
        setTenantId(data.config.tenantId ?? '');
        setClientId(data.config.clientId ?? '');
        setClientSecret(data.config.clientSecret ?? '');
        setMailboxAddress(data.config.mailboxAddress ?? '');
      }
    } catch {}
  }

  async function loadAccess() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/inbound-email/access`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setMode(data.mode ?? 'ANYONE');
      setList(data.list ?? []);
    } catch {}
  }

  useEffect(() => {
    loadConfig();
    loadAccess();
  }, [token]);

  async function saveConfig() {
    if (!token) return;
    const currentTransport = transport;
    const body: Record<string, unknown> = { transport: currentTransport };
    if (currentTransport === 'IMAP') {
      Object.assign(body, {
        host: imapHost,
        port: parseInt(imapPort, 10),
        secure: imapSecure,
        user: imapUser,
        pass: imapPass,
        mailbox: imapMailbox || 'INBOX',
      });
    } else if (currentTransport === 'GRAPH') {
      Object.assign(body, { tenantId, clientId, clientSecret, mailboxAddress });
    }
    setTransportSaving(true);
    setTransportMsg('');
    try {
      const res = await fetch(`${API}/inbound-email/config`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTransportMsg(res.ok ? 'Config saved.' : 'Error saving config.');
    } catch {
      setTransportMsg('Error saving config.');
    } finally {
      setTransportSaving(false);
    }
  }

  async function testPoll() {
    if (!token) return;
    setTestLoading(true);
    setTestMsg('');
    try {
      const res = await fetch(`${API}/inbound-email/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestMsg(res.ok ? `Processed ${data.processed} email(s).` : (data.message ?? 'Error running test poll.'));
    } catch {
      setTestMsg('Error running test poll.');
    } finally {
      setTestLoading(false);
    }
  }

  async function saveAccess() {
    if (!token) return;
    setAccessSaving(true);
    setAccessMsg('');
    try {
      const res = await fetch(`${API}/inbound-email/access`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, list }),
      });
      setAccessMsg(res.ok ? 'Access control saved.' : 'Error saving access control.');
    } catch {
      setAccessMsg('Error saving access control.');
    } finally {
      setAccessSaving(false);
    }
  }

  function addListEntry() {
    const entry = listInput.trim().toLowerCase();
    if (entry && !list.includes(entry)) {
      setList([...list, entry]);
    }
    setListInput('');
  }

  function handleListKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addListEntry(); }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0',
    borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: '#475569', marginBottom: 4, display: 'block',
  };
  const sectionStyle: React.CSSProperties = {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24,
  };
  const btnStyle: React.CSSProperties = {
    padding: '8px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: '#3b82f6', color: '#fff', fontSize: 14, fontWeight: 500,
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Inbound Email</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>
        Configure email-to-ticket ingestion via IMAP or Microsoft Graph.
      </p>

      {/* Transport & Credentials */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>Transport & Credentials</h2>

        <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
          {(['IMAP', 'GRAPH', 'NONE'] as const).map((t) => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
              <input type="radio" value={t} checked={transport === t} onChange={() => setTransport(t)} />
              {t === 'NONE' ? 'Disabled' : t === 'IMAP' ? 'IMAP' : 'Microsoft Graph'}
            </label>
          ))}
        </div>

        {transport === 'IMAP' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Host</label>
              <input style={inputStyle} value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.gmail.com" />
            </div>
            <div>
              <label style={labelStyle}>Port</label>
              <input style={inputStyle} type="number" value={imapPort} onChange={(e) => setImapPort(e.target.value)} placeholder="993" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} id="imap-secure" />
              <label htmlFor="imap-secure" style={{ fontSize: 14 }}>Use TLS</label>
            </div>
            <div>
              <label style={labelStyle}>Mailbox</label>
              <input style={inputStyle} value={imapMailbox} onChange={(e) => setImapMailbox(e.target.value)} placeholder="INBOX" />
            </div>
            <div>
              <label style={labelStyle}>Username</label>
              <input style={inputStyle} value={imapUser} onChange={(e) => setImapUser(e.target.value)} placeholder="helpdesk@contoso.com" />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input style={inputStyle} type="password" value={imapPass} onChange={(e) => setImapPass(e.target.value)} placeholder={imapPass === '***' ? 'Saved — enter new value to change' : ''} />
            </div>
          </div>
        )}

        {transport === 'GRAPH' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
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
              <input style={inputStyle} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={clientSecret === '***' ? 'Saved — enter new value to change' : ''} />
            </div>
            <div>
              <label style={labelStyle}>Mailbox Address</label>
              <input style={inputStyle} value={mailboxAddress} onChange={(e) => setMailboxAddress(e.target.value)} placeholder="helpdesk@contoso.com" />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={btnStyle} onClick={saveConfig} disabled={transportSaving}>
            {transportSaving ? 'Saving…' : 'Save'}
          </button>
          <button
            style={{ ...btnStyle, background: transport === 'NONE' ? '#94a3b8' : '#0f172a' }}
            onClick={testPoll}
            disabled={testLoading || transport === 'NONE'}
          >
            {testLoading ? 'Polling…' : 'Test Poll'}
          </button>
          {transportMsg && <span style={{ fontSize: 13, color: transportMsg.startsWith('Error') ? '#ef4444' : '#16a34a' }}>{transportMsg}</span>}
          {testMsg && <span style={{ fontSize: 13, color: testMsg.startsWith('Error') ? '#ef4444' : '#16a34a' }}>{testMsg}</span>}
        </div>
      </section>

      {/* Access Control */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>Access Control</h2>

        <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
          {([
            { value: 'ANYONE', label: 'Anyone' },
            { value: 'DOMAINS', label: 'Approved Domains' },
            { value: 'USERS', label: 'Specific Users' },
          ] as const).map(({ value, label }) => (
            <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
              <input type="radio" value={value} checked={mode === value} onChange={() => setMode(value)} />
              {label}
            </label>
          ))}
        </div>

        {(mode === 'DOMAINS' || mode === 'USERS') && (
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              {mode === 'DOMAINS' ? 'Allowed Domains' : 'Allowed Email Addresses'}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {list.map((entry) => (
                <span key={entry} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#e0f2fe', color: '#0369a1', borderRadius: 4, padding: '2px 8px', fontSize: 13 }}>
                  {entry}
                  <button onClick={() => setList(list.filter((e) => e !== entry))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0369a1', padding: 0, fontSize: 13 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...inputStyle, width: 'auto', flexGrow: 1 }}
                value={listInput}
                onChange={(e) => setListInput(e.target.value)}
                onKeyDown={handleListKeyDown}
                placeholder={mode === 'DOMAINS' ? 'contoso.com' : 'user@contoso.com'}
              />
              <button style={{ ...btnStyle, background: '#64748b' }} onClick={addListEntry}>Add</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={btnStyle} onClick={saveAccess} disabled={accessSaving}>
            {accessSaving ? 'Saving…' : 'Save Access Control'}
          </button>
          {accessMsg && <span style={{ fontSize: 13, color: accessMsg.startsWith('Error') ? '#ef4444' : '#16a34a' }}>{accessMsg}</span>}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(app\)/admin/inbound-email/page.tsx
git commit -m "feat: add admin inbound email config page (transport + access control)"
```

---

## Task 11: Frontend — update admin landing page

**Files:**
- Modify: `frontend/src/app/(app)/admin/page.tsx`

- [ ] **Step 1: Add the 7th card and update the grid**

Open `frontend/src/app/(app)/admin/page.tsx`. Make two changes:

**Change 1** — update `gridTemplateColumns` and `maxWidth`:
```typescript
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 20, maxWidth: 2000 }}>
```

**Change 2** — add the Inbound Email card after the Notifications card:
```typescript
<Link href="/admin/inbound-email" style={{ textDecoration: 'none' }}>
  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
    <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 8 }}>Inbound Email</div>
    <div style={{ color: '#64748b', fontSize: 14 }}>Configure email-to-ticket ingestion via IMAP or Microsoft Graph.</div>
  </div>
</Link>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run frontend tests**

```bash
npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(app\)/admin/page.tsx
git commit -m "feat: add Inbound Email card to admin landing page (7th card)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Dual transport IMAP / Graph / None | Task 5 (config), Task 7 (service) |
| Access control ANYONE / DOMAINS / USERS | Task 5 (config), Task 7 (processMessage) |
| Auto-create END_USER for unknown sender (ANYONE/DOMAINS) | Task 7 (findOrCreateUser) |
| Discard when USERS mode and sender unknown | Task 7 (findOrCreateUser returns null) |
| Reply threading via [#ticketNumber] | Task 1 (Prisma), Task 3 (subjects), Task 7 (processMessage) |
| Attachments saved via uploadBuffer | Task 2 (service method), Task 7 (processMessage) |
| Polling @Cron every minute | Task 7 (scheduledPoll) |
| IMAP marks SEEN after processing | Task 7 (pollImap) |
| Graph marks isRead after processing | Task 7 (pollGraph) |
| Credential encryption AES-256-GCM | Task 5 (InboundEmailConfigService) |
| Admin GET/PUT config, GET/PUT access, POST test | Task 6 (controller) |
| POST /test returns 400 when NONE | Task 6 (controller) |
| Frontend transport section with redacted password | Task 10 |
| Frontend access control with tag input | Task 10 |
| Admin landing page 7th card | Task 11 |
| Backend unit tests (7 processMessage cases) | Task 9 |

All spec requirements are covered. No placeholders. Type signatures are consistent throughout (e.g., `InboundMessage`, `{ mode, list }` from `getAccessControl`, `{ processed: number }` from `pollOnce`).
