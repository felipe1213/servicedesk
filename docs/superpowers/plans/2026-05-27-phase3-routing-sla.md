# Phase 3 — Routing Rules + SLA Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a routing rules engine (auto-assigns tickets on creation via event listener) and SLA policies (deadline stamping + cron-based breach detection with configurable escalation), both manageable via a new admin UI.

**Architecture:** Two new NestJS modules (`RoutingModule`, `SlaModule`) each use PrismaService directly — no cross-module dependency on TicketsModule. TicketsModule imports SlaModule to call `stampDeadlines()` synchronously, then emits `ticket.created` via EventEmitter2 for async routing. A new `/admin` route group in Next.js holds the management UI.

**Tech Stack:** NestJS 10, `@nestjs/event-emitter`, `@nestjs/schedule`, Prisma 5, Next.js 14 App Router, React Testing Library, Jest.

---

## File Map

**Backend — new files**
- `backend/src/modules/sla/dto/create-sla-policy.dto.ts`
- `backend/src/modules/sla/dto/update-sla-policy.dto.ts`
- `backend/src/modules/sla/sla.service.ts`
- `backend/src/modules/sla/sla.controller.ts`
- `backend/src/modules/sla/sla.module.ts`
- `backend/src/modules/sla/sla.service.spec.ts`
- `backend/src/modules/routing/dto/create-routing-rule.dto.ts`
- `backend/src/modules/routing/dto/update-routing-rule.dto.ts`
- `backend/src/modules/routing/dto/reorder-rules.dto.ts`
- `backend/src/modules/routing/routing.service.ts`
- `backend/src/modules/routing/routing.listener.ts`
- `backend/src/modules/routing/routing.controller.ts`
- `backend/src/modules/routing/routing.module.ts`
- `backend/src/modules/routing/routing.service.spec.ts`

**Backend — modified files**
- `backend/package.json` — add `@nestjs/event-emitter`, `@nestjs/schedule`
- `backend/prisma/schema.prisma` — add `BreachAction` enum + new `SlaPolicy` fields + back-relations
- `backend/src/modules/tickets/tickets.service.ts` — inject `SlaService` + `EventEmitter2`, call after create
- `backend/src/modules/tickets/tickets.module.ts` — import `SlaModule`, `EventEmitterModule`
- `backend/src/app.module.ts` — add `EventEmitterModule`, `ScheduleModule`, `RoutingModule`, `SlaModule`

**Frontend — new files**
- `frontend/src/app/(app)/admin/page.tsx`
- `frontend/src/app/(app)/admin/routing-rules/page.tsx`
- `frontend/src/app/(app)/admin/sla-policies/page.tsx`
- `frontend/src/app/(app)/admin/routing-rules/page.test.tsx`
- `frontend/src/app/(app)/admin/sla-policies/page.test.tsx`

**Frontend — modified files**
- `frontend/src/app/(app)/layout.tsx` — add Admin nav link for ADMIN/MANAGER roles

---

## Task 1: Install packages + Prisma schema migration

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add packages to package.json**

In `backend/package.json`, add to `"dependencies"`:
```json
"@nestjs/event-emitter": "^2.0.0",
"@nestjs/schedule": "^4.0.0"
```

- [ ] **Step 2: Update schema.prisma**

Add the `BreachAction` enum after the existing enums (after `KbSource`):
```prisma
enum BreachAction {
  FLAG
  ESCALATE
  BOTH
}
```

Replace the existing `SlaPolicy` model with:
```prisma
model SlaPolicy {
  id                    String        @id @default(cuid())
  name                  String
  priorityLevel         Priority      @unique
  responseTimeMinutes   Int
  resolutionTimeMinutes Int
  breachAction          BreachAction  @default(FLAG)
  escalateToUserId      String?
  escalateToUser        User?         @relation("SlaEscalateToUser", fields: [escalateToUserId], references: [id])
  escalateToTeamId      String?
  escalateToTeam        Team?         @relation("SlaEscalateToTeam", fields: [escalateToTeamId], references: [id])
  tickets               Ticket[]
  createdAt             DateTime      @default(now())
  updatedAt             DateTime      @updatedAt
}
```

Add back-relations to the `User` model (after `kbArticles` line):
```prisma
slaPoliciesEscalateUser SlaPolicy[] @relation("SlaEscalateToUser")
```

Add back-relations to the `Team` model (after `routingRules` line):
```prisma
slaPoliciesEscalateTeam SlaPolicy[] @relation("SlaEscalateToTeam")
```

- [ ] **Step 3: Install packages and run migration inside Docker**

```bash
docker compose exec backend npm install
docker compose exec backend npx prisma migrate dev --name add_breach_action_to_sla_policy
docker compose exec backend npm run db:generate
```

Expected: migration file created, Prisma client regenerated with `BreachAction` enum available.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add BreachAction enum and escalation fields to SlaPolicy schema"
```

---

## Task 2: SlaModule — DTOs + service

**Files:**
- Create: `backend/src/modules/sla/dto/create-sla-policy.dto.ts`
- Create: `backend/src/modules/sla/dto/update-sla-policy.dto.ts`
- Create: `backend/src/modules/sla/sla.service.ts`

- [ ] **Step 1: Create create-sla-policy.dto.ts**

```typescript
// backend/src/modules/sla/dto/create-sla-policy.dto.ts
import { IsEnum, IsInt, IsOptional, IsString, Min, IsNotEmpty } from 'class-validator';
import { BreachAction, Priority } from '@prisma/client';

export class CreateSlaPolicyDto {
  @IsString() @IsNotEmpty() name: string;
  @IsEnum(Priority) priorityLevel: Priority;
  @IsInt() @Min(1) responseTimeMinutes: number;
  @IsInt() @Min(1) resolutionTimeMinutes: number;
  @IsEnum(BreachAction) @IsOptional() breachAction?: BreachAction;
  @IsString() @IsOptional() escalateToUserId?: string;
  @IsString() @IsOptional() escalateToTeamId?: string;
}
```

- [ ] **Step 2: Create update-sla-policy.dto.ts**

```typescript
// backend/src/modules/sla/dto/update-sla-policy.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateSlaPolicyDto } from './create-sla-policy.dto';

export class UpdateSlaPolicyDto extends PartialType(CreateSlaPolicyDto) {}
```

- [ ] **Step 3: Create sla.service.ts**

```typescript
// backend/src/modules/sla/sla.service.ts
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BreachAction, Priority } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';

