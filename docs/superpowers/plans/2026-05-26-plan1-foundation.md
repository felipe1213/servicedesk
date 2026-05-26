# Service Desk — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full Docker Compose stack with a NestJS backend, Next.js frontend, complete Prisma schema, and Auth module supporting both local credentials and Entra ID SSO with role-based access control.

**Architecture:** NestJS modular monolith backed by PostgreSQL via Prisma ORM, Redis for refresh token storage, running in Docker Compose alongside Elasticsearch, MinIO, and Kibana. Next.js frontend handles the web portal with NextAuth managing session state for both local and Entra ID login flows.

**Tech Stack:** NestJS 10, Next.js 14, TypeScript, Prisma 5, PostgreSQL 16, Redis 7, Docker Compose, Jest, passport-local, passport-jwt, @azure/msal-node, bcrypt, next-auth

---

## File Structure

```
servicedesk/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   ├── prisma/
│   │   └── schema.prisma
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       └── modules/
│           └── auth/
│               ├── auth.module.ts
│               ├── auth.controller.ts
│               ├── auth.controller.spec.ts
│               ├── auth.service.ts
│               ├── auth.service.spec.ts
│               ├── strategies/
│               │   ├── local.strategy.ts
│               │   ├── jwt.strategy.ts
│               │   └── entra-id.strategy.ts
│               ├── guards/
│               │   ├── jwt-auth.guard.ts
│               │   ├── local-auth.guard.ts
│               │   └── roles.guard.ts
│               ├── decorators/
│               │   └── roles.decorator.ts
│               └── dto/
│                   ├── register.dto.ts
│                   └── login.dto.ts
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── tsconfig.json
    ├── next.config.ts
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── page.tsx
        │   ├── auth/
        │   │   └── login/
        │   │       └── page.tsx
        │   └── api/
        │       └── auth/
        │           └── [...nextauth]/
        │               └── route.ts
        ├── middleware.ts
        ├── lib/
        │   └── api.ts
        └── types/
            └── auth.ts
```

---

## Task 1: Docker Compose + Environment

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
.env
node_modules/
dist/
.next/
```

- [ ] **Step 2: Create `.env.example`**

```env
# PostgreSQL
POSTGRES_USER=servicedesk
POSTGRES_PASSWORD=servicedesk_pass
POSTGRES_DB=servicedesk
DATABASE_URL=postgresql://servicedesk:servicedesk_pass@postgres:5432/servicedesk

# Redis
REDIS_URL=redis://redis:6379

# JWT
JWT_SECRET=change_me_in_production
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Entra ID (Azure AD)
ENTRA_CLIENT_ID=your_client_id
ENTRA_CLIENT_SECRET=your_client_secret
ENTRA_TENANT_ID=your_tenant_id
ENTRA_REDIRECT_URI=http://localhost:3000/auth/callback

# MinIO
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_ENDPOINT=http://minio:9000
MINIO_BUCKET=servicedesk-attachments

# Elasticsearch
ELASTICSEARCH_URL=http://elasticsearch:9200

# Backend
PORT=4000
NODE_ENV=development

# Frontend
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=change_me_in_production
NEXT_PUBLIC_API_URL=http://localhost:4000
```

- [ ] **Step 3: Copy `.env.example` to `.env`**

```bash
cp .env.example .env
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  elasticsearch:
    image: elasticsearch:8.13.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    ports:
      - "9200:9200"
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data

  kibana:
    image: kibana:8.13.0
    environment:
      ELASTICSEARCH_HOSTS: http://elasticsearch:9200
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    env_file: .env
    ports:
      - "4000:4000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    volumes:
      - ./backend:/app
      - /app/node_modules

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    env_file: .env
    ports:
      - "3000:3000"
    depends_on:
      - backend
    volumes:
      - ./frontend:/app
      - /app/node_modules
      - /app/.next

volumes:
  postgres_data:
  redis_data:
  elasticsearch_data:
  minio_data:
```

- [ ] **Step 5: Commit**

```bash
git init
git add docker-compose.yml .env.example .gitignore
git commit -m "chore: add Docker Compose stack and environment config"
```

---

## Task 2: NestJS Backend Scaffolding

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/nest-cli.json`
- Create: `backend/Dockerfile`
- Create: `backend/src/main.ts`
- Create: `backend/src/app.module.ts`

- [ ] **Step 1: Create `backend/package.json`**

