# Phase 2 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the four gaps left after the initial Phase 2 build: filter/search on the ticket list, agent assignment UI, file attachments via MinIO, and unit tests for backend and frontend.

**Architecture:** Separate `AttachmentsModule` wraps MinIO (its own error surface warrants isolation); filtering/search/assignment extend existing `TicketsModule` in-place; a minimal `UsersModule` exposes `GET /users/agents` for assignee dropdowns.

**Tech Stack:** NestJS 10, Prisma 5, `minio` npm package, Multer (bundled with `@nestjs/platform-express`), Next.js 14 App Router, React Testing Library, Jest/ts-jest.

---

## File Map

**Backend — new files**
- `backend/src/modules/users/users.module.ts`
- `backend/src/modules/users/users.service.ts`
- `backend/src/modules/users/users.controller.ts`
- `backend/src/modules/tickets/dto/find-tickets-query.dto.ts`
- `backend/src/modules/attachments/attachments.constants.ts`
- `backend/src/modules/attachments/attachments.module.ts`
- `backend/src/modules/attachments/attachments.service.ts`
- `backend/src/modules/attachments/attachments.controller.ts`
- `backend/src/modules/tickets/tickets.service.spec.ts`
- `backend/src/modules/attachments/attachments.service.spec.ts`

**Backend — modified files**
- `backend/package.json` — add `minio`; add `@types/multer` to devDependencies
- `backend/src/modules/tickets/tickets.service.ts` — update `findAll()`, `update()`
- `backend/src/modules/tickets/tickets.controller.ts` — add `@Query()` to `findAll`
- `backend/src/app.module.ts` — import `UsersModule`, `AttachmentsModule`

**Frontend — modified files**
- `frontend/src/app/(app)/tickets/page.tsx` — full rewrite with filters, pagination, quick-assign
- `frontend/src/app/(app)/tickets/[id]/page.tsx` — add assignment dropdown + attachments card
- `frontend/src/app/(app)/tickets/new/page.tsx` — add file attachments

**Frontend — new files**
- `frontend/src/app/(app)/tickets/page.test.tsx`
- `frontend/src/app/(app)/tickets/[id]/page.test.tsx`
- `frontend/src/app/(app)/tickets/new/page.test.tsx`

---

## Task 1: Add backend npm dependencies

**Files:** `backend/package.json`

- [ ] **Step 1: Add minio and @types/multer to package.json**

Edit `backend/package.json`. In `"dependencies"` add:
```json
"minio": "^8.0.0"
```
In `"devDependencies"` add:
```json
"@types/multer": "^1.4.0"
```

- [ ] **Step 2: Install inside the running container**

```bash
docker compose exec backend npm install
```

Expected: resolves `minio` and `@types/multer` without error.

- [ ] **Step 3: Verify minio resolves**

```bash
docker compose exec backend node -e "const minio = require('minio'); console.log('ok', typeof minio.Client)"
```

Expected: `ok function`

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add minio and @types/multer to backend deps"
```

---

## Task 2: UsersModule — GET /users/agents

**Files:** create `users.module.ts`, `users.service.ts`, `users.controller.ts`; modify `app.module.ts`

- [ ] **Step 1: Create users.service.ts**

`backend/src/modules/users/users.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAgents() {
    return this.prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.MANAGER, Role.AGENT] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }
}
```

- [ ] **Step 2: Create users.controller.ts**

`backend/src/modules/users/users.controller.ts`:
```typescript
import { Controller, Get, Request, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { Role } from '@prisma/client';

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('agents')
  findAgents(@Request() req: { user: { id: string; role: Role } }) {
    if (req.user.role === Role.END_USER) throw new ForbiddenException();
    return this.users.findAgents();
  }
}
```

- [ ] **Step 3: Create users.module.ts**

`backend/src/modules/users/users.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 4: Import UsersModule in app.module.ts**

`backend/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    PrismaModule,
    AuthModule,
    TicketsModule,
    UsersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
```

- [ ] **Step 5: Smoke-test the endpoint**

```bash
# First get a token (replace with actual admin credentials)
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@servicedesk.local","password":"Admin1234!"}' | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).accessToken)")

curl -s http://localhost:4000/users/agents \
  -H "Authorization: Bearer $TOKEN" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d))"
```

Expected: JSON array (may be empty if only one user exists).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/users/ backend/src/app.module.ts
git commit -m "feat: add UsersModule with GET /users/agents endpoint"
```

---

## Task 3: TicketsModule — filtering, search, pagination

**Files:** create `find-tickets-query.dto.ts`; modify `tickets.service.ts`, `tickets.controller.ts`

- [ ] **Step 1: Create FindTicketsQueryDto**

`backend/src/modules/tickets/dto/find-tickets-query.dto.ts`:
```typescript
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Priority, TicketStatus } from '@prisma/client';

export class FindTicketsQueryDto {
  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @IsEnum(Priority)
  @IsOptional()
  priority?: Priority;

  @IsString()
  @IsOptional()
  search?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;
}
```

- [ ] **Step 2: Update TicketsService.findAll()**

Replace the existing `findAll` method in `backend/src/modules/tickets/tickets.service.ts`.

First add these imports at the top (the existing import line is `import { Role, TicketStatus } from '@prisma/client';`):
```typescript
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { FindTicketsQueryDto } from './dto/find-tickets-query.dto';
import { Prisma, Role, TicketStatus } from '@prisma/client';
```

Replace the `findAll` method:
```typescript
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
```

- [ ] **Step 3: Update TicketsService.update() for assignment guard**

Replace the existing `update` method in `tickets.service.ts`:
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
```

- [ ] **Step 4: Update TicketsController.findAll()**