type TicketForSla = {
  id: string;
  priority: Priority;
  createdAt: Date;
};

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.slaPolicy.findMany({ orderBy: { priorityLevel: 'asc' } });
  }

  async create(dto: CreateSlaPolicyDto) {
    const existing = await this.prisma.slaPolicy.findUnique({
      where: { priorityLevel: dto.priorityLevel },
    });
    if (existing) throw new ConflictException(`SLA policy for ${dto.priorityLevel} already exists`);
    return this.prisma.slaPolicy.create({ data: dto });
  }

  async update(id: string, dto: UpdateSlaPolicyDto) {
    const existing = await this.prisma.slaPolicy.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('SLA policy not found');
    return this.prisma.slaPolicy.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const existing = await this.prisma.slaPolicy.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('SLA policy not found');
    return this.prisma.slaPolicy.delete({ where: { id } });
  }

  async stampDeadlines(ticket: TicketForSla) {
    const policy = await this.prisma.slaPolicy.findUnique({
      where: { priorityLevel: ticket.priority },
    });
    if (!policy) return;

    const responseDeadline = new Date(
      ticket.createdAt.getTime() + policy.responseTimeMinutes * 60 * 1000,
    );
    const resolutionDeadline = new Date(
      ticket.createdAt.getTime() + policy.resolutionTimeMinutes * 60 * 1000,
    );

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { responseDeadline, resolutionDeadline, slaPolicyId: policy.id },
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkBreaches() {
    const now = new Date();
    const tickets = await this.prisma.ticket.findMany({
      where: {
        slaBreached: false,
        slaPolicyId: { not: null },
        OR: [
          { responseDeadline: { lt: now } },
          { resolutionDeadline: { lt: now } },
        ],
      },
      include: { slaPolicy: true },
    });

    for (const ticket of tickets) {
      try {
        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: { slaBreached: true },
        });

        await this.prisma.auditLog.create({
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
            await this.prisma.ticket.update({ where: { id: ticket.id }, data: updateData });
          }
        }
      } catch (err) {
        this.logger.error(`Failed to process breach for ticket ${ticket.id}`, err);
      }
    }
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
docker compose exec backend npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/sla/
git commit -m "feat: add SlaService with stampDeadlines and checkBreaches cron"
```

---

## Task 3: SlaModule — controller + module + AppModule

**Files:**
- Create: `backend/src/modules/sla/sla.controller.ts`
- Create: `backend/src/modules/sla/sla.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create sla.controller.ts**

```typescript
// backend/src/modules/sla/sla.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { SlaService } from './sla.service';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';

@Controller('sla-policies')
@Roles(Role.ADMIN)
export class SlaController {
  constructor(private sla: SlaService) {}

  @Get()
  findAll() { return this.sla.findAll(); }

  @Post()
  create(@Body() dto: CreateSlaPolicyDto) { return this.sla.create(dto); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSlaPolicyDto) { return this.sla.update(id, dto); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.sla.remove(id); }
}
```

- [ ] **Step 2: Create sla.module.ts**

```typescript
// backend/src/modules/sla/sla.module.ts
import { Module } from '@nestjs/common';
import { SlaController } from './sla.controller';
import { SlaService } from './sla.service';

@Module({
  controllers: [SlaController],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
```

- [ ] **Step 3: Update app.module.ts**

```typescript
// backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { SlaModule } from './modules/sla/sla.module';
import { RoutingModule } from './modules/routing/routing.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    PrismaModule,
    AuthModule,
    TicketsModule,
    UsersModule,
    AttachmentsModule,
    SlaModule,
    RoutingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
```

Note: `RoutingModule` will be created in Task 7. Add the import now but the module file will be created then — the TypeScript compiler will report an error until Task 7 is done, which is expected.

- [ ] **Step 4: Verify backend starts**

```bash
docker compose up -d --build backend
docker compose logs -f backend
```

Expected: `NestJS application successfully started` (after Task 7 creates RoutingModule — for now, comment out RoutingModule import and registration if it causes a build failure).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/sla/sla.controller.ts backend/src/modules/sla/sla.module.ts backend/src/app.module.ts
git commit -m "feat: add SlaModule controller, module, and register in AppModule"
```

---

## Task 4: SlaService unit tests

**Files:**
- Create: `backend/src/modules/sla/sla.service.spec.ts`

- [ ] **Step 1: Write the test file**

```typescript
// backend/src/modules/sla/sla.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BreachAction, Priority } from '@prisma/client';
import { SlaService } from './sla.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  slaPolicy: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  ticket: {
    update: jest.fn(),
    findMany: jest.fn(),
  },
  auditLog: { create: jest.fn() },
};