```json
{
  "name": "servicedesk-backend",
  "version": "0.0.1",
  "scripts": {
    "build": "nest build",
    "start": "node dist/main",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "db:migrate": "prisma migrate deploy",
    "db:generate": "prisma generate",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@prisma/client": "^5.0.0",
    "@azure/msal-node": "^2.0.0",
    "bcrypt": "^5.1.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.0",
    "ioredis": "^5.3.0",
    "passport": "^0.6.0",
    "passport-jwt": "^4.0.0",
    "passport-local": "^1.0.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/bcrypt": "^5.0.0",
    "@types/jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "@types/passport-jwt": "^3.0.0",
    "@types/passport-local": "^1.0.0",
    "jest": "^29.0.0",
    "prisma": "^5.0.0",
    "ts-jest": "^29.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.0.0"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Create `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 3: Create `backend/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 4: Create `backend/Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "start:dev"]
```

- [ ] **Step 5: Create `backend/src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: process.env.NEXTAUTH_URL, credentials: true });
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
```

- [ ] **Step 6: Create `backend/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "chore: scaffold NestJS backend"
```

---

## Task 3: Next.js Frontend Scaffolding

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/next.config.ts`
- Create: `frontend/Dockerfile`
- Create: `frontend/src/app/layout.tsx`
- Create: `frontend/src/app/page.tsx`
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/types/auth.ts`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "servicedesk-frontend",
  "version": "0.0.1",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "next": "^14.0.0",
    "next-auth": "^4.24.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^14.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "jest": "^29.0.0",
    "jest-environment-jsdom": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `frontend/next.config.ts`**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 4: Create `frontend/Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "dev"]
```

- [ ] **Step 5: Create `frontend/src/types/auth.ts`**

```typescript
export type Role = 'ADMIN' | 'MANAGER' | 'AGENT' | 'END_USER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  accessToken: string;
}
```

- [ ] **Step 6: Create `frontend/src/lib/api.ts`**

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = sessionStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
```

- [ ] **Step 7: Create `frontend/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Service Desk',
  description: 'Enterprise Help Desk Ticketing System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Create `frontend/src/app/page.tsx`**

```tsx
import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1>Service Desk</h1>
      <Link href="/auth/login">Sign In</Link>
    </main>
  );
}
```

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "chore: scaffold Next.js frontend"
```

---

## Task 4: Prisma Schema

**Files:**
- Create: `backend/prisma/schema.prisma`