Replace `tickets.controller.ts` entirely:
```typescript
import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { FindTicketsQueryDto } from './dto/find-tickets-query.dto';
import { Role } from '@prisma/client';

type RequestUser = { id: string; role: Role };

@Controller('tickets')
export class TicketsController {
  constructor(private tickets: TicketsService) {}

  @Post()
  create(@Body() dto: CreateTicketDto, @Request() req: { user: RequestUser }) {
    return this.tickets.create(dto, req.user.id);
  }

  @Get()
  findAll(@Request() req: { user: RequestUser }, @Query() query: FindTicketsQueryDto) {
    return this.tickets.findAll(req.user, query);
  }

  @Get('stats')
  getStats() {
    return this.tickets.getStats();
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.tickets.findOne(id, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @Request() req: { user: RequestUser }) {
    return this.tickets.update(id, dto, req.user);
  }

  @Post(':id/comments')
  addComment(@Param('id') ticketId: string, @Body() dto: CreateCommentDto, @Request() req: { user: RequestUser }) {
    return this.tickets.addComment(ticketId, dto, req.user);
  }
}
```

- [ ] **Step 5: Smoke-test filtering**

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@servicedesk.local","password":"Admin1234!"}' | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).accessToken)")

curl -s "http://localhost:4000/tickets?status=NEW&page=1&limit=5" \
  -H "Authorization: Bearer $TOKEN" | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const r=JSON.parse(d);console.log('total:',r.total,'data len:',r.data?.length)"
```

Expected: `total: <number> data len: <0–5>`

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/tickets/
git commit -m "feat: add filtering, search, pagination and assignment guard to TicketsModule"
```

---

## Task 4: AttachmentsModule

**Files:** create `attachments.constants.ts`, `attachments.module.ts`, `attachments.service.ts`, `attachments.controller.ts`; modify `app.module.ts`

- [ ] **Step 1: Create attachments.constants.ts**

`backend/src/modules/attachments/attachments.constants.ts`:
```typescript
export const MINIO_CLIENT = 'MINIO_CLIENT';
export const MINIO_BUCKET_DEFAULT = 'servicedesk-attachments';
export const PRESIGNED_EXPIRY_SECONDS = 3600;
```

- [ ] **Step 2: Create attachments.service.ts**

`backend/src/modules/attachments/attachments.service.ts`:
```typescript
import { Injectable, Inject, NotFoundException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MINIO_CLIENT, MINIO_BUCKET_DEFAULT, PRESIGNED_EXPIRY_SECONDS } from './attachments.constants';

type RequestUser = { id: string; role: Role };

@Injectable()
export class AttachmentsService {
  constructor(
    private prisma: PrismaService,
    @Inject(MINIO_CLIENT) private minio: Minio.Client,
    private config: ConfigService,
  ) {}

  private get bucket() {
    return this.config.get<string>('MINIO_BUCKET', MINIO_BUCKET_DEFAULT);
  }

  async upload(ticketId: string, user: RequestUser, file: Express.Multer.File) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();

    const key = `tickets/${ticketId}/${crypto.randomUUID()}-${file.originalname}`;

    try {
      await this.minio.putObject(this.bucket, key, file.buffer, file.size, {
        'Content-Type': file.mimetype,
      });
    } catch {
      throw new ServiceUnavailableException('File storage unavailable');
    }

    return this.prisma.attachment.create({
      data: {
        ticketId,
        filename: file.originalname,
        mimeType: file.mimetype,
        storagePath: key,
        uploadedById: user.id,
      },
    });
  }

  async findByTicket(ticketId: string, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();

    const attachments = await this.prisma.attachment.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      attachments.map(async (a) => ({
        ...a,
        downloadUrl: await this.minio.presignedGetObject(this.bucket, a.storagePath, PRESIGNED_EXPIRY_SECONDS),
      })),
    );
  }

  getPresignedUrl(key: string): Promise<string> {
    return this.minio.presignedGetObject(this.bucket, key, PRESIGNED_EXPIRY_SECONDS);
  }
}
```

- [ ] **Step 3: Create attachments.controller.ts**

`backend/src/modules/attachments/attachments.controller.ts`:
```typescript
import { Controller, Get, Post, Param, Request, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { AttachmentsService } from './attachments.service';

type RequestUser = { id: string; role: Role };

@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private attachments: AttachmentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  upload(
    @Param('ticketId') ticketId: string,
    @Request() req: { user: RequestUser },
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.attachments.upload(ticketId, req.user, file);
  }

  @Get()
  findByTicket(
    @Param('ticketId') ticketId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.attachments.findByTicket(ticketId, req.user);
  }
}
```

- [ ] **Step 4: Create attachments.module.ts**

`backend/src/modules/attachments/attachments.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { MINIO_CLIENT } from './attachments.constants';

@Module({
  controllers: [AttachmentsController],
  providers: [
    {
      provide: MINIO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const raw = config.get<string>('MINIO_ENDPOINT', 'http://minio:9000');
        const url = new URL(raw);
        return new Minio.Client({
          endPoint: url.hostname,
          port: parseInt(url.port || '9000', 10),
          useSSL: url.protocol === 'https:',
          accessKey: config.get<string>('MINIO_ROOT_USER', 'minioadmin'),
          secretKey: config.get<string>('MINIO_ROOT_PASSWORD', 'minioadmin'),
        });
      },
    },
    AttachmentsService,
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
```

- [ ] **Step 5: Add AttachmentsModule to app.module.ts**

`backend/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    PrismaModule,
    AuthModule,
    TicketsModule,
    UsersModule,
    AttachmentsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Ensure MinIO bucket exists**

The bucket `servicedesk-attachments` must exist. Run once:
```bash
docker compose exec backend node -e "
const Minio = require('minio');
const c = new Minio.Client({ endPoint:'minio', port:9000, useSSL:false, accessKey:'minioadmin', secretKey:'minioadmin' });
c.bucketExists('servicedesk-attachments').then(e => e ? console.log('exists') : c.makeBucket('servicedesk-attachments').then(() => console.log('created')));
"
```

Expected: `exists` or `created`

- [ ] **Step 7: Smoke-test upload**

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@servicedesk.local","password":"Admin1234!"}' | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).accessToken)")

# Get a ticket id first
TICKET_ID=$(curl -s "http://localhost:4000/tickets?limit=1" \
  -H "Authorization: Bearer $TOKEN" | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).data[0]?.id)")

echo "ticket: $TICKET_ID"

curl -s -X POST "http://localhost:4000/tickets/$TICKET_ID/attachments" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/etc/hostname" | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d))"
```