describe('SlaService', () => {
  let service: SlaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<SlaService>(SlaService);
    jest.clearAllMocks();
  });

  const basePolicy = {
    id: 'pol-1',
    name: 'Critical SLA',
    priorityLevel: Priority.CRITICAL,
    responseTimeMinutes: 30,
    resolutionTimeMinutes: 240,
    breachAction: BreachAction.FLAG,
    escalateToUserId: null,
    escalateToTeamId: null,
  };

  describe('create', () => {
    it('throws ConflictException if priority already has a policy', async () => {
      mockPrisma.slaPolicy.findUnique.mockResolvedValue(basePolicy);
      await expect(
        service.create({ name: 'Dup', priorityLevel: Priority.CRITICAL, responseTimeMinutes: 30, resolutionTimeMinutes: 240 }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates policy when priority is unused', async () => {
      mockPrisma.slaPolicy.findUnique.mockResolvedValue(null);
      mockPrisma.slaPolicy.create.mockResolvedValue(basePolicy);
      const result = await service.create({
        name: 'Critical SLA', priorityLevel: Priority.CRITICAL,
        responseTimeMinutes: 30, resolutionTimeMinutes: 240,
      });
      expect(result).toBe(basePolicy);
    });
  });

  describe('update', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.slaPolicy.findUnique.mockResolvedValue(null);
      await expect(service.update('bad', { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('stampDeadlines', () => {
    it('sets responseDeadline and resolutionDeadline based on policy minutes', async () => {
      mockPrisma.slaPolicy.findUnique.mockResolvedValue(basePolicy);
      mockPrisma.ticket.update.mockResolvedValue({});

      const createdAt = new Date('2026-01-01T10:00:00Z');
      await service.stampDeadlines({ id: 'ticket-1', priority: Priority.CRITICAL, createdAt });

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: {
          responseDeadline: new Date('2026-01-01T10:30:00Z'),
          resolutionDeadline: new Date('2026-01-01T14:00:00Z'),
          slaPolicyId: 'pol-1',
        },
      });
    });

    it('does nothing when no policy matches the ticket priority', async () => {
      mockPrisma.slaPolicy.findUnique.mockResolvedValue(null);
      await service.stampDeadlines({ id: 'ticket-1', priority: Priority.LOW, createdAt: new Date() });
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  describe('checkBreaches', () => {
    it('sets slaBreached=true and writes audit log for overdue ticket', async () => {
      const overdueTicket = {
        id: 'ticket-1',
        createdById: 'user-1',
        slaPolicy: { ...basePolicy, breachAction: BreachAction.FLAG },
      };
      mockPrisma.ticket.findMany.mockResolvedValue([overdueTicket]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.checkBreaches();

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ticket-1' }, data: { slaBreached: true } }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'SLA_BREACHED' }) }),
      );
    });

    it('updates assignedToId when breachAction is ESCALATE', async () => {
      const escalateTicket = {
        id: 'ticket-2',
        createdById: 'user-1',
        slaPolicy: { ...basePolicy, breachAction: BreachAction.ESCALATE, escalateToUserId: 'manager-1', escalateToTeamId: null },
      };
      mockPrisma.ticket.findMany.mockResolvedValue([escalateTicket]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.checkBreaches();

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { assignedToId: 'manager-1' } }),
      );
    });

    it('does not update assignedToId when breachAction is FLAG', async () => {
      const flagTicket = {
        id: 'ticket-3',
        createdById: 'user-1',
        slaPolicy: { ...basePolicy, breachAction: BreachAction.FLAG, escalateToUserId: 'manager-1' },
      };
      mockPrisma.ticket.findMany.mockResolvedValue([flagTicket]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.checkBreaches();

      const updateCalls = mockPrisma.ticket.update.mock.calls;
      const escalationCall = updateCalls.find(([args]: any[]) => args.data.assignedToId);
      expect(escalationCall).toBeUndefined();
    });

    it('skips already-breached tickets', async () => {
      mockPrisma.ticket.findMany.mockResolvedValue([]);
      await service.checkBreaches();
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
docker compose exec backend npm test -- --testPathPattern=sla.service.spec
```

Expected: 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/sla/sla.service.spec.ts
git commit -m "test: add SlaService unit tests"
```

---

## Task 5: TicketsModule — wire SlaService + EventEmitter2

**Files:**
- Modify: `backend/src/modules/tickets/tickets.service.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`

- [ ] **Step 1: Update tickets.module.ts to import SlaModule**

```typescript
// backend/src/modules/tickets/tickets.module.ts
import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { SlaModule } from '../sla/sla.module';

@Module({
  imports: [SlaModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
```

- [ ] **Step 2: Update tickets.service.ts to inject SlaService and EventEmitter2**

Replace the full file:

```typescript
// backend/src/modules/tickets/tickets.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaService } from '../sla/sla.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { FindTicketsQueryDto } from './dto/find-tickets-query.dto';
import { Prisma, Role, TicketStatus } from '@prisma/client';

type RequestUser = { id: string; role: Role };

const TICKET_INCLUDE = {
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  team: { select: { id: true, name: true } },
} as const;

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private slaService: SlaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreateTicketDto, userId: string) {
    const ticket = await this.prisma.ticket.create({
      data: { ...dto, createdById: userId, status: TicketStatus.NEW },
      include: TICKET_INCLUDE,
    });

    await this.prisma.auditLog.create({
      data: { ticketId: ticket.id, actorId: userId, action: 'CREATED', newValue: TicketStatus.NEW },
    });

    await this.slaService.stampDeadlines({
      id: ticket.id,
      priority: ticket.priority,
      createdAt: ticket.createdAt,
    });

    this.eventEmitter.emit('ticket.created', ticket);

    return ticket;
  }

  async findAll(user: RequestUser, query: FindTicketsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const skip = (page - 1) * limit;

    const where: Prisma.TicketWhereInput = {};
    if (user.role === Role.END_USER) where.createdById = user.id;
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: TICKET_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        ...TICKET_INCLUDE,
        comments: {
          include: { author: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
        auditLogs: {
          include: { actor: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();

    if (user.role === Role.END_USER) {
      ticket.comments = ticket.comments.filter((c) => !c.isInternal);
    }

    return ticket;
  }

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
    }

    return updated;
  }

  async addComment(ticketId: string, dto: CreateCommentDto, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();

    const isInternal = user.role !== Role.END_USER ? (dto.isInternal ?? false) : false;

    return this.prisma.comment.create({
      data: { ticketId, authorId: user.id, body: dto.body, isInternal },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
  }

  async getStats() {
    const [total, byStatus, byPriority] = await Promise.all([
      this.prisma.ticket.count(),
      this.prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['priority'], _count: { _all: true } }),
    ]);
    return { total, byStatus, byPriority };
  }
}
```

- [ ] **Step 3: Update TicketsService tests to inject SlaService and EventEmitter2 mocks**

In `backend/src/modules/tickets/tickets.service.spec.ts`, update the `Test.createTestingModule` call to add mocks:

```typescript
// At top of file, add mock objects:
const mockSlaService = { stampDeadlines: jest.fn() };
const mockEventEmitter = { emit: jest.fn() };

// In beforeEach, update providers:
const module: TestingModule = await Test.createTestingModule({
  providers: [
    TicketsService,
    { provide: PrismaService, useValue: mockPrisma },
    { provide: SlaService, useValue: mockSlaService },
    { provide: EventEmitter2, useValue: mockEventEmitter },
  ],
}).compile();
```

Also add to the imports at the top of the spec file:
```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SlaService } from '../sla/sla.service';
```

And add `mockSlaService.stampDeadlines.mockResolvedValue(undefined)` and `mockEventEmitter.emit.mockReturnValue(true)` to `jest.clearAllMocks()` setup or in `beforeEach`.

- [ ] **Step 4: Run all backend tests**

```bash
docker compose exec backend npm test
```

Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tickets/tickets.service.ts backend/src/modules/tickets/tickets.module.ts backend/src/modules/tickets/tickets.service.spec.ts
git commit -m "feat: wire SlaService and EventEmitter2 into TicketsService"
```

---

## Task 6: RoutingModule — DTOs + service

**Files:**
- Create: `backend/src/modules/routing/dto/create-routing-rule.dto.ts`
- Create: `backend/src/modules/routing/dto/update-routing-rule.dto.ts`
- Create: `backend/src/modules/routing/dto/reorder-rules.dto.ts`
- Create: `backend/src/modules/routing/routing.service.ts`

- [ ] **Step 1: Create create-routing-rule.dto.ts**

```typescript
// backend/src/modules/routing/dto/create-routing-rule.dto.ts
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional,
  IsString, Min, ValidateNested,
} from 'class-validator';

export class ConditionDto {
  @IsIn(['category', 'channel', 'keyword']) field: string;
  @IsIn(['eq', 'contains']) operator: string;
  @IsString() @IsNotEmpty() value: string;
}

export class CreateRoutingRuleDto {
  @IsInt() @Min(1) priorityOrder: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ConditionDto) conditions: ConditionDto[];
  @IsString() @IsOptional() assignToAgentId?: string;
  @IsString() @IsOptional() assignToTeamId?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
```

- [ ] **Step 2: Create update-routing-rule.dto.ts**

```typescript
// backend/src/modules/routing/dto/update-routing-rule.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateRoutingRuleDto } from './create-routing-rule.dto';

export class UpdateRoutingRuleDto extends PartialType(CreateRoutingRuleDto) {}
```

- [ ] **Step 3: Create reorder-rules.dto.ts**

```typescript
// backend/src/modules/routing/dto/reorder-rules.dto.ts
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class ReorderItemDto {
  @IsString() id: string;
  @IsInt() @Min(1) priorityOrder: number;
}

export class ReorderRulesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReorderItemDto) rules: ReorderItemDto[];
}
```

- [ ] **Step 4: Create routing.service.ts**

```typescript
// backend/src/modules/routing/routing.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Channel, Priority, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoutingRuleDto, ConditionDto } from './dto/create-routing-rule.dto';
import { UpdateRoutingRuleDto } from './dto/update-routing-rule.dto';
import { ReorderRulesDto } from './dto/reorder-rules.dto';

type TicketForRouting = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  sourceChannel: Channel;
  priority: Priority;
  status: TicketStatus;
  createdById: string;
};

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.routingRule.findMany({
      include: {
        assignToAgent: { select: { id: true, name: true, email: true } },
        assignToTeam: { select: { id: true, name: true } },
      },
      orderBy: { priorityOrder: 'asc' },
    });
  }

  create(dto: CreateRoutingRuleDto) {
    return this.prisma.routingRule.create({ data: dto });
  }

  async update(id: string, dto: UpdateRoutingRuleDto) {
    const existing = await this.prisma.routingRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Routing rule not found');
    return this.prisma.routingRule.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const existing = await this.prisma.routingRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Routing rule not found');
    return this.prisma.routingRule.delete({ where: { id } });
  }

  async reorder(dto: ReorderRulesDto) {
    await this.prisma.$transaction(
      dto.rules.map(({ id, priorityOrder }) =>
        this.prisma.routingRule.update({ where: { id }, data: { priorityOrder } }),
      ),
    );
  }

  private matchesCondition(condition: ConditionDto, ticket: TicketForRouting): boolean {
    if (condition.field === 'category') {
      return condition.operator === 'eq' && ticket.category === condition.value;
    }
    if (condition.field === 'channel') {
      return condition.operator === 'eq' && ticket.sourceChannel === condition.value;
    }
    if (condition.field === 'keyword') {
      const haystack = `${ticket.title} ${ticket.description}`.toLowerCase();
      return haystack.includes(condition.value.toLowerCase());
    }
    return false;
  }

  private ruleMatches(conditions: ConditionDto[], ticket: TicketForRouting): boolean {
    return conditions.every((c) => this.matchesCondition(c, ticket));
  }

  async applyRules(ticket: TicketForRouting) {
    const rules = await this.prisma.routingRule.findMany({
      where: { isActive: true },
      orderBy: { priorityOrder: 'asc' },
    });

    for (const rule of rules) {
      const conditions = rule.conditions as ConditionDto[];
      if (this.ruleMatches(conditions, ticket)) {
        const updateData: { assignedToId?: string; teamId?: string; status?: TicketStatus } = {};
        if (rule.assignToAgentId) {
          updateData.assignedToId = rule.assignToAgentId;
          if (ticket.status === TicketStatus.NEW) updateData.status = TicketStatus.ASSIGNED;
        }
        if (rule.assignToTeamId) updateData.teamId = rule.assignToTeamId;

        await this.prisma.ticket.update({ where: { id: ticket.id }, data: updateData });
        await this.prisma.auditLog.create({
          data: {
            ticketId: ticket.id,
            actorId: ticket.createdById,
            action: 'ASSIGNED',
            newValue: `routing-rule:${rule.id}`,
          },
        });
        return; // first match wins
      }
    }
  }
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
docker compose exec backend npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/routing/
git commit -m "feat: add RoutingService with applyRules condition engine"
```

---

## Task 7: RoutingModule — listener + controller + module

**Files:**
- Create: `backend/src/modules/routing/routing.listener.ts`
- Create: `backend/src/modules/routing/routing.controller.ts`
- Create: `backend/src/modules/routing/routing.module.ts`

- [ ] **Step 1: Create routing.listener.ts**

```typescript
// backend/src/modules/routing/routing.listener.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RoutingService } from './routing.service';

@Injectable()
export class RoutingListener {
  private readonly logger = new Logger(RoutingListener.name);

  constructor(private routing: RoutingService) {}

  @OnEvent('ticket.created')
  async handle(ticket: any) {
    try {
      await this.routing.applyRules(ticket);
    } catch (err) {
      this.logger.error(`Routing failed for ticket ${ticket?.id}`, err);
    }
  }
}
```

- [ ] **Step 2: Create routing.controller.ts**

```typescript
// backend/src/modules/routing/routing.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { RoutingService } from './routing.service';
import { CreateRoutingRuleDto } from './dto/create-routing-rule.dto';
import { UpdateRoutingRuleDto } from './dto/update-routing-rule.dto';
import { ReorderRulesDto } from './dto/reorder-rules.dto';

@Controller('routing-rules')
@Roles(Role.ADMIN, Role.MANAGER)
export class RoutingController {
  constructor(private routing: RoutingService) {}

  @Get()
  findAll() { return this.routing.findAll(); }

  @Post()
  create(@Body() dto: CreateRoutingRuleDto) { return this.routing.create(dto); }

  @Patch('reorder')
  reorder(@Body() dto: ReorderRulesDto) { return this.routing.reorder(dto); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoutingRuleDto) { return this.routing.update(id, dto); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.routing.remove(id); }
}
```

- [ ] **Step 3: Create routing.module.ts**

```typescript
// backend/src/modules/routing/routing.module.ts
import { Module } from '@nestjs/common';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';
import { RoutingListener } from './routing.listener';

@Module({
  controllers: [RoutingController],
  providers: [RoutingService, RoutingListener],
})
export class RoutingModule {}
```

- [ ] **Step 4: Verify backend builds and starts**

```bash
docker compose up -d --build backend
docker compose logs backend --tail=20
```

Expected: `Nest application successfully started`.

- [ ] **Step 5: Smoke test the new endpoints**

```bash
# Get a token first (replace with real credentials)
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"password"}' | jq -r .accessToken)

# List routing rules (should return empty array)
curl -s http://localhost:4000/routing-rules \
  -H "Authorization: Bearer $TOKEN" | jq .

# List SLA policies (should return empty array)
curl -s http://localhost:4000/sla-policies \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: both return `[]`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/routing/routing.listener.ts backend/src/modules/routing/routing.controller.ts backend/src/modules/routing/routing.module.ts
git commit -m "feat: add RoutingModule with listener, controller, and event-driven auto-assignment"
```

---

## Task 8: RoutingService unit tests

**Files:**
- Create: `backend/src/modules/routing/routing.service.spec.ts`

- [ ] **Step 1: Write the test file**

```typescript
// backend/src/modules/routing/routing.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Channel, Priority, TicketStatus } from '@prisma/client';
import { RoutingService } from './routing.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  routingRule: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    $transaction: jest.fn(),
  },
  ticket: { update: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};

describe('RoutingService', () => {
  let service: RoutingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<RoutingService>(RoutingService);
    jest.clearAllMocks();
  });

  const baseTicket = {
    id: 'ticket-1',
    title: 'Login broken',
    description: 'Cannot log in',
    category: 'Auth',
    sourceChannel: Channel.WEB,
    priority: Priority.HIGH,
    status: TicketStatus.NEW,
    createdById: 'user-1',
  };

  describe('applyRules', () => {
    it('assigns ticket to agent when first rule matches', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          priorityOrder: 1,
          isActive: true,
          conditions: [{ field: 'category', operator: 'eq', value: 'Auth' }],
          assignToAgentId: 'agent-1',
          assignToTeamId: null,
        },
      ]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.applyRules(baseTicket);

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ticket-1' },
          data: expect.objectContaining({ assignedToId: 'agent-1', status: TicketStatus.ASSIGNED }),
        }),
      );
    });

    it('stops at first matching rule and skips subsequent rules', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1', priorityOrder: 1, isActive: true,
          conditions: [{ field: 'category', operator: 'eq', value: 'Auth' }],
          assignToAgentId: 'agent-1', assignToTeamId: null,
        },
        {
          id: 'rule-2', priorityOrder: 2, isActive: true,
          conditions: [{ field: 'channel', operator: 'eq', value: 'WEB' }],
          assignToAgentId: 'agent-2', assignToTeamId: null,
        },
      ]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.applyRules(baseTicket);

      const updateCalls = mockPrisma.ticket.update.mock.calls;
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0][0].data.assignedToId).toBe('agent-1');
    });

    it('leaves ticket unassigned when no rule matches', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1', priorityOrder: 1, isActive: true,
          conditions: [{ field: 'category', operator: 'eq', value: 'Networking' }],
          assignToAgentId: 'agent-1', assignToTeamId: null,
        },
      ]);

      await service.applyRules(baseTicket);

      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });

    it('skips inactive rules', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([]);

      await service.applyRules(baseTicket);

      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });

    it('matches keyword in ticket title with contains operator', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1', priorityOrder: 1, isActive: true,
          conditions: [{ field: 'keyword', operator: 'contains', value: 'login' }],
          assignToAgentId: 'agent-1', assignToTeamId: null,
        },
      ]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.applyRules({ ...baseTicket, title: 'Login broken', description: 'nothing' });

      expect(mockPrisma.ticket.update).toHaveBeenCalled();
    });

    it('matches keyword in ticket description with contains operator', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1', priorityOrder: 1, isActive: true,
          conditions: [{ field: 'keyword', operator: 'contains', value: 'vpn' }],
          assignToAgentId: 'agent-1', assignToTeamId: null,
        },
      ]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.applyRules({ ...baseTicket, title: 'Network issue', description: 'VPN connection fails' });

      expect(mockPrisma.ticket.update).toHaveBeenCalled();
    });

    it('requires ALL conditions to match (AND logic)', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1', priorityOrder: 1, isActive: true,
          conditions: [
            { field: 'category', operator: 'eq', value: 'Auth' },
            { field: 'channel', operator: 'eq', value: 'EMAIL' },
          ],
          assignToAgentId: 'agent-1', assignToTeamId: null,
        },
      ]);

      // category matches but channel does not
      await service.applyRules({ ...baseTicket, sourceChannel: Channel.WEB });

      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.routingRule.findUnique.mockResolvedValue(null);
      await expect(service.update('bad', { isActive: false })).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