- [ ] **Step 1: Create `backend/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  MANAGER
  AGENT
  END_USER
}

enum AuthProvider {
  LOCAL
  ENTRA_ID
}

enum TicketStatus {
  NEW
  ASSIGNED
  IN_PROGRESS
  PENDING
  RESOLVED
  CLOSED
}

enum Priority {
  CRITICAL
  HIGH
  MEDIUM
  LOW
}

enum Channel {
  WEB
  TEAMS
  EMAIL
}

enum KbSource {
  INTERNAL
  SHAREPOINT
  CONFLUENCE
}

model User {
  id               String          @id @default(cuid())
  name             String
  email            String          @unique
  password         String?
  role             Role            @default(END_USER)
  authProvider     AuthProvider    @default(LOCAL)
  teamId           String?
  team             Team?           @relation(fields: [teamId], references: [id])
  createdTickets   Ticket[]        @relation("CreatedBy")
  assignedTickets  Ticket[]        @relation("AssignedTo")
  comments         Comment[]
  auditLogs        AuditLog[]
  attachments      Attachment[]
  dashboardConfig  DashboardConfig?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
}

model Team {
  id           String        @id @default(cuid())
  name         String        @unique
  users        User[]
  tickets      Ticket[]
  routingRules RoutingRule[]
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
}

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
  slaPolicyId        String?
  slaPolicy          SlaPolicy?   @relation(fields: [slaPolicyId], references: [id])
  slaBreached        Boolean      @default(false)
  responseDeadline   DateTime?
  resolutionDeadline DateTime?
  createdAt          DateTime     @default(now())
  updatedAt          DateTime     @updatedAt
}

model Comment {
  id         String   @id @default(cuid())
  ticketId   String
  ticket     Ticket   @relation(fields: [ticketId], references: [id])
  authorId   String
  author     User     @relation(fields: [authorId], references: [id])
  body       String
  isInternal Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model AuditLog {
  id        String   @id @default(cuid())
  ticketId  String
  ticket    Ticket   @relation(fields: [ticketId], references: [id])
  actorId   String
  actor     User     @relation(fields: [actorId], references: [id])
  action    String
  oldValue  String?
  newValue  String?
  createdAt DateTime @default(now())
}

model SlaPolicy {
  id                    String   @id @default(cuid())
  name                  String
  priorityLevel         Priority @unique
  responseTimeMinutes   Int
  resolutionTimeMinutes Int
  tickets               Ticket[]
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}

model RoutingRule {
  id              String   @id @default(cuid())
  priorityOrder   Int
  conditions      Json
  assignToTeamId  String?
  assignToTeam    Team?    @relation(fields: [assignToTeamId], references: [id])
  assignToAgentId String?
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model KbArticle {
  id          String   @id @default(cuid())
  title       String
  body        String
  source      KbSource @default(INTERNAL)
  externalUrl String?
  tags        String[]
  viewCount   Int      @default(0)
  authorId    String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Attachment {
  id           String   @id @default(cuid())
  ticketId     String
  ticket       Ticket   @relation(fields: [ticketId], references: [id])
  filename     String
  mimeType     String
  storagePath  String
  uploadedById String
  uploadedBy   User     @relation(fields: [uploadedById], references: [id])
  createdAt    DateTime @default(now())
}

model DashboardConfig {
  id           String   @id @default(cuid())
  userId       String   @unique
  user         User     @relation(fields: [userId], references: [id])
  role         Role
  widgetLayout Json
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model AppConfig {
  id        String   @id @default(cuid())
  key       String   @unique
  value     String
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Run initial migration**

From inside the backend container or with local Node.js (after `npm install`):

```bash
cd backend
npm install
npx prisma migrate dev --name init
```

Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 3: Verify generated client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client (v5.x.x) to ./node_modules/@prisma/client`

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/
git commit -m "feat: add Prisma schema with all domain entities"
```

---

## Task 5: Prisma Module (shared database client)

**Files:**
- Create: `backend/src/prisma/prisma.module.ts`
- Create: `backend/src/prisma/prisma.service.ts`
- Create: `backend/src/prisma/prisma.service.spec.ts`

- [ ] **Step 1: Write failing test for PrismaService**

Create `backend/src/prisma/prisma.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();
    service = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should extend PrismaClient', () => {
    expect(typeof service.$connect).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest prisma.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './prisma.service'`

- [ ] **Step 3: Create `backend/src/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 4: Create `backend/src/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 5: Register in `backend/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd backend && npx jest prisma.service.spec.ts --no-coverage
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/prisma/ backend/src/app.module.ts
git commit -m "feat: add global PrismaModule"
```

---

## Task 6: Auth DTOs and Password Hashing Utility

**Files:**
- Create: `backend/src/modules/auth/dto/register.dto.ts`
- Create: `backend/src/modules/auth/dto/login.dto.ts`
- Create: `backend/src/modules/auth/auth.service.ts` (password hash helpers only)
- Create: `backend/src/modules/auth/auth.service.spec.ts`

- [ ] **Step 1: Create `backend/src/modules/auth/dto/register.dto.ts`**

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
```

- [ ] **Step 2: Create `backend/src/modules/auth/dto/login.dto.ts`**

```typescript
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
```

- [ ] **Step 3: Write failing tests for AuthService password helpers**

Create `backend/src/modules/auth/auth.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};
const mockJwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
const mockConfig = { get: jest.fn((key: string) => {
  const map: Record<string, string> = {
    JWT_SECRET: 'test_secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  };
  return map[key];
})};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('hashPassword', () => {
    it('should return a bcrypt hash different from the input', async () => {
      const hash = await service.hashPassword('secret123');
      expect(hash).not.toBe('secret123');
      expect(hash.startsWith('$2b$')).toBe(true);
    });
  });

  describe('comparePassword', () => {
    it('should return true for matching password and hash', async () => {
      const hash = await service.hashPassword('secret123');
      const result = await service.comparePassword('secret123', hash);
      expect(result).toBe(true);
    });

    it('should return false for wrong password', async () => {
      const hash = await service.hashPassword('secret123');
      const result = await service.comparePassword('wrong', hash);
      expect(result).toBe(false);
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd backend && npx jest auth.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './auth.service'`

- [ ] **Step 5: Create `backend/src/modules/auth/auth.service.ts`**