Expected: JSON object with `id`, `filename`, `ticketId`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/attachments/ backend/src/app.module.ts
git commit -m "feat: add AttachmentsModule with MinIO upload/download"
```

---

## Task 5: Backend tests — TicketsService

**Files:** create `backend/src/modules/tickets/tickets.service.spec.ts`

- [ ] **Step 1: Write the tests**

`backend/src/modules/tickets/tickets.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, TicketStatus, Channel } from '@prisma/client';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  ticket: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
  },
  auditLog: { create: jest.fn() },
  comment: { create: jest.fn() },
};

describe('TicketsService', () => {
  let service: TicketsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<TicketsService>(TicketsService);
    jest.clearAllMocks();
  });

  const agent = { id: 'agent-1', role: Role.AGENT };
  const endUser = { id: 'user-1', role: Role.END_USER };

  describe('create', () => {
    it('creates ticket with NEW status and writes audit log', async () => {
      const ticket = { id: 'ticket-1', status: TicketStatus.NEW };
      mockPrisma.ticket.create.mockResolvedValue(ticket);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.create(
        { title: 'T', description: 'D', sourceChannel: Channel.WEB },
        'user-1',
      );

      expect(mockPrisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ createdById: 'user-1', status: TicketStatus.NEW }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'CREATED', actorId: 'user-1', newValue: TicketStatus.NEW }),
        }),
      );
      expect(result).toBe(ticket);
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      mockPrisma.ticket.findMany.mockResolvedValue([]);
      mockPrisma.ticket.count.mockResolvedValue(0);
    });

    it('END_USER sees only own tickets', async () => {
      await service.findAll(endUser, {});
      expect(mockPrisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ createdById: 'user-1' }) }),
      );
    });

    it('AGENT sees all tickets (no createdById filter)', async () => {
      await service.findAll(agent, {});
      const call = mockPrisma.ticket.findMany.mock.calls[0][0];
      expect(call.where.createdById).toBeUndefined();
    });

    it('applies status filter', async () => {
      await service.findAll(agent, { status: TicketStatus.NEW });
      expect(mockPrisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: TicketStatus.NEW }) }),
      );
    });

    it('applies priority filter', async () => {
      await service.findAll(agent, { priority: 'HIGH' as any });
      expect(mockPrisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ priority: 'HIGH' }) }),
      );
    });

    it('applies search on title and description', async () => {
      await service.findAll(agent, { search: 'login' });
      const call = mockPrisma.ticket.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { title: { contains: 'login', mode: 'insensitive' } },
        { description: { contains: 'login', mode: 'insensitive' } },
      ]);
    });

    it('returns paginated shape with correct skip/take', async () => {
      mockPrisma.ticket.findMany.mockResolvedValue([{ id: '1' }]);
      mockPrisma.ticket.count.mockResolvedValue(30);
      const result = await service.findAll(agent, { page: 2, limit: 10 });
      expect(result).toEqual({ data: [{ id: '1' }], total: 30, page: 2, limit: 10 });
      expect(mockPrisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad', agent)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when END_USER accesses another user ticket', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'other', comments: [], auditLogs: [] });
      await expect(service.findOne('t1', endUser)).rejects.toThrow(ForbiddenException);
    });

    it('strips internal comments for END_USER', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        id: 't1', createdById: 'user-1',
        comments: [{ id: 'c1', isInternal: false }, { id: 'c2', isInternal: true }],
        auditLogs: [],
      });
      const result = await service.findOne('t1', endUser);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].id).toBe('c1');
    });

    it('includes internal comments for AGENT', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        id: 't1', createdById: 'user-1',
        comments: [{ id: 'c1', isInternal: false }, { id: 'c2', isInternal: true }],
        auditLogs: [],
      });
      const result = await service.findOne('t1', agent);
      expect(result.comments).toHaveLength(2);
    });
  });

  describe('update', () => {
    const baseTicket = { id: 't1', createdById: 'user-1', status: TicketStatus.NEW, assignedToId: null };

    beforeEach(() => {
      mockPrisma.ticket.findUnique.mockResolvedValue(baseTicket);
      mockPrisma.ticket.update.mockResolvedValue({ ...baseTicket, assignedTo: { name: 'Bob' } });
      mockPrisma.auditLog.create.mockResolvedValue({});
    });

    it('throws ForbiddenException when END_USER tries to assign', async () => {
      await expect(
        service.update('t1', { assignedToId: 'agent-1' }, endUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('writes STATUS_CHANGED audit log on explicit status change', async () => {
      mockPrisma.ticket.update.mockResolvedValue({ ...baseTicket, status: TicketStatus.IN_PROGRESS });
      await service.update('t1', { status: TicketStatus.IN_PROGRESS }, agent);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'STATUS_CHANGED',
            oldValue: TicketStatus.NEW,
            newValue: TicketStatus.IN_PROGRESS,
          }),
        }),
      );
    });

    it('auto-advances status to ASSIGNED when assigning a NEW ticket', async () => {
      await service.update('t1', { assignedToId: 'agent-1' }, agent);
      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: TicketStatus.ASSIGNED }),
        }),
      );
    });

    it('writes ASSIGNED audit log when assignee changes', async () => {
      await service.update('t1', { assignedToId: 'agent-1' }, agent);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'ASSIGNED' }) }),
      );
    });
  });

  describe('addComment', () => {
    beforeEach(() => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'user-1' });
      mockPrisma.comment.create.mockResolvedValue({ id: 'c1' });
    });

    it('forces isInternal to false for END_USER', async () => {
      await service.addComment('t1', { body: 'hi', isInternal: true }, endUser);
      expect(mockPrisma.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isInternal: false }) }),
      );
    });

    it('allows isInternal for AGENT', async () => {
      await service.addComment('t1', { body: 'internal', isInternal: true }, agent);
      expect(mockPrisma.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isInternal: true }) }),
      );
    });
  });

  describe('getStats', () => {
    it('returns total, byStatus, byPriority', async () => {
      mockPrisma.ticket.count.mockResolvedValue(5);
      mockPrisma.ticket.groupBy
        .mockResolvedValueOnce([{ status: 'NEW', _count: { _all: 3 } }])
        .mockResolvedValueOnce([{ priority: 'HIGH', _count: { _all: 2 } }]);
      const result = await service.getStats();
      expect(result.total).toBe(5);
      expect(result.byStatus).toHaveLength(1);
      expect(result.byPriority).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
docker compose exec backend npm test -- --testPathPattern tickets.service.spec
```

Expected: all tests pass (green).

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/tickets/tickets.service.spec.ts
git commit -m "test: add TicketsService unit tests"
```

---

## Task 6: Backend tests — AttachmentsService

**Files:** create `backend/src/modules/attachments/attachments.service.spec.ts`

- [ ] **Step 1: Write the tests**

`backend/src/modules/attachments/attachments.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AttachmentsService } from './attachments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { MINIO_CLIENT, PRESIGNED_EXPIRY_SECONDS } from './attachments.constants';

const mockPrisma = {
  ticket: { findUnique: jest.fn() },
  attachment: { create: jest.fn(), findMany: jest.fn() },
};

const mockMinio = {
  putObject: jest.fn(),
  presignedGetObject: jest.fn(),
};

const mockConfig = { get: jest.fn((_key: string, def?: string) => def) };

describe('AttachmentsService', () => {
  let service: AttachmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MINIO_CLIENT, useValue: mockMinio },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<AttachmentsService>(AttachmentsService);
    jest.clearAllMocks();
  });

  const agent = { id: 'agent-1', role: Role.AGENT };
  const endUser = { id: 'user-1', role: Role.END_USER };
  const mockFile = {
    originalname: 'test.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('data'),
    size: 4,
  } as Express.Multer.File;

  describe('upload', () => {
    it('puts object in MinIO and creates Attachment row', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'agent-1' });
      mockMinio.putObject.mockResolvedValue(undefined);
      const attachment = { id: 'a1', filename: 'test.pdf' };
      mockPrisma.attachment.create.mockResolvedValue(attachment);

      const result = await service.upload('t1', agent, mockFile);

      expect(mockMinio.putObject).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^tickets\/t1\//),
        mockFile.buffer,
        mockFile.size,
        expect.objectContaining({ 'Content-Type': 'application/pdf' }),
      );
      expect(mockPrisma.attachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ticketId: 't1', filename: 'test.pdf', mimeType: 'application/pdf' }),
        }),
      );
      expect(result).toBe(attachment);
    });

    it('throws NotFoundException when ticket does not exist', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(null);
      await expect(service.upload('bad', agent, mockFile)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when END_USER uploads to another user ticket', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'other' });
      await expect(service.upload('t1', endUser, mockFile)).rejects.toThrow(ForbiddenException);
    });

    it('throws ServiceUnavailableException when MinIO fails', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'agent-1' });
      mockMinio.putObject.mockRejectedValue(new Error('connection refused'));
      await expect(service.upload('t1', agent, mockFile)).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('findByTicket', () => {
    it('returns attachments with presigned download URLs', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'agent-1' });
      mockPrisma.attachment.findMany.mockResolvedValue([
        { id: 'a1', storagePath: 'tickets/t1/file.pdf', filename: 'file.pdf' },
      ]);
      mockMinio.presignedGetObject.mockResolvedValue('https://minio/signed');

      const result = await service.findByTicket('t1', agent);

      expect(result).toHaveLength(1);
      expect(result[0].downloadUrl).toBe('https://minio/signed');
      expect(mockPrisma.attachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ticketId: 't1' } }),
      );
    });

    it('returns empty array when ticket has no attachments', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'agent-1' });
      mockPrisma.attachment.findMany.mockResolvedValue([]);
      mockMinio.presignedGetObject.mockResolvedValue('https://minio/signed');
      const result = await service.findByTicket('t1', agent);
      expect(result).toHaveLength(0);
    });
  });

  describe('getPresignedUrl', () => {
    it('calls MinIO with correct key and expiry', async () => {
      mockMinio.presignedGetObject.mockResolvedValue('https://minio/signed');
      const result = await service.getPresignedUrl('tickets/t1/file.pdf');
      expect(mockMinio.presignedGetObject).toHaveBeenCalledWith(
        expect.any(String),
        'tickets/t1/file.pdf',
        PRESIGNED_EXPIRY_SECONDS,
      );
      expect(result).toBe('https://minio/signed');
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
docker compose exec backend npm test -- --testPathPattern attachments.service.spec
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/attachments/attachments.service.spec.ts
git commit -m "test: add AttachmentsService unit tests"
```

---

## Task 7: Frontend — Ticket list (filters, pagination, quick-assign)

**Files:** replace `frontend/src/app/(app)/tickets/page.tsx`

- [ ] **Step 1: Rewrite tickets/page.tsx**

`frontend/src/app/(app)/tickets/page.tsx`:
```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Ticket {
  id: string; title: string; status: string; priority: string;
  category: string | null; sourceChannel: string;
  createdBy: { name: string }; assignedTo: { id: string; name: string } | null;
  createdAt: string;
}
interface TicketPage { data: Ticket[]; total: number; page: number; limit: number }
interface Agent { id: string; name: string }

const STATUS_COLOR: Record<string, string> = { NEW: '#3b82f6', ASSIGNED: '#8b5cf6', IN_PROGRESS: '#f59e0b', PENDING: '#f97316', RESOLVED: '#10b981', CLOSED: '#6b7280' };
const PRIORITY_COLOR: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#10b981' };
const STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export default function TicketsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isAgent = ['ADMIN', 'MANAGER', 'AGENT'].includes((session as any)?.user?.role ?? '');

  const status = searchParams.get('status') ?? '';
  const priority = searchParams.get('priority') ?? '';
  const search = searchParams.get('search') ?? '';
  const page = Number(searchParams.get('page') ?? '1');

  const [result, setResult] = useState<TicketPage>({ data: [], total: 0, page: 1, limit: 25 });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [searchInput, setSearchInput] = useState(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function authHeaders() {
    return { Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value); else p.delete(key);
    if (key !== 'page') p.delete('page');
    router.replace(`${pathname}?${p.toString()}`);
  }

  useEffect(() => {
    const timer = setTimeout(() => setParam('search', searchInput), 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const fetchTickets = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (priority) p.set('priority', priority);
    if (search) p.set('search', search);
    p.set('page', String(page));
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets?${p}`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      setResult(await res.json());
    } catch {
      setError('Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [session, status, priority, search, page]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  useEffect(() => {
    if (!session || !isAgent) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/agents`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setAgents)
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function quickAssign(ticketId: string, assignedToId: string) {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedToId: assignedToId || null }),
    });
    fetchTickets();
  }

  const { data: tickets, total, limit } = result;
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>Tickets</h1>
        <Link href="/tickets/new" style={{ background: '#3b82f6', color: 'white', padding: '10px 20px', borderRadius: 6, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
          + New Ticket
        </Link>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          aria-label="Status"
          value={status}
          onChange={e => setParam('status', e.target.value)}
          style={selectStyle}
        >
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>

        <select
          aria-label="Priority"
          value={priority}
          onChange={e => setParam('priority', e.target.value)}
          style={selectStyle}
        >
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search tickets…"
            style={{ ...selectStyle, width: '100%', paddingRight: searchInput ? 32 : 12 }}
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setParam('search', ''); }}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 16 }}
            >×</button>
          )}
        </div>
      </div>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {loading && <p style={{ color: '#64748b' }}>Loading…</p>}

      {!loading && tickets.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: '#94a3b8' }}>
          <p style={{ fontSize: 18, marginBottom: 16 }}>No tickets found</p>
          {!status && !priority && !search && (
            <Link href="/tickets/new" style={{ color: '#3b82f6' }}>Create your first ticket</Link>
          )}
        </div>
      )}

      {tickets.length > 0 && (
        <>
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  {['Title', 'Status', 'Priority', ...(isAgent ? ['Assignee'] : ['Assigned To']), 'Created', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontWeight: 500, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 500 }}>
                      <div>{t.title}</div>
                      {t.category && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{t.category}</div>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Badge label={t.status.replace('_', ' ')} color={STATUS_COLOR[t.status]} />
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Badge label={t.priority} color={PRIORITY_COLOR[t.priority]} />
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {isAgent ? (
                        <select
                          value={t.assignedTo?.id ?? ''}
                          onChange={e => quickAssign(t.id, e.target.value)}
                          style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 8px', fontSize: 13, color: '#374151', background: 'white' }}
                        >
                          <option value="">— unassigned</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      ) : (
                        t.assignedTo?.name ?? '—'
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <Link href={`/tickets/${t.id}`} style={{ color: '#3b82f6', textDecoration: 'none', fontSize: 13 }}>View →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 13, color: '#64748b' }}>
            <span>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
                style={{ ...paginBtn, opacity: page <= 1 ? 0.4 : 1 }}
              >← Previous</button>
              <button
                disabled={page >= totalPages}
                onClick={() => setParam('page', String(page + 1))}
                style={{ ...paginBtn, opacity: page >= totalPages ? 0.4 : 1 }}
              >Next →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span style={{ background: `${color}18`, color, padding: '3px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>{label}</span>;
}

const selectStyle: React.CSSProperties = { border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#374151', background: 'white', boxSizing: 'border-box' };
const paginBtn: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 14px', background: 'white', cursor: 'pointer', fontSize: 13 };
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/\(app\)/tickets/page.tsx
git commit -m "feat: add filter bar, pagination, and quick-assign to ticket list"
```

---

## Task 8: Frontend — Ticket detail (assignment dropdown + attachments)

**Files:** modify `frontend/src/app/(app)/tickets/[id]/page.tsx`

- [ ] **Step 1: Rewrite tickets/[id]/page.tsx**

`frontend/src/app/(app)/tickets/[id]/page.tsx`:
```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, FormEvent, ChangeEvent } from 'react';

interface Comment { id: string; body: string; isInternal: boolean; createdAt: string; author: { name: string } }
interface AuditLog { id: string; action: string; oldValue: string | null; newValue: string | null; createdAt: string; actor: { name: string } }
interface Attachment { id: string; filename: string; mimeType: string; createdAt: string; downloadUrl: string }
interface Agent { id: string; name: string }
interface Ticket {
  id: string; title: string; description: string; status: string; priority: string;
  category: string | null; sourceChannel: string; createdAt: string; updatedAt: string;
  createdBy: { name: string; email: string };
  assignedTo: { id: string; name: string; email: string } | null;
  team: { name: string } | null;
  comments: Comment[];
  auditLogs: AuditLog[];
}

const STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'];
const STATUS_COLOR: Record<string, string> = { NEW: '#3b82f6', ASSIGNED: '#8b5cf6', IN_PROGRESS: '#f59e0b', PENDING: '#f97316', RESOLVED: '#10b981', CLOSED: '#6b7280' };
const PRIORITY_COLOR: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#10b981' };

export default function TicketDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const isAgent = ['ADMIN', 'MANAGER', 'AGENT'].includes((session as any)?.user?.role ?? '');

  function authHeaders() {
    return { Authorization: `Bearer ${(session as any)?.accessToken}`, 'Content-Type': 'application/json' };
  }

  useEffect(() => {
    if (!session) return;
    const h = { Authorization: `Bearer ${(session as any).accessToken}` };
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}`, { headers: h })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setTicket)
      .catch(() => setError('Ticket not found'));
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}/attachments`, { headers: h })
      .then(r => r.ok ? r.json() : [])
      .then(setAttachments)
      .catch(() => {});
    if (isAgent) {
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/agents`, { headers: h })
        .then(r => r.ok ? r.json() : [])
        .then(setAgents)
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, id]);

  async function updateStatus(status: string) {
    if (!ticket) return;
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status }),
    });
    if (res.ok) setTicket(t => t ? { ...t, status } : t);
  }

  async function updateAssignee(assignedToId: string) {
    if (!ticket) return;
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ assignedToId: assignedToId || null }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTicket(t => t ? { ...t, assignedTo: updated.assignedTo, status: updated.status } : t);
    }
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setSubmitting(true);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}/comments`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ body: commentBody, isInternal }),
    });
    setSubmitting(false);
    if (res.ok) {
      const comment = await res.json();
      setTicket(t => t ? { ...t, comments: [...t.comments, comment] } : t);
      setCommentBody(''); setIsInternal(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setUploadError('');
    if (file && file.size > 10 * 1024 * 1024) {
      setUploadError('File must be 10 MB or smaller');
      setUploadFile(null);
      e.target.value = '';
      return;
    }
    setUploadFile(file);
  }

  async function submitAttachment(e: FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    setUploadError('');
    const form = new FormData();
    form.append('file', uploadFile);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${(session as any)?.accessToken}` },
      body: form,
    });
    setUploading(false);
    if (res.ok) {
      const attachment = await res.json();
      // Re-fetch to get presigned URL
      const listRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${id}/attachments`, {
        headers: { Authorization: `Bearer ${(session as any)?.accessToken}` },
      });
      if (listRes.ok) setAttachments(await listRes.json());
      else setAttachments(a => [...a, attachment]);
      setUploadFile(null);
    } else {
      setUploadError('Upload failed. Try again.');
    }
  }

  if (error) return <div style={{ color: '#ef4444' }}>{error} <button onClick={() => router.back()} style={linkBtn}>← Back</button></div>;
  if (!ticket) return <div style={{ color: '#64748b' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => router.push('/tickets')} style={linkBtn}>← All Tickets</button>
      </div>

      {/* Ticket header */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: '#0f172a', flex: 1 }}>{ticket.title}</h1>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
            <Badge label={ticket.status.replace('_', ' ')} color={STATUS_COLOR[ticket.status]} />
            <Badge label={ticket.priority} color={PRIORITY_COLOR[ticket.priority]} />
          </div>
        </div>

        <p style={{ color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 24 }}>{ticket.description}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, fontSize: 13, color: '#64748b' }}>
          <MetaItem label="Created by" value={ticket.createdBy.name} />
          <MetaItem label="Assigned to" value={ticket.assignedTo?.name ?? '—'} />
          <MetaItem label="Team" value={ticket.team?.name ?? '—'} />
          <MetaItem label="Channel" value={ticket.sourceChannel} />
          {ticket.category && <MetaItem label="Category" value={ticket.category} />}
          <MetaItem label="Created" value={new Date(ticket.createdAt).toLocaleString()} />
        </div>

        {isAgent && (
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #f1f5f9', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginRight: 8 }}>Status:</label>
              <select value={ticket.status} onChange={e => updateStatus(e.target.value)} style={agentSelect}>
                {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginRight: 8 }}>Assigned to:</label>
              <select value={ticket.assignedTo?.id ?? ''} onChange={e => updateAssignee(e.target.value)} style={agentSelect}>
                <option value="">— unassigned</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Comments */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32, marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 20px', fontSize: 16, color: '#0f172a' }}>Comments</h2>
        {ticket.comments.length === 0 && <p style={{ color: '#94a3b8', fontSize: 14 }}>No comments yet.</p>}
        {ticket.comments.map(c => (
          <div key={c.id} style={{ marginBottom: 16, padding: '12px 16px', background: c.isInternal ? '#fefce8' : '#f8fafc', borderRadius: 6, border: `1px solid ${c.isInternal ? '#fde68a' : '#e2e8f0'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{c.author.name}</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                {new Date(c.createdAt).toLocaleString()}
                {c.isInternal && <span style={{ marginLeft: 8, color: '#b45309', fontSize: 11 }}>internal</span>}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap' }}>{c.body}</p>
          </div>
        ))}
        <form onSubmit={submitComment} style={{ marginTop: 20 }}>
          <textarea value={commentBody} onChange={e => setCommentBody(e.target.value)} rows={3} placeholder="Add a comment…" style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '9px 12px', fontSize: 14, boxSizing: 'border-box', resize: 'vertical' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
            {isAgent && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748b', cursor: 'pointer' }}>
                <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />
                Internal note
              </label>
            )}
            <button type="submit" disabled={submitting || !commentBody.trim()} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 13, opacity: submitting || !commentBody.trim() ? 0.6 : 1 }}>
              {submitting ? 'Posting…' : 'Post Comment'}
            </button>
          </div>
        </form>
      </div>

      {/* Attachments */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32, marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 20px', fontSize: 16, color: '#0f172a' }}>Attachments</h2>
        {attachments.length === 0 && <p style={{ color: '#94a3b8', fontSize: 14 }}>No attachments yet.</p>}
        {attachments.map(a => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
            <span style={{ color: '#374151' }}>{a.filename}</span>
            <a href={a.downloadUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', fontSize: 13 }}>Download</a>
          </div>
        ))}
        <form onSubmit={submitAttachment} style={{ marginTop: 16 }}>
          <input type="file" onChange={handleFileChange} style={{ fontSize: 13, marginBottom: 8, display: 'block' }} />
          {uploadError && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{uploadError}</p>}
          <button type="submit" disabled={!uploadFile || uploading} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 13, opacity: !uploadFile || uploading ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : 'Upload File'}
          </button>
        </form>
      </div>

      {/* Activity log */}
      {ticket.auditLogs.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, color: '#0f172a' }}>Activity Log</h2>
          {ticket.auditLogs.map(log => (
            <div key={log.id} style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 13, color: '#64748b' }}>
              <span style={{ color: '#94a3b8', flexShrink: 0 }}>{new Date(log.createdAt).toLocaleString()}</span>
              <span><strong style={{ color: '#374151' }}>{log.actor.name}</strong> {formatAction(log)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatAction(log: AuditLog) {
  if (log.action === 'CREATED') return 'created this ticket';
  if (log.action === 'STATUS_CHANGED') return `changed status from ${log.oldValue} to ${log.newValue}`;
  if (log.action === 'ASSIGNED') return `assigned ticket to ${log.newValue}`;
  return log.action.toLowerCase().replace('_', ' ');
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span style={{ background: `${color}18`, color, padding: '3px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>{label}</span>;
}
function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
      <div style={{ color: '#374151', fontWeight: 500 }}>{value}</div>
    </div>
  );
}

const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0, fontSize: 14 };
const agentSelect: React.CSSProperties = { border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px', fontSize: 13, color: '#0f172a' };
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/\(app\)/tickets/\[id\]/page.tsx
git commit -m "feat: add assignment dropdown and attachments card to ticket detail"
```

---

## Task 9: Frontend — New ticket form (file attachments)

**Files:** modify `frontend/src/app/(app)/tickets/new/page.tsx`

- [ ] **Step 1: Rewrite new/page.tsx**

`frontend/src/app/(app)/tickets/new/page.tsx`:
```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState, ChangeEvent } from 'react';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function NewTicketPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [attachWarning, setAttachWarning] = useState('');

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFileError('');
    const files = Array.from(e.target.files ?? []);
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setFileError(`${oversized.map(f => f.name).join(', ')} exceed${oversized.length === 1 ? 's' : ''} the 10 MB limit`);
      e.target.value = '';
      return;
    }
    setSelectedFiles(files);
  }

  function removeFile(name: string) {
    setSelectedFiles(prev => prev.filter(f => f.name !== name));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session) return;

    const form = new FormData(e.currentTarget);
    const body = {
      title: form.get('title'),
      description: form.get('description'),
      priority: form.get('priority'),
      category: form.get('category') || undefined,
      sourceChannel: 'WEB',
    };

    setLoading(true);
    setError('');
    setAttachWarning('');

    const token = (session as any).accessToken;
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? 'Failed to create ticket');
      return;
    }

    const ticket = await res.json();

    if (selectedFiles.length > 0) {
      let failCount = 0;
      for (const file of selectedFiles) {
        const fd = new FormData();
        fd.append('file', file);
        const uploadRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/tickets/${ticket.id}/attachments`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!uploadRes.ok) failCount++;
      }
      if (failCount > 0) {
        setAttachWarning(`Ticket created, but ${failCount} attachment${failCount > 1 ? 's' : ''} failed to upload.`);
      }
    }

    router.push(`/tickets/${ticket.id}`);
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, color: '#0f172a', marginBottom: 24 }}>New Ticket</h1>

      <form onSubmit={handleSubmit} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 32 }}>
        <Field label="Title" required>
          <input name="title" required maxLength={200} style={inputStyle} placeholder="Brief summary of the issue" />
        </Field>

        <Field label="Description" required>
          <textarea name="description" required rows={6} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Describe the issue in detail" />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Priority">
            <select name="priority" defaultValue="MEDIUM" style={inputStyle}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <input name="category" maxLength={100} style={inputStyle} placeholder="e.g. Hardware, Software" />
          </Field>
        </div>

        <Field label="Attachments">
          <input type="file" multiple onChange={handleFileChange} style={{ fontSize: 13 }} />
          {fileError && <p style={{ color: '#ef4444', fontSize: 13, marginTop: 4 }}>{fileError}</p>}
          {selectedFiles.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 13 }}>
              {selectedFiles.map(f => (
                <li key={f.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#374151' }}>
                  <span>{f.name}</span>
                  <button type="button" onClick={() => removeFile(f.name)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}>×</button>
                </li>
              ))}
            </ul>
          )}
        </Field>

        {error && <p style={{ color: '#ef4444', marginBottom: 16 }}>{error}</p>}
        {attachWarning && <p style={{ color: '#f59e0b', marginBottom: 16 }}>{attachWarning}</p>}

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="submit" disabled={loading || !!fileError} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '10px 24px', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500, opacity: loading || fileError ? 0.7 : 1 }}>
            {loading ? 'Submitting…' : 'Submit Ticket'}
          </button>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: '1px solid #e2e8f0', color: '#64748b', padding: '10px 24px', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
        {label}{required && <span style={{ color: '#ef4444' }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '9px 12px', fontSize: 14, color: '#0f172a', boxSizing: 'border-box', outline: 'none' };
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/\(app\)/tickets/new/page.tsx
git commit -m "feat: add multi-file attachment support to new ticket form"
```

---

## Task 10: Frontend component tests

**Files:** create `page.test.tsx`, `[id]/page.test.tsx`, `new/page.test.tsx`

- [ ] **Step 1: Write ticket list tests**

`frontend/src/app/(app)/tickets/page.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import TicketsPage from './page';

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/tickets',
  useSearchParams: () => mockSearchParams,
}));

import { useSession } from 'next-auth/react';

const agentSession = { accessToken: 'tok', user: { role: 'AGENT' } };
const endUserSession = { accessToken: 'tok', user: { role: 'END_USER' } };

const mockPage = {
  data: [{ id: '1', title: 'Login broken', status: 'NEW', priority: 'HIGH', category: null, sourceChannel: 'WEB', createdBy: { name: 'Alice' }, assignedTo: null, createdAt: '2026-01-01T00:00:00Z' }],
  total: 1, page: 1, limit: 25,
};

beforeEach(() => {
  mockSearchParams = new URLSearchParams();
  mockReplace.mockClear();
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockPage) });
});

it('renders status and priority filter dropdowns', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<TicketsPage />);
  await waitFor(() => expect(screen.getByLabelText('Status')).toBeInTheDocument());
  expect(screen.getByLabelText('Priority')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Search tickets…')).toBeInTheDocument();
});

it('shows ticket title from API response', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<TicketsPage />);
  await waitFor(() => expect(screen.getByText('Login broken')).toBeInTheDocument());
});

it('shows Assignee column header for AGENT', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<TicketsPage />);
  await waitFor(() => expect(screen.getByText('Login broken')).toBeInTheDocument());
  expect(screen.getByText('Assignee')).toBeInTheDocument();
});

it('does not show Assignee column for END_USER', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: endUserSession });
  render(<TicketsPage />);
  await waitFor(() => expect(screen.getByText('Login broken')).toBeInTheDocument());
  expect(screen.queryByText('Assignee')).not.toBeInTheDocument();
});

it('shows pagination info', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<TicketsPage />);
  await waitFor(() => expect(screen.getByText(/Showing 1–1 of 1/)).toBeInTheDocument());
});
```

- [ ] **Step 2: Write ticket detail tests**

`frontend/src/app/(app)/tickets/[id]/page.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import TicketDetailPage from './page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useParams: () => ({ id: 'ticket-1' }),
}));

import { useSession } from 'next-auth/react';

const agentSession = { accessToken: 'tok', user: { role: 'AGENT' } };
const endUserSession = { accessToken: 'tok', user: { role: 'END_USER' } };

const mockTicket = {
  id: 'ticket-1', title: 'VPN broken', description: 'Cannot connect',
  status: 'NEW', priority: 'HIGH', category: null, sourceChannel: 'WEB',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  createdBy: { name: 'Alice', email: 'alice@example.com' },
  assignedTo: null, team: null, comments: [], auditLogs: [],
};

beforeEach(() => {
  (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/attachments')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/users/agents')) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 'a1', name: 'Bob' }]) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTicket) });
  });
});

it('renders ticket title', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<TicketDetailPage />);
  await waitFor(() => expect(screen.getByText('VPN broken')).toBeInTheDocument());
});

it('shows assignment dropdown for AGENT', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<TicketDetailPage />);
  await waitFor(() => expect(screen.getByText('VPN broken')).toBeInTheDocument());
  expect(screen.getByText('Assigned to:')).toBeInTheDocument();
});

it('shows attachment upload input', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<TicketDetailPage />);
  await waitFor(() => expect(screen.getByText('Attachments')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /Upload File/i })).toBeInTheDocument();
});

it('shows empty attachments message when none exist', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: endUserSession });
  render(<TicketDetailPage />);
  await waitFor(() => expect(screen.getByText('No attachments yet.')).toBeInTheDocument());
});
```

- [ ] **Step 3: Write new ticket form tests**

`frontend/src/app/(app)/tickets/new/page.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewTicketPage from './page';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok', user: { role: 'AGENT' } } }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

beforeEach(() => {
  mockPush.mockClear();
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ id: 'new-ticket-1' }),
  });
});

it('renders file input for attachments', () => {
  render(<NewTicketPage />);
  expect(screen.getByText('Attachments')).toBeInTheDocument();
  const fileInput = document.querySelector('input[type="file"]');
  expect(fileInput).toBeInTheDocument();
});

it('submits without attachments using a single fetch call', async () => {
  render(<NewTicketPage />);
  fireEvent.change(screen.getByPlaceholderText('Brief summary of the issue'), { target: { value: 'My issue' } });
  fireEvent.change(screen.getByPlaceholderText('Describe the issue in detail'), { target: { value: 'Details here' } });
  fireEvent.click(screen.getByRole('button', { name: /Submit Ticket/i }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/tickets');
  expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('POST');
});

it('shows attachment file input as multiple', () => {
  render(<NewTicketPage />);
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  expect(fileInput.multiple).toBe(true);
});
```

- [ ] **Step 4: Run all frontend tests**

```bash
docker compose exec frontend npm test -- --passWithNoTests
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(app\)/tickets/
git commit -m "test: add frontend component tests for ticket list, detail, and new form"
```

---

## Task 11: Final verification and README update

- [ ] **Step 1: Run all backend tests**

```bash
docker compose exec backend npm test
```

Expected: all spec files pass.

- [ ] **Step 2: Manual smoke-test in browser**

1. Open http://localhost:3000/tickets — verify filter dropdowns and search input render
2. Change status filter — verify table re-fetches
3. Open a ticket — verify assignment dropdown and Attachments section are present
4. Upload a small file (< 10 MB) — verify it appears in the list with a Download link
5. Open /tickets/new — verify the file input is present; submit a ticket with a file

- [ ] **Step 3: Update README build status**

In `README.md`, change the Phase 2 completion row:
```markdown
| Phase 2 (completion) | Filter + search on ticket list, agent assignment UI, file attachments (MinIO), backend + frontend unit tests | ✅ Complete |
```

- [ ] **Step 4: Commit and push**

```bash
git add README.md
git commit -m "docs: mark Phase 2 completion as done"
git push origin master
```

---

## Self-Review Checklist

**Spec coverage:**
- Filter/search on ticket list → Task 3 (backend DTO + service) + Task 7 (frontend list page) ✓
- Agent assignment UI on list → Task 7 (quick-assign column) ✓
- Agent assignment UI on detail → Task 8 (assignment dropdown) ✓
- File attachments — upload/download on detail → Task 4 (AttachmentsModule) + Task 8 ✓
- File attachments — upload on new ticket form → Task 9 ✓
- Backend unit tests — TicketsService → Task 5 ✓
- Backend unit tests — AttachmentsService → Task 6 ✓
- Frontend component tests → Task 10 ✓
- GET /users/agents endpoint → Task 2 ✓
- MinIO bucket ensure → Task 4 Step 6 ✓

**Placeholder scan:** None found.

**Type consistency:**
- `FindTicketsQueryDto` used in Task 3 service + controller — consistent ✓
- `MINIO_CLIENT` token defined in `attachments.constants.ts`, used in service and module — consistent ✓
- `RequestUser` type defined locally in each file (same shape `{ id: string; role: Role }`) — consistent ✓
- `Attachment` response shape from `findByTicket` adds `downloadUrl` — frontend reads `a.downloadUrl` in Task 8 ✓