docker compose exec backend npm test -- --testPathPattern=routing.service.spec
```

Expected: 8 tests pass.

- [ ] **Step 3: Run all backend tests**

```bash
docker compose exec backend npm test
```

Expected: all test suites pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/routing/routing.service.spec.ts
git commit -m "test: add RoutingService unit tests"
```

---

## Task 9: Frontend — admin nav + index page

**Files:**
- Modify: `frontend/src/app/(app)/layout.tsx`
- Create: `frontend/src/app/(app)/admin/page.tsx`

- [ ] **Step 1: Update layout.tsx to show Admin link for ADMIN/MANAGER**

Replace the full file:

```typescript
// frontend/src/app/(app)/layout.tsx
'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect } from 'react';

const BASE_NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/tickets', label: 'Tickets' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/login');
  }, [status, router]);

  if (status === 'loading') {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' }}>Loading…</div>;
  }
  if (!session) return null;

  const role = (session.user as any)?.role ?? '';
  const nav = ['ADMIN', 'MANAGER'].includes(role)
    ? [...BASE_NAV, { href: '/admin', label: 'Admin' }]
    : BASE_NAV;

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
          <div style={{ fontSize: 13, marginBottom: 8, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.user?.email}</div>
          <button
            onClick={() => signOut({ callbackUrl: '/auth/login' })}
            style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13, width: '100%' }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <main style={{ flex: 1, padding: 32, overflow: 'auto' }}>{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Create admin index page**

```typescript
// frontend/src/app/(app)/admin/page.tsx
'use client';