```typescript
import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthProvider, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async validateLocalUser(email: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) return null;
    const valid = await this.comparePassword(password, user.password);
    return valid ? user : null;
  }

  async register(dto: RegisterDto): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');
    const hashed = await this.hashPassword(dto.password);
    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashed,
        authProvider: AuthProvider.LOCAL,
        role: Role.END_USER,
      },
    });
  }

  async generateTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN'),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  async findOrCreateEntraUser(profile: { oid: string; email: string; name: string }): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (existing) return existing;
    return this.prisma.user.create({
      data: {
        name: profile.name,
        email: profile.email,
        authProvider: AuthProvider.ENTRA_ID,
        role: Role.END_USER,
      },
    });
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && npx jest auth.service.spec.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/auth/
git commit -m "feat: add AuthService with password hashing and token generation"
```

---

## Task 7: Local Auth Strategy + JWT Strategy

**Files:**
- Create: `backend/src/modules/auth/strategies/local.strategy.ts`
- Create: `backend/src/modules/auth/strategies/jwt.strategy.ts`
- Create: `backend/src/modules/auth/guards/local-auth.guard.ts`
- Create: `backend/src/modules/auth/guards/jwt-auth.guard.ts`

- [ ] **Step 1: Create `backend/src/modules/auth/strategies/local.strategy.ts`**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private auth: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string) {
    const user = await this.auth.validateLocalUser(email, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return user;
  }
}
```

- [ ] **Step 2: Create `backend/src/modules/auth/strategies/jwt.strategy.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
```

- [ ] **Step 3: Create `backend/src/modules/auth/guards/local-auth.guard.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
```

- [ ] **Step 4: Create `backend/src/modules/auth/guards/jwt-auth.guard.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/auth/strategies/ backend/src/modules/auth/guards/
git commit -m "feat: add local and JWT passport strategies with guards"
```

---

## Task 8: RBAC — Roles Guard and Decorator

**Files:**
- Create: `backend/src/modules/auth/decorators/roles.decorator.ts`
- Create: `backend/src/modules/auth/guards/roles.guard.ts`
- Create: `backend/src/modules/auth/guards/roles.guard.spec.ts`

- [ ] **Step 1: Write failing test for RolesGuard**

Create `backend/src/modules/auth/guards/roles.guard.spec.ts`:

```typescript
import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';