import Link from 'next/link';

export default function AdminPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Admin</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>Configure routing rules and SLA policies.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 640 }}>
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
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/(app)/layout.tsx frontend/src/app/(app)/admin/
git commit -m "feat: add admin nav link and admin index page"
```

---

## Task 10: Frontend — Routing Rules admin page

**Files:**
- Create: `frontend/src/app/(app)/admin/routing-rules/page.tsx`

- [ ] **Step 1: Create the routing rules page**

```typescript
// frontend/src/app/(app)/admin/routing-rules/page.tsx
'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

interface Condition { field: string; operator: string; value: string }
interface RoutingRule {
  id: string; priorityOrder: number; conditions: Condition[];
  assignToAgentId: string | null; assignToAgent: { id: string; name: string } | null;
  assignToTeamId: string | null; assignToTeam: { id: string; name: string } | null;
  isActive: boolean;
}
interface Agent { id: string; name: string; email: string }

const FIELDS = ['category', 'channel', 'keyword'];
const OPERATORS: Record<string, string[]> = {
  category: ['eq'], channel: ['eq'], keyword: ['contains'],
};
const emptyCondition = (): Condition => ({ field: 'category', operator: 'eq', value: '' });
const emptyForm = () => ({ priorityOrder: 1, conditions: [emptyCondition()], assignToAgentId: '', assignToTeamId: '', isActive: true });