function mockContext(role: string): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user: { role } }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('should allow access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(mockContext('END_USER'))).toBe(true);
  });

  it('should allow access when user role matches', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(guard.canActivate(mockContext('ADMIN'))).toBe(true);
  });

  it('should deny access when user role does not match', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(guard.canActivate(mockContext('END_USER'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest roles.guard.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './roles.guard'`

- [ ] **Step 3: Create `backend/src/modules/auth/decorators/roles.decorator.ts`**

```typescript
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 4: Create `backend/src/modules/auth/guards/roles.guard.ts`**

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const { user } = context.switchToHttp().getRequest();
    return required.includes(user.role);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && npx jest roles.guard.spec.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/auth/decorators/ backend/src/modules/auth/guards/roles.guard.ts backend/src/modules/auth/guards/roles.guard.spec.ts
git commit -m "feat: add RBAC roles guard and decorator"
```

---

## Task 9: Auth Controller + Auth Module Assembly

**Files:**
- Create: `backend/src/modules/auth/auth.controller.ts`
- Create: `backend/src/modules/auth/auth.controller.spec.ts`
- Create: `backend/src/modules/auth/auth.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write failing test for AuthController**

Create `backend/src/modules/auth/auth.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const mockAuthService = {
  register: jest.fn(),
  generateTokens: jest.fn().mockResolvedValue({
    accessToken: 'access',
    refreshToken: 'refresh',
  }),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should return access and refresh tokens', async () => {
      const user = { id: '1', email: 'a@b.com', role: 'END_USER' } as any;
      const result = await controller.login(user);
      expect(result).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    });
  });

  describe('register', () => {
    it('should call authService.register with dto', async () => {
      const dto = { name: 'Alice', email: 'a@b.com', password: 'pass1234' };
      mockAuthService.register.mockResolvedValue({ id: '1', ...dto });
      const result = await controller.register(dto);
      expect(mockAuthService.register).toHaveBeenCalledWith(dto);
      expect(result).toHaveProperty('id');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest auth.controller.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './auth.controller'`

- [ ] **Step 3: Create `backend/src/modules/auth/auth.controller.ts`**

```typescript
import { Controller, Post, Body, UseGuards, Request, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { User } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Request() req: { user: User }) {
    return this.auth.generateTokens(req.user);
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req: { user: Partial<User> }) {
    return req.user;
  }
}
```

- [ ] **Step 4: Create `backend/src/modules/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_ACCESS_EXPIRES_IN') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy, RolesGuard],
  exports: [AuthService, JwtModule, RolesGuard],
})
export class AuthModule {}
```

- [ ] **Step 5: Register AuthModule in `backend/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && npx jest auth.controller.spec.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/auth/ backend/src/app.module.ts
git commit -m "feat: assemble AuthModule with controller, strategies, and guards"
```

---

## Task 10: Next.js Auth — NextAuth Setup + Login Page

**Files:**
- Create: `frontend/src/app/api/auth/[...nextauth]/route.ts`
- Create: `frontend/src/app/auth/login/page.tsx`
- Create: `frontend/src/middleware.ts`

- [ ] **Step 1: Create `frontend/src/app/api/auth/[...nextauth]/route.ts`**

```typescript
import NextAuth from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import CredentialsProvider from 'next-auth/providers/credentials';

const handler = NextAuth({
  providers: [
    AzureADProvider({
      clientId: process.env.ENTRA_CLIENT_ID!,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
      tenantId: process.env.ENTRA_TENANT_ID!,
    }),
    CredentialsProvider({
      name: 'Local',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.accessToken = (user as any).accessToken;
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      return session;
    },
  },
  pages: { signIn: '/auth/login' },
});

export { handler as GET, handler as POST };
```

- [ ] **Step 2: Create `frontend/src/app/auth/login/page.tsx`**

```tsx
'use client';

import { signIn } from 'next-auth/react';
import { FormEvent, useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await signIn('credentials', {
      email,
      password,
      callbackUrl: '/dashboard',
      redirect: false,
    });
    if (result?.error) setError('Invalid email or password');
    else window.location.href = '/dashboard';
  }

  return (
    <main>
      <h1>Sign In</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p>{error}</p>}
        <button type="submit">Sign in</button>
      </form>
      <button onClick={() => signIn('azure-ad', { callbackUrl: '/dashboard' })}>
        Sign in with Microsoft
      </button>
    </main>
  );
}
```

- [ ] **Step 3: Create `frontend/src/middleware.ts`**

```typescript
export { default } from 'next-auth/middleware';

export const config = {
  matcher: ['/dashboard/:path*', '/tickets/:path*', '/admin/:path*'],
};
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat: add NextAuth with Entra ID SSO and local credentials login page"
```

---

## Task 11: Smoke Test — Full Stack Up

**Files:** No new files — verify the running stack.

- [ ] **Step 1: Start the full stack**

```bash
docker compose up --build
```

Expected: All 7 services start without error. Check logs for:
- `postgres` — `database system is ready to accept connections`
- `backend` — `Nest application successfully started`
- `frontend` — `ready started server on 0.0.0.0:3000`

- [ ] **Step 2: Verify backend health**

```bash
curl http://localhost:4000/auth/me
```

Expected: `{"statusCode":401,"message":"Unauthorized"}` — confirms the JWT guard is active.

- [ ] **Step 3: Register a user**

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin User","email":"admin@example.com","password":"Admin1234!"}'
```

Expected: JSON response with `id`, `name`, `email`, `role: "END_USER"`.

- [ ] **Step 4: Login and get tokens**

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin1234!"}'
```

Expected: `{"accessToken":"...","refreshToken":"..."}`.

- [ ] **Step 5: Access protected endpoint**

```bash
curl http://localhost:4000/auth/me \
  -H "Authorization: Bearer <accessToken from previous step>"
```

Expected: `{"id":"...","email":"admin@example.com","role":"END_USER"}`.

- [ ] **Step 6: Verify frontend login page loads**

Open `http://localhost:3000/auth/login` in a browser.
Expected: Login form and "Sign in with Microsoft" button visible.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: verified full stack smoke test passes"
```

---

## Self-Review Checklist

- [x] Docker Compose covers all 7 services (postgres, redis, elasticsearch, kibana, minio, backend, frontend)
- [x] All Prisma entities from the data model are defined (User, Team, Ticket, Comment, AuditLog, SlaPolicy, RoutingRule, KbArticle, Attachment, DashboardConfig, AppConfig)
- [x] Local auth: register, login, bcrypt, JWT covered
- [x] Entra ID: findOrCreateEntraUser + NextAuth AzureADProvider covered
- [x] RBAC: RolesGuard + Roles decorator with tests
- [x] Next.js: login page, NextAuth route, middleware protecting dashboard/tickets/admin
- [x] No TBDs or placeholders in any step
- [x] Type names consistent throughout (Role, AuthProvider, Priority, Channel, TicketStatus, KbSource)