export default function RoutingRulesPage() {
  const { data: session } = useSession();
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  async function load() {
    const [rRes, aRes] = await Promise.all([
      fetch('/api/backend/routing-rules', { headers: authHeaders() }),
      fetch('/api/backend/users/agents', { headers: authHeaders() }),
    ]);
    if (rRes.ok) setRules(await rRes.json());
    if (aRes.ok) setAgents(await aRes.json());
  }

  useEffect(() => { if (session) load(); }, [session]);

  function conditionSummary(conditions: Condition[]) {
    return conditions.map(c => `${c.field} ${c.operator === 'eq' ? '=' : 'contains'} "${c.value}"`).join(' AND ');
  }

  function assigneeName(rule: RoutingRule) {
    if (rule.assignToAgent) return `Agent: ${rule.assignToAgent.name}`;
    if (rule.assignToTeam) return `Team: ${rule.assignToTeam.name}`;
    return '—';
  }

  async function moveRule(rule: RoutingRule, direction: 'up' | 'down') {
    const sorted = [...rules].sort((a, b) => a.priorityOrder - b.priorityOrder);
    const idx = sorted.findIndex(r => r.id === rule.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const updated = sorted.map((r, i) => {
      if (i === idx) return { id: r.id, priorityOrder: sorted[swapIdx].priorityOrder };
      if (i === swapIdx) return { id: r.id, priorityOrder: sorted[idx].priorityOrder };
      return { id: r.id, priorityOrder: r.priorityOrder };
    });

    await fetch('/api/backend/routing-rules/reorder', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ rules: updated }),
    });
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this routing rule?')) return;
    await fetch(`/api/backend/routing-rules/${id}`, { method: 'DELETE', headers: authHeaders() });
    await load();
  }

  function handleEdit(rule: RoutingRule) {
    setEditId(rule.id);
    setForm({
      priorityOrder: rule.priorityOrder,
      conditions: rule.conditions.length > 0 ? rule.conditions : [emptyCondition()],
      assignToAgentId: rule.assignToAgentId ?? '',
      assignToTeamId: rule.assignToTeamId ?? '',
      isActive: rule.isActive,
    });
    setShowForm(true);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const body = {
      priorityOrder: form.priorityOrder,
      conditions: form.conditions,
      assignToAgentId: form.assignToAgentId || undefined,
      assignToTeamId: form.assignToTeamId || undefined,
      isActive: form.isActive,
    };
    const url = editId ? `/api/backend/routing-rules/${editId}` : '/api/backend/routing-rules';
    const method = editId ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    if (!res.ok) { setError('Failed to save rule.'); return; }
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm());
    await load();
  }

  function updateCondition(idx: number, field: keyof Condition, value: string) {
    setForm(f => {
      const conditions = f.conditions.map((c, i) => {
        if (i !== idx) return c;
        const updated = { ...c, [field]: value };
        if (field === 'field') updated.operator = (OPERATORS[value] || ['eq'])[0];
        return updated;
      });
      return { ...f, conditions };
    });
  }

  const sorted = [...rules].sort((a, b) => a.priorityOrder - b.priorityOrder);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>Routing Rules</h1>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setForm(emptyForm()); setError(''); }}
          style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 14 }}
        >
          {showForm ? 'Cancel' : 'New Rule'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{editId ? 'Edit Rule' : 'New Rule'}</h2>
          {error && <div style={{ color: '#ef4444', marginBottom: 12 }}>{error}</div>}

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Priority Order</label>
            <input type="number" min={1} value={form.priorityOrder}
              onChange={e => setForm(f => ({ ...f, priorityOrder: Number(e.target.value) }))}
              style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: 80 }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Conditions (ALL must match)</label>
            {form.conditions.map((c, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select value={c.field} onChange={e => updateCondition(idx, 'field', e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px' }}>
                  {FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select value={c.operator} onChange={e => updateCondition(idx, 'operator', e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px' }}>
                  {(OPERATORS[c.field] || ['eq']).map(op => <option key={op} value={op}>{op}</option>)}
                </select>
                <input value={c.value} onChange={e => updateCondition(idx, 'value', e.target.value)}
                  placeholder="value" style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px', flex: 1 }} />
                {form.conditions.length > 1 && (
                  <button type="button" onClick={() => setForm(f => ({ ...f, conditions: f.conditions.filter((_, i) => i !== idx) }))}
                    style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setForm(f => ({ ...f, conditions: [...f.conditions, emptyCondition()] }))}
              style={{ fontSize: 13, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              + Add condition
            </button>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Assign to Agent</label>
            <select value={form.assignToAgentId} onChange={e => setForm(f => ({ ...f, assignToAgentId: e.target.value }))}
              style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px', minWidth: 200 }}>
              <option value="">— None —</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
              Active
            </label>
          </div>

          <button type="submit" style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer' }}>
            Save Rule
          </button>
        </form>
      )}

      {sorted.length === 0 ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>No routing rules yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              {['Order', 'Conditions', 'Assigned To', 'Active', 'Actions'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((rule, idx) => (
              <tr key={rule.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button onClick={() => moveRule(rule, 'up')} disabled={idx === 0}
                      style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#cbd5e1' : '#64748b', fontSize: 12 }}>▲</button>
                    <span style={{ textAlign: 'center', fontSize: 13 }}>{rule.priorityOrder}</span>
                    <button onClick={() => moveRule(rule, 'down')} disabled={idx === sorted.length - 1}
                      style={{ background: 'none', border: 'none', cursor: idx === sorted.length - 1 ? 'default' : 'pointer', color: idx === sorted.length - 1 ? '#cbd5e1' : '#64748b', fontSize: 12 }}>▼</button>
                  </div>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{conditionSummary(rule.conditions)}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{assigneeName(rule)}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: rule.isActive ? '#dcfce7' : '#f1f5f9', color: rule.isActive ? '#166534' : '#64748b' }}>
                    {rule.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <button onClick={() => handleEdit(rule)}
                    style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13, marginRight: 8 }}>Edit</button>
                  <button onClick={() => handleDelete(rule.id)}
                    style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: '#ef4444' }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/(app)/admin/routing-rules/
git commit -m "feat: add routing rules admin page"
```

---

## Task 11: Frontend — SLA Policies admin page

**Files:**
- Create: `frontend/src/app/(app)/admin/sla-policies/page.tsx`

- [ ] **Step 1: Create the SLA policies page**

```typescript
// frontend/src/app/(app)/admin/sla-policies/page.tsx
'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

interface SlaPolicy {
  id: string; name: string; priorityLevel: string;
  responseTimeMinutes: number; resolutionTimeMinutes: number;
  breachAction: string; escalateToUserId: string | null; escalateToTeamId: string | null;
}
interface Agent { id: string; name: string; email: string }

const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const BREACH_ACTIONS = ['FLAG', 'ESCALATE', 'BOTH'];
const PRIORITY_COLOR: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#10b981' };

const emptyForm = (priority: string) => ({
  name: `${priority} SLA`, priorityLevel: priority,
  responseTimeMinutes: 60, resolutionTimeMinutes: 480,
  breachAction: 'FLAG', escalateToUserId: '', escalateToTeamId: '',
});

export default function SlaPoliciesPage() {
  const { data: session } = useSession();
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editPriority, setEditPriority] = useState<string | null>(null);
  const [form, setForm] = useState<ReturnType<typeof emptyForm> | null>(null);
  const [error, setError] = useState('');

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  async function load() {
    const [pRes, aRes] = await Promise.all([
      fetch('/api/backend/sla-policies', { headers: authHeaders() }),
      fetch('/api/backend/users/agents', { headers: authHeaders() }),
    ]);
    if (pRes.ok) setPolicies(await pRes.json());
    if (aRes.ok) setAgents(await aRes.json());
  }

  useEffect(() => { if (session) load(); }, [session]);

  function startEdit(priority: string) {
    const existing = policies.find(p => p.priorityLevel === priority);
    setEditPriority(priority);
    setForm(existing
      ? { name: existing.name, priorityLevel: existing.priorityLevel, responseTimeMinutes: existing.responseTimeMinutes, resolutionTimeMinutes: existing.resolutionTimeMinutes, breachAction: existing.breachAction, escalateToUserId: existing.escalateToUserId ?? '', escalateToTeamId: existing.escalateToTeamId ?? '' }
      : emptyForm(priority));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError('');
    const existing = policies.find(p => p.priorityLevel === form.priorityLevel);
    const body = {
      ...form,
      escalateToUserId: form.escalateToUserId || undefined,
      escalateToTeamId: form.escalateToTeamId || undefined,
    };
    const url = existing ? `/api/backend/sla-policies/${existing.id}` : '/api/backend/sla-policies';
    const method = existing ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    if (!res.ok) { setError('Failed to save policy.'); return; }
    setEditPriority(null);
    setForm(null);
    await load();
  }

  const showEscalation = form && (form.breachAction === 'ESCALATE' || form.breachAction === 'BOTH');

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>SLA Policies</h1>
      <p style={{ color: '#64748b', marginBottom: 24 }}>Configure response and resolution deadlines per priority level.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {PRIORITIES.map(priority => {
          const policy = policies.find(p => p.priorityLevel === priority);
          const isEditing = editPriority === priority;

          return (
            <div key={priority} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isEditing ? 16 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: PRIORITY_COLOR[priority] + '20', color: PRIORITY_COLOR[priority] }}>{priority}</span>
                  {policy && !isEditing && (
                    <span style={{ fontSize: 13, color: '#374151' }}>
                      Response: <strong>{policy.responseTimeMinutes}min</strong> · Resolution: <strong>{policy.resolutionTimeMinutes}min</strong> · On breach: <strong>{policy.breachAction}</strong>
                    </span>
                  )}
                  {!policy && !isEditing && <span style={{ fontSize: 13, color: '#94a3b8' }}>Not configured</span>}
                </div>
                <button onClick={() => isEditing ? (setEditPriority(null), setForm(null)) : startEdit(priority)}
                  style={{ fontSize: 13, background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', color: isEditing ? '#64748b' : '#3b82f6' }}>
                  {isEditing ? 'Cancel' : (policy ? 'Edit' : 'Add')}
                </button>
              </div>

              {isEditing && form && (
                <form onSubmit={handleSubmit}>
                  {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4, color: '#64748b' }}>Name</label>
                      <input value={form.name} onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))}
                        style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: '100%', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4, color: '#64748b' }}>Response (min)</label>
                      <input type="number" min={1} value={form.responseTimeMinutes}
                        onChange={e => setForm(f => f && ({ ...f, responseTimeMinutes: Number(e.target.value) }))}
                        style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: '100%', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4, color: '#64748b' }}>Resolution (min)</label>
                      <input type="number" min={1} value={form.resolutionTimeMinutes}
                        onChange={e => setForm(f => f && ({ ...f, resolutionTimeMinutes: Number(e.target.value) }))}
                        style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: '100%', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4, color: '#64748b' }}>On Breach</label>
                      <select value={form.breachAction} onChange={e => setForm(f => f && ({ ...f, breachAction: e.target.value }))}
                        style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: '100%' }}>
                        {BREACH_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    {showEscalation && (
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4, color: '#64748b' }}>Escalate To (Agent)</label>
                        <select value={form.escalateToUserId} onChange={e => setForm(f => f && ({ ...f, escalateToUserId: e.target.value }))}
                          style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 10px', width: '100%' }}>
                          <option value="">— None —</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  <button type="submit" style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14 }}>
                    Save Policy
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/(app)/admin/sla-policies/
git commit -m "feat: add SLA policies admin page"
```

---

## Task 12: Frontend component tests

**Files:**
- Create: `frontend/src/app/(app)/admin/routing-rules/page.test.tsx`
- Create: `frontend/src/app/(app)/admin/sla-policies/page.test.tsx`

- [ ] **Step 1: Create routing rules page test**

```typescript
// frontend/src/app/(app)/admin/routing-rules/page.test.tsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoutingRulesPage from './page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/admin/routing-rules',
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));

import { useSession } from 'next-auth/react';

const adminSession = { accessToken: 'tok', user: { role: 'ADMIN', email: 'admin@test.com' } };

const mockRules = [
  { id: 'rule-1', priorityOrder: 1, isActive: true, conditions: [{ field: 'category', operator: 'eq', value: 'Auth' }], assignToAgentId: 'a1', assignToAgent: { id: 'a1', name: 'Alice' }, assignToTeamId: null, assignToTeam: null },
];

beforeEach(() => {
  (useSession as jest.Mock).mockReturnValue({ data: adminSession });
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/users/agents')) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 'a1', name: 'Alice', email: 'alice@test.com' }]) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRules) });
  });
});

it('renders routing rules table with rule data', async () => {
  render(<RoutingRulesPage />);
  await waitFor(() => expect(screen.getByText(/category = "Auth"/)).toBeInTheDocument());
  expect(screen.getByText(/Agent: Alice/)).toBeInTheDocument();
});

it('shows New Rule form when button clicked', async () => {
  render(<RoutingRulesPage />);
  await waitFor(() => screen.getByText('New Rule'));
  await userEvent.click(screen.getByText('New Rule'));
  expect(screen.getByText('New Rule', { selector: 'h2' })).toBeInTheDocument();
});

it('calls DELETE endpoint when Delete button clicked and confirmed', async () => {
  window.confirm = jest.fn(() => true);
  render(<RoutingRulesPage />);
  await waitFor(() => screen.getByText('Delete'));
  await userEvent.click(screen.getByText('Delete'));
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/routing-rules/rule-1'),
    expect.objectContaining({ method: 'DELETE' }),
  );
});
```

- [ ] **Step 2: Create SLA policies page test**

```typescript
// frontend/src/app/(app)/admin/sla-policies/page.test.tsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SlaPoliciesPage from './page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/admin/sla-policies',
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));

import { useSession } from 'next-auth/react';

const adminSession = { accessToken: 'tok', user: { role: 'ADMIN', email: 'admin@test.com' } };

const mockPolicies = [
  { id: 'pol-1', name: 'Critical SLA', priorityLevel: 'CRITICAL', responseTimeMinutes: 30, resolutionTimeMinutes: 240, breachAction: 'FLAG', escalateToUserId: null, escalateToTeamId: null },
];

beforeEach(() => {
  (useSession as jest.Mock).mockReturnValue({ data: adminSession });
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/users/agents')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockPolicies) });
  });
});

it('renders all four priority rows', async () => {
  render(<SlaPoliciesPage />);
  await waitFor(() => expect(screen.getByText('CRITICAL')).toBeInTheDocument());
  expect(screen.getByText('HIGH')).toBeInTheDocument();
  expect(screen.getByText('MEDIUM')).toBeInTheDocument();
  expect(screen.getByText('LOW')).toBeInTheDocument();
});

it('shows policy details for configured priority', async () => {
  render(<SlaPoliciesPage />);
  await waitFor(() => expect(screen.getByText(/30min/)).toBeInTheDocument());
  expect(screen.getByText(/240min/)).toBeInTheDocument();
});

it('shows Add button for unconfigured priorities', async () => {
  render(<SlaPoliciesPage />);
  await waitFor(() => screen.getByText('CRITICAL'));
  const addButtons = screen.getAllByText('Add');
  expect(addButtons.length).toBe(3); // HIGH, MEDIUM, LOW have no policy
});

it('shows edit form when Edit clicked', async () => {
  render(<SlaPoliciesPage />);
  await waitFor(() => screen.getByText('Edit'));
  await userEvent.click(screen.getByText('Edit'));
  expect(screen.getByText('Save Policy')).toBeInTheDocument();
});
```

- [ ] **Step 3: Install @testing-library/user-event if not already present**

Check `frontend/package.json` for `@testing-library/user-event`. If missing:
```bash
docker compose exec frontend npm install --save-dev @testing-library/user-event
```

- [ ] **Step 4: Run the tests**

```bash
docker compose exec frontend npm test -- --watchAll=false --testPathPattern=admin
```

Expected: 7 tests pass (3 routing rules + 4 SLA policies).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/(app)/admin/
git commit -m "test: add frontend component tests for routing rules and SLA policies admin pages"
```

---

## Task 13: Final verification + README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run all backend tests**

```bash
docker compose exec backend npm test
```

Expected: all test suites pass.

- [ ] **Step 2: Run all frontend tests**

```bash
docker compose exec frontend npm test -- --watchAll=false
```

Expected: all test suites pass (including new admin page tests).

- [ ] **Step 3: Update README.md Build Status**

Find the Build Status table and change:
```
| Phase 3 | Routing rules engine, SLA policies, breach detection, escalation triggers | 🔜 Planned |
```
to:
```
| Phase 3 | Routing rules engine, SLA policies, breach detection, configurable escalation, admin UI | ✅ Complete |
```

Also update the API Reference section to add the new endpoints:

Under "### User endpoints (protected)", add a new section:

```markdown
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
```

- [ ] **Step 4: Commit and push**

```bash
git add README.md
git commit -m "docs: mark Phase 3 complete, add routing rules and SLA policy API reference"
git push origin master
```

Expected: push succeeds.
