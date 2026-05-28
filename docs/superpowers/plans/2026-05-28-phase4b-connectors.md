# Phase 4b — External KB Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SharePoint and Confluence bidirectional sync to the KB module via a new `ConnectorsModule` with AES-256-GCM credential storage, scheduled + manual sync, conflict detection, and a full admin UI.

**Architecture:** A single `ConnectorsModule` owns all external sync logic — credential management (AES-256-GCM via `CONNECTOR_ENCRYPTION_KEY`), SharePoint OAuth 2.0 client-credentials flow via Microsoft Graph, Confluence Cloud API-token Basic auth, a dynamic `setInterval`-based scheduler, and a conflict resolution API. `KbService` is exported from `KbModule` so `ConnectorsModule` can upsert articles and re-index to Elasticsearch without a circular dependency.

**Tech Stack:** NestJS 10, Prisma 5, `turndown` (HTML→Markdown), `marked` (Markdown→HTML), Node.js built-in `crypto` (AES-256-GCM), Microsoft Graph REST API, Confluence Cloud REST API, Next.js 14 App Router, React, Jest.

---

## File Map

### Backend — new files
- `backend/src/modules/connectors/connectors-config.service.ts`
- `backend/src/modules/connectors/content-converter.service.ts`
- `backend/src/modules/connectors/sharepoint.service.ts`
- `backend/src/modules/connectors/confluence.service.ts`
- `backend/src/modules/connectors/connectors.service.ts`
- `backend/src/modules/connectors/sync-scheduler.service.ts`
- `backend/src/modules/connectors/connectors.controller.ts`
- `backend/src/modules/connectors/connectors.module.ts`
- `backend/src/modules/connectors/dto/connector-config.dto.ts`
- `backend/src/modules/connectors/dto/resolve-conflict.dto.ts`
- `backend/src/modules/connectors/connectors.service.spec.ts`

### Backend — modified files
- `backend/prisma/schema.prisma` — add 5 fields to `KbArticle` + new `KbSyncLog` model
- `backend/src/modules/kb/kb.module.ts` — add `exports: [KbService]`
- `backend/src/modules/kb/kb.service.ts` — make `indexArticle()` public
- `backend/src/modules/kb/kb.controller.ts` — add `POST /kb/:id/export`
- `backend/src/app.module.ts` — add `ConnectorsModule`
- `.env.example` — add `CONNECTOR_ENCRYPTION_KEY`

### Frontend — new files
- `frontend/src/app/(app)/admin/connectors/page.tsx`
- `frontend/src/app/(app)/admin/connectors/sharepoint/page.tsx`
- `frontend/src/app/(app)/admin/connectors/confluence/page.tsx`
- `frontend/src/app/(app)/admin/connectors/conflicts/page.tsx`
- `frontend/src/app/(app)/admin/connectors/page.test.tsx`
- `frontend/src/app/(app)/admin/connectors/conflicts/page.test.tsx`

### Frontend — modified files
- `frontend/src/app/(app)/admin/page.tsx` — add 4th card (Connectors)
- `frontend/src/app/(app)/admin/kb/page.tsx` — source badge + Export button/modal

---

## Task 1: Schema Migration, npm Packages, and KbModule Prep

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/kb/kb.module.ts`
- Modify: `backend/src/modules/kb/kb.service.ts`
- Modify: `.env.example`

- [ ] **Step 1: Install new npm packages**

```bash
cd backend
npm install turndown marked
npm install --save-dev @types/turndown
```

Expected: packages added to `backend/package.json`.

- [ ] **Step 2: Add five fields to `KbArticle` and the `KbSyncLog` model in the schema**

In `backend/prisma/schema.prisma`, find the `KbArticle` model (currently ends at `updatedAt DateTime @updatedAt`) and add the five new fields:

```prisma
model KbArticle {
  id          String          @id @default(cuid())
  title       String
  body        String
  source      KbSource        @default(INTERNAL)
  externalUrl String?
  tags        String[]
  viewCount   Int             @default(0)
  authorId    String?
  author      User?           @relation("KbArticleAuthor", fields: [authorId], references: [id])
  status      KbArticleStatus @default(DRAFT)
  slug        String          @unique
  publishedAt DateTime?
  deflections KbDeflection[]
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  externalId      String?
  externalVersion String?
  lastSyncedAt    DateTime?
  syncConflict    Boolean   @default(false)
  conflictData    Json?
}
```

Then add `KbSyncLog` after the `KbDeflection` model (at the end of the file):

```prisma
model KbSyncLog {
  id              String    @id @default(cuid())
  connector       KbSource
  startedAt       DateTime
  completedAt     DateTime?
  status          String
  articlesNew     Int       @default(0)
  articlesUpdated Int       @default(0)
  conflicts       Int       @default(0)
  errorMessage    String?

  @@index([connector])
}
```

- [ ] **Step 3: Generate and run the migration**

```bash
cd backend
npx prisma migrate dev --name phase4b_connectors
```

Expected output ends with: `Your database is now in sync with your schema.`

- [ ] **Step 4: Export `KbService` from `KbModule`**

Replace the entire `backend/src/modules/kb/kb.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { TicketsModule } from '../tickets/tickets.module';
import { KbController } from './kb.controller';
import { KbService } from './kb.service';

@Module({
  imports: [
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        node: config.get<string>('ELASTICSEARCH_URL', 'http://elasticsearch:9200'),
      }),
      inject: [ConfigService],
    }),
    TicketsModule,
  ],
  controllers: [KbController],
  providers: [KbService],
  exports: [KbService],
})
export class KbModule {}
```

- [ ] **Step 5: Make `indexArticle()` public in `KbService`**

In `backend/src/modules/kb/kb.service.ts`, change `private async indexArticle` to `async indexArticle`:

```typescript
  async indexArticle(article: {
    id: string; title: string; body: string; tags: string[];
    slug: string; publishedAt: Date | null;
  }) {
```

- [ ] **Step 6: Add `CONNECTOR_ENCRYPTION_KEY` to `.env.example`**

Append to `.env.example`:

```
# Connectors (SharePoint / Confluence)
# Generate with: openssl rand -hex 32
CONNECTOR_ENCRYPTION_KEY=
```

- [ ] **Step 7: Verify backend still compiles and tests pass**

```bash
cd backend
npm run build 2>&1 | tail -5
npm test -- --passWithNoTests 2>&1 | tail -10
```

Expected: build succeeds, existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma \
        backend/prisma/migrations/ \
        backend/src/modules/kb/kb.module.ts \
        backend/src/modules/kb/kb.service.ts \
        backend/package.json backend/package-lock.json \
        .env.example
git commit -m "$(cat <<'EOF'
feat(connectors): schema migration, packages, and KbModule prep for Phase 4b

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `ConnectorConfigService` and `ContentConverterService`

**Files:**
- Create: `backend/src/modules/connectors/connectors-config.service.ts`
- Create: `backend/src/modules/connectors/content-converter.service.ts`
- Create: `backend/src/modules/connectors/connectors.service.spec.ts`

- [ ] **Step 1: Write the failing tests for `ConnectorConfigService` and `ContentConverterService`**

Create `backend/src/modules/connectors/connectors.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConnectorConfigService } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';

// ---------- ConnectorConfigService ----------

const mockPrisma = {
  appConfig: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

const ENCRYPTION_KEY = '0'.repeat(64); // 32 bytes as hex

describe('ConnectorConfigService', () => {
  let service: ConnectorConfigService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ConnectorConfigService,
        { provide: 'PrismaService', useValue: mockPrisma },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn().mockReturnValue(ENCRYPTION_KEY) } },
      ],
    }).compile();
    service = module.get(ConnectorConfigService);
    jest.clearAllMocks();
  });

  it('encrypts clientSecret on save and decrypts on load', async () => {
    let stored: string | undefined;
    mockPrisma.appConfig.upsert.mockImplementation(({ create }: any) => {
      stored = create.value;
      return Promise.resolve({});
    });
    mockPrisma.appConfig.findUnique.mockImplementation(() =>
      Promise.resolve({ key: 'connector.sharepoint', value: stored }),
    );

    await service.saveConfig('sharepoint', {
      tenantId: 't', clientId: 'c', clientSecret: 'my-secret',
      siteUrl: 'https://contoso.sharepoint.com/sites/kb',
      syncType: 'pages', enabled: true, syncIntervalMinutes: 60,
    });

    const parsed = JSON.parse(stored!);
    expect(parsed.clientSecret).not.toBe('my-secret');

    const loaded = await service.getConfig('sharepoint') as any;
    expect(loaded.clientSecret).toBe('my-secret');
  });

  it('redacts clientSecret in getRedactedConfig', async () => {
    const encrypted = (service as any).encrypt('top-secret');
    mockPrisma.appConfig.findUnique.mockResolvedValue({
      key: 'connector.sharepoint',
      value: JSON.stringify({ tenantId: 't', clientId: 'c', clientSecret: encrypted, siteUrl: 'https://s.com', syncType: 'pages', enabled: true, syncIntervalMinutes: 60 }),
    });

    const redacted = await service.getRedactedConfig('sharepoint') as any;
    expect(redacted.clientSecret).toBe('***');
  });

  it('encrypts apiToken on save and decrypts on load for Confluence', async () => {
    let stored: string | undefined;
    mockPrisma.appConfig.upsert.mockImplementation(({ create }: any) => {
      stored = create.value;
      return Promise.resolve({});
    });
    mockPrisma.appConfig.findUnique.mockImplementation(() =>
      Promise.resolve({ key: 'connector.confluence', value: stored }),
    );

    await service.saveConfig('confluence', {
      baseUrl: 'https://myorg.atlassian.net', email: 'a@b.com', apiToken: 'tok',
      syncType: 'space', spaceKey: 'KB', enabled: true, syncIntervalMinutes: 30,
    });

    const loaded = await service.getConfig('confluence') as any;
    expect(loaded.apiToken).toBe('tok');
  });
});

// ---------- ContentConverterService ----------

describe('ContentConverterService', () => {
  let service: ContentConverterService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ContentConverterService],
    }).compile();
    service = module.get(ContentConverterService);
  });

  it('converts basic HTML to markdown', () => {
    const result = service.htmlToMarkdown('<h1>Hello</h1><p>World</p>');
    expect(result).toContain('# Hello');
    expect(result).toContain('World');
  });

  it('converts basic markdown to HTML', () => {
    const result = service.markdownToHtml('# Hello\n\nWorld');
    expect(result).toContain('<h1>Hello</h1>');
    expect(result).toContain('World');
  });

  it('strips Confluence storage-format tags before converting', () => {
    const html = '<p>Normal text</p><ac:structured-macro ac:name="code"><ac:plain-text-body>code</ac:plain-text-body></ac:structured-macro>';
    const result = service.htmlToMarkdown(html);
    expect(result).toContain('Normal text');
    expect(result).not.toContain('ac:structured-macro');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd backend
npm test -- connectors.service.spec.ts 2>&1 | tail -20
```

Expected: `Cannot find module './connectors-config.service'`

- [ ] **Step 3: Implement `ConnectorConfigService`**

Create `backend/src/modules/connectors/connectors-config.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

export interface SharePointConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  syncType: 'library' | 'pages';
  libraryName?: string;
  rootPageId?: string;
  enabled: boolean;
  syncIntervalMinutes: number;
}

export interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  syncType: 'space' | 'pagetree';
  spaceKey?: string;
  rootPageId?: string;
  enabled: boolean;
  syncIntervalMinutes: number;
}

@Injectable()
export class ConnectorConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get encryptionKey(): Buffer {
    return Buffer.from(this.config.getOrThrow<string>('CONNECTOR_ENCRYPTION_KEY'), 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(stored: string): string {
    const [ivHex, authTagHex, encryptedHex] = stored.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }

  async getConfig(connector: 'sharepoint'): Promise<SharePointConfig | null>;
  async getConfig(connector: 'confluence'): Promise<ConfluenceConfig | null>;
  async getConfig(connector: 'sharepoint' | 'confluence'): Promise<SharePointConfig | ConfluenceConfig | null> {
    const record = await this.prisma.appConfig.findUnique({ where: { key: `connector.${connector}` } });
    if (!record) return null;
    const parsed = JSON.parse(record.value);
    if (connector === 'sharepoint') return { ...parsed, clientSecret: this.decrypt(parsed.clientSecret) };
    return { ...parsed, apiToken: this.decrypt(parsed.apiToken) };
  }

  async getRedactedConfig(connector: 'sharepoint' | 'confluence') {
    const cfg = await this.getConfig(connector as any);
    if (!cfg) return null;
    if (connector === 'sharepoint') return { ...(cfg as SharePointConfig), clientSecret: '***' };
    return { ...(cfg as ConfluenceConfig), apiToken: '***' };
  }

  async saveConfig(connector: 'sharepoint', config: SharePointConfig): Promise<void>;
  async saveConfig(connector: 'confluence', config: ConfluenceConfig): Promise<void>;
  async saveConfig(connector: 'sharepoint' | 'confluence', config: SharePointConfig | ConfluenceConfig): Promise<void> {
    let toStore: Record<string, unknown>;
    if (connector === 'sharepoint') {
      const sp = config as SharePointConfig;
      toStore = { ...sp, clientSecret: this.encrypt(sp.clientSecret) };
    } else {
      const cf = config as ConfluenceConfig;
      toStore = { ...cf, apiToken: this.encrypt(cf.apiToken) };
    }
    const value = JSON.stringify(toStore);
    await this.prisma.appConfig.upsert({
      where: { key: `connector.${connector}` },
      create: { key: `connector.${connector}`, value },
      update: { value },
    });
  }
}
```

- [ ] **Step 4: Implement `ContentConverterService`**

Create `backend/src/modules/connectors/content-converter.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import TurndownService from 'turndown';
import { marked } from 'marked';

@Injectable()
export class ContentConverterService {
  private readonly td: TurndownService;

  constructor() {
    this.td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  }

  htmlToMarkdown(html: string): string {
    const cleaned = html
      .replace(/<ac:[^>]*>[\s\S]*?<\/ac:[^>]*>/g, '')
      .replace(/<ri:[^/]*\/>/g, '');
    return this.td.turndown(cleaned);
  }

  markdownToHtml(markdown: string): string {
    return marked(markdown) as string;
  }
}
```

- [ ] **Step 5: Run the tests — expect them to pass**

```bash
cd backend
npm test -- connectors.service.spec.ts 2>&1 | tail -20
```

Expected: `Tests: 6 passed, 6 total`

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/connectors/connectors-config.service.ts \
        backend/src/modules/connectors/content-converter.service.ts \
        backend/src/modules/connectors/connectors.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(connectors): ConnectorConfigService (AES-256-GCM) and ContentConverterService

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `SharePointService`

**Files:**
- Create: `backend/src/modules/connectors/sharepoint.service.ts`
- Modify: `backend/src/modules/connectors/connectors.service.spec.ts`

- [ ] **Step 1: Add failing tests for `SharePointService.upsertArticle()`**

Append to `backend/src/modules/connectors/connectors.service.spec.ts`:

```typescript
// ---------- SharePointService ----------

import { SharePointService } from './sharepoint.service';
import { KbArticleStatus, KbSource } from '@prisma/client';

const mockKbService = { indexArticle: jest.fn() };

function makeSpPrisma(existing: any) {
  return {
    kbArticle: {
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'new-id', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: existing?.id ?? 'x', status: KbArticleStatus.PUBLISHED, ...data })),
    },
    kbSyncLog: { update: jest.fn().mockResolvedValue({}) },
  };
}

function makeSpService(prisma: any) {
  return new (SharePointService as any)(
    prisma,
    mockKbService,
    { getConfig: jest.fn(), encrypt: jest.fn(), decrypt: jest.fn() },
    new ContentConverterService(),
  );
}

const remoteItem = { id: 'ext-1', title: 'Test Page', body: '<p>Hello</p>', version: 'etag-v2', webUrl: 'https://sp.example.com/page' };
const logRef = { id: 'log-1', articlesNew: 0, articlesUpdated: 0, conflicts: 0 };

describe('SharePointService.upsertArticle()', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('creates new article when externalId not found', async () => {
    const prisma = makeSpPrisma(null);
    prisma.kbArticle.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'new-id', status: KbArticleStatus.PUBLISHED, title: 'Test Page', body: '# Hello', tags: [], slug: 'test', publishedAt: new Date() });
    const svc = makeSpService(prisma);
    const log = { ...logRef };
    await svc.upsertArticle(remoteItem, log);
    expect(prisma.kbArticle.create).toHaveBeenCalled();
    expect(mockKbService.indexArticle).toHaveBeenCalled();
    expect(log.articlesNew).toBe(1);
  });

  it('skips when externalVersion matches', async () => {
    const existing = { id: 'art-1', externalId: 'ext-1', externalVersion: 'etag-v2', updatedAt: new Date(), lastSyncedAt: new Date() };
    const prisma = makeSpPrisma(existing);
    const svc = makeSpService(prisma);
    const log = { ...logRef };
    await svc.upsertArticle(remoteItem, log);
    expect(prisma.kbArticle.update).not.toHaveBeenCalled();
    expect(log.articlesUpdated).toBe(0);
  });

  it('updates article when remote changed and no local edits', async () => {
    const lastSyncedAt = new Date(Date.now() - 10000);
    const updatedAt = new Date(Date.now() - 20000); // updatedAt < lastSyncedAt → no local edits
    const existing = { id: 'art-1', externalId: 'ext-1', externalVersion: 'etag-v1', status: KbArticleStatus.PUBLISHED, updatedAt, lastSyncedAt };
    const prisma = makeSpPrisma(existing);
    const svc = makeSpService(prisma);
    const log = { ...logRef };
    await svc.upsertArticle(remoteItem, log);
    expect(prisma.kbArticle.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalVersion: 'etag-v2' }),
    }));
    expect(log.articlesUpdated).toBe(1);
  });

  it('sets syncConflict when both sides edited', async () => {
    const lastSyncedAt = new Date(Date.now() - 10000);
    const updatedAt = new Date(Date.now() - 5000); // updatedAt > lastSyncedAt → local edit
    const existing = { id: 'art-1', externalId: 'ext-1', externalVersion: 'etag-v1', updatedAt, lastSyncedAt };
    const prisma = makeSpPrisma(existing);
    const svc = makeSpService(prisma);
    const log = { ...logRef };
    await svc.upsertArticle(remoteItem, log);
    expect(prisma.kbArticle.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ syncConflict: true }),
    }));
    expect(log.conflicts).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd backend
npm test -- connectors.service.spec.ts 2>&1 | tail -10
```

Expected: `Cannot find module './sharepoint.service'`

- [ ] **Step 3: Implement `SharePointService`**

Create `backend/src/modules/connectors/sharepoint.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { KbArticleStatus, KbSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KbService } from '../kb/kb.service';
import { ConnectorConfigService, SharePointConfig } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';

interface ExternalItem {
  id: string;
  title: string;
  body: string;
  version: string;
  webUrl: string;
}

interface LogRef {
  id: string;
  articlesNew: number;
  articlesUpdated: number;
  conflicts: number;
}

@Injectable()
export class SharePointService {
  private readonly logger = new Logger(SharePointService.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kb: KbService,
    private readonly configService: ConnectorConfigService,
    private readonly converter: ContentConverterService,
  ) {}

  private async getAccessToken(config: SharePointConfig): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.value;
    }
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    if (!res.ok) throw new Error(`SharePoint OAuth failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { access_token: string; expires_in: number };
    this.cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return this.cachedToken.value;
  }

  private siteId(siteUrl: string): string {
    const u = new URL(siteUrl);
    return `${u.hostname}:${u.pathname}`;
  }

  private async fetchWithRetry(url: string, token: string, options?: RequestInit, retries = 3): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      const res = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...(options?.headers as Record<string, string> ?? {}) },
      });
      if (res.status !== 429) return res;
      const after = parseInt(res.headers.get('retry-after') ?? '5', 10);
      await new Promise(r => setTimeout(r, after * 1000));
    }
    throw new Error(`Max retries exceeded for ${url}`);
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const config = await this.configService.getConfig('sharepoint');
    if (!config) return { ok: false, message: 'Not configured' };
    try {
      const token = await this.getAccessToken(config);
      const res = await this.fetchWithRetry(
        `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(this.siteId(config.siteUrl))}`,
        token,
      );
      if (res.ok) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `API error: ${res.status}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async sync() {
    const config = await this.configService.getConfig('sharepoint');
    if (!config) throw new Error('SharePoint not configured');
    const log = await this.prisma.kbSyncLog.create({
      data: { connector: KbSource.SHAREPOINT, startedAt: new Date(), status: 'running' },
    });
    const logRef: LogRef = { id: log.id, articlesNew: 0, articlesUpdated: 0, conflicts: 0 };
    try {
      const token = await this.getAccessToken(config);
      const sid = encodeURIComponent(this.siteId(config.siteUrl));
      const items: ExternalItem[] = [];

      if (config.syncType === 'pages') {
        const res = await this.fetchWithRetry(`https://graph.microsoft.com/v1.0/sites/${sid}/pages`, token);
        const data = await res.json() as { value: any[] };
        for (const p of (data.value ?? [])) {
          items.push({ id: p.id, title: p.title, body: p.webHtml ?? '', version: p['@odata.etag'] ?? '', webUrl: p.webUrl ?? '' });
        }
      } else {
        const dRes = await this.fetchWithRetry(`https://graph.microsoft.com/v1.0/sites/${sid}/drives`, token);
        const drives = await dRes.json() as { value: any[] };
        const drive = drives.value?.find((d: any) => d.name === config.libraryName) ?? drives.value?.[0];
        if (drive) {
          const fRes = await this.fetchWithRetry(`https://graph.microsoft.com/v1.0/drives/${drive.id}/root/children`, token);
          const files = await fRes.json() as { value: any[] };
          for (const f of (files.value ?? []).filter((f: any) => f.name.endsWith('.md'))) {
            const cRes = await fetch(f['@microsoft.graph.downloadUrl']);
            items.push({ id: f.id, title: f.name.replace('.md', ''), body: await cRes.text(), version: f.eTag ?? '', webUrl: f.webUrl ?? '' });
          }
        }
      }

      for (const item of items) {
        await this.upsertArticle(item, logRef);
      }

      // Push local edits outbound
      const localEdited = await this.prisma.kbArticle.findMany({
        where: { source: KbSource.SHAREPOINT, syncConflict: false, externalId: { not: null } },
      });
      for (const article of localEdited) {
        if (article.lastSyncedAt && article.updatedAt > article.lastSyncedAt) {
          await this.pushArticle(article as any);
        }
      }

      const status = logRef.conflicts > 0 ? 'partial' : 'success';
      return this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { completedAt: new Date(), status } });
    } catch (e) {
      return this.prisma.kbSyncLog.update({
        where: { id: log.id },
        data: { completedAt: new Date(), status: 'failed', errorMessage: (e as Error).message },
      });
    }
  }

  async upsertArticle(item: ExternalItem, log: LogRef): Promise<void> {
    const existing = await this.prisma.kbArticle.findFirst({ where: { externalId: item.id } });
    const markdown = this.converter.htmlToMarkdown(item.body);

    if (!existing) {
      const slug = item.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Math.random().toString(36).slice(2, 8);
      await this.prisma.kbArticle.create({
        data: {
          title: item.title, body: markdown, tags: [],
          status: KbArticleStatus.PUBLISHED, slug,
          source: KbSource.SHAREPOINT, externalId: item.id,
          externalVersion: item.version, externalUrl: item.webUrl,
          lastSyncedAt: new Date(), publishedAt: new Date(), authorId: null,
        },
      });
      const created = await this.prisma.kbArticle.findFirst({ where: { externalId: item.id } });
      if (created) await this.kb.indexArticle(created);
      await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { articlesNew: { increment: 1 } } });
      log.articlesNew++;
      return;
    }

    if (existing.externalVersion === item.version) return;

    const localEdited = existing.lastSyncedAt ? existing.updatedAt > existing.lastSyncedAt : false;

    if (localEdited) {
      await this.prisma.kbArticle.update({
        where: { id: existing.id },
        data: {
          syncConflict: true,
          conflictData: { remoteTitle: item.title, remoteBody: markdown, remoteVersion: item.version, detectedAt: new Date().toISOString() },
        },
      });
      await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { conflicts: { increment: 1 } } });
      log.conflicts++;
      return;
    }

    const updated = await this.prisma.kbArticle.update({
      where: { id: existing.id },
      data: { title: item.title, body: markdown, externalVersion: item.version, lastSyncedAt: new Date() },
    });
    if (updated.status === KbArticleStatus.PUBLISHED) await this.kb.indexArticle(updated);
    await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { articlesUpdated: { increment: 1 } } });
    log.articlesUpdated++;
  }

  async pushArticle(article: { id: string; title: string; body: string; externalId: string | null; externalVersion: string | null }): Promise<void> {
    const config = await this.configService.getConfig('sharepoint');
    if (!config || !article.externalId) return;
    const token = await this.getAccessToken(config);
    const html = this.converter.markdownToHtml(article.body);
    const sid = encodeURIComponent(this.siteId(config.siteUrl));
    const res = await this.fetchWithRetry(
      `https://graph.microsoft.com/v1.0/sites/${sid}/pages/${article.externalId}`,
      token,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: article.title, webHtml: html }) },
    );
    if (!res.ok) { this.logger.warn(`SharePoint push failed for article ${article.id}: ${res.status}`); return; }
    const etag = res.headers.get('etag') ?? article.externalVersion ?? '';
    await this.prisma.kbArticle.update({ where: { id: article.id }, data: { externalVersion: etag, lastSyncedAt: new Date() } });
  }

  async exportArticle(articleId: string): Promise<void> {
    const config = await this.configService.getConfig('sharepoint');
    if (!config) throw new Error('SharePoint not configured');
    const article = await this.prisma.kbArticle.findUniqueOrThrow({ where: { id: articleId } });
    const token = await this.getAccessToken(config);
    const html = this.converter.markdownToHtml(article.body);
    const sid = encodeURIComponent(this.siteId(config.siteUrl));
    const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${sid}/pages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: article.title, webHtml: html }),
    });
    if (!res.ok) throw new Error(`SharePoint export failed: ${res.status} ${await res.text()}`);
    const created = await res.json() as { id: string; webUrl: string; '@odata.etag'?: string };
    await this.prisma.kbArticle.update({
      where: { id: articleId },
      data: { source: KbSource.SHAREPOINT, externalId: created.id, externalUrl: created.webUrl, externalVersion: created['@odata.etag'] ?? '', lastSyncedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Run the tests — expect SharePointService tests to pass**

```bash
cd backend
npm test -- connectors.service.spec.ts 2>&1 | tail -20
```

Expected: `Tests: 10 passed, 10 total`

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/connectors/sharepoint.service.ts \
        backend/src/modules/connectors/connectors.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(connectors): SharePointService with OAuth, upsertArticle, pushArticle, exportArticle

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `ConfluenceService`

**Files:**
- Create: `backend/src/modules/connectors/confluence.service.ts`
- Modify: `backend/src/modules/connectors/connectors.service.spec.ts`

- [ ] **Step 1: Add failing tests for `ConfluenceService.upsertArticle()`**

Append to `backend/src/modules/connectors/connectors.service.spec.ts`:

```typescript
// ---------- ConfluenceService ----------

import { ConfluenceService } from './confluence.service';

function makeCfService(prisma: any) {
  return new (ConfluenceService as any)(
    prisma,
    mockKbService,
    { getConfig: jest.fn(), encrypt: jest.fn(), decrypt: jest.fn() },
    new ContentConverterService(),
  );
}

const cfRemote = { id: 'cf-page-1', title: 'CF Page', body: '<p>Confluence body</p>', version: '3', webUrl: 'https://myorg.atlassian.net/wiki/page' };

describe('ConfluenceService.upsertArticle()', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('creates new article when externalId not found', async () => {
    const prisma = makeSpPrisma(null);
    prisma.kbArticle.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'new-id', status: KbArticleStatus.PUBLISHED, title: 'CF Page', body: '# CF', tags: [], slug: 'cf', publishedAt: new Date() });
    const svc = makeCfService(prisma);
    const log = { ...logRef };
    await svc.upsertArticle(cfRemote, log);
    expect(prisma.kbArticle.create).toHaveBeenCalled();
    expect(mockKbService.indexArticle).toHaveBeenCalled();
    expect(log.articlesNew).toBe(1);
  });

  it('skips when externalVersion matches', async () => {
    const existing = { id: 'art-2', externalId: 'cf-page-1', externalVersion: '3', updatedAt: new Date(), lastSyncedAt: new Date() };
    const prisma = makeSpPrisma(existing);
    const svc = makeCfService(prisma);
    const log = { ...logRef };
    await svc.upsertArticle(cfRemote, log);
    expect(prisma.kbArticle.update).not.toHaveBeenCalled();
  });

  it('updates article when remote changed and no local edits', async () => {
    const lastSyncedAt = new Date(Date.now() - 10000);
    const updatedAt = new Date(Date.now() - 20000);
    const existing = { id: 'art-2', externalId: 'cf-page-1', externalVersion: '2', status: KbArticleStatus.PUBLISHED, updatedAt, lastSyncedAt };
    const prisma = makeSpPrisma(existing);
    const svc = makeCfService(prisma);
    const log = { ...logRef };
    await svc.upsertArticle(cfRemote, log);
    expect(prisma.kbArticle.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalVersion: '3' }),
    }));
    expect(log.articlesUpdated).toBe(1);
  });

  it('sets syncConflict when both sides edited', async () => {
    const lastSyncedAt = new Date(Date.now() - 10000);
    const updatedAt = new Date(Date.now() - 5000);
    const existing = { id: 'art-2', externalId: 'cf-page-1', externalVersion: '2', updatedAt, lastSyncedAt };
    const prisma = makeSpPrisma(existing);
    const svc = makeCfService(prisma);
    const log = { ...logRef };
    await svc.upsertArticle(cfRemote, log);
    expect(prisma.kbArticle.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ syncConflict: true }),
    }));
    expect(log.conflicts).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd backend
npm test -- connectors.service.spec.ts 2>&1 | grep -E "FAIL|Cannot find"
```

Expected: `Cannot find module './confluence.service'`

- [ ] **Step 3: Implement `ConfluenceService`**

Create `backend/src/modules/connectors/confluence.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { KbArticleStatus, KbSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KbService } from '../kb/kb.service';
import { ConnectorConfigService, ConfluenceConfig } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';

interface ExternalItem {
  id: string;
  title: string;
  body: string;
  version: string;
  webUrl: string;
}

interface LogRef {
  id: string;
  articlesNew: number;
  articlesUpdated: number;
  conflicts: number;
}

@Injectable()
export class ConfluenceService {
  private readonly logger = new Logger(ConfluenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kb: KbService,
    private readonly configService: ConnectorConfigService,
    private readonly converter: ContentConverterService,
  ) {}

  private authHeader(config: ConfluenceConfig): string {
    return 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  }

  private async fetchWithRetry(url: string, auth: string, options?: RequestInit, retries = 3): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      const res = await fetch(url, {
        ...options,
        headers: { Authorization: auth, 'Content-Type': 'application/json', ...(options?.headers as Record<string, string> ?? {}) },
      });
      if (res.status !== 429) return res;
      const after = parseInt(res.headers.get('retry-after') ?? '5', 10);
      await new Promise(r => setTimeout(r, after * 1000));
    }
    throw new Error(`Max retries exceeded for ${url}`);
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const config = await this.configService.getConfig('confluence');
    if (!config) return { ok: false, message: 'Not configured' };
    try {
      const res = await this.fetchWithRetry(`${config.baseUrl}/wiki/rest/api/space`, this.authHeader(config));
      if (res.ok) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `API error: ${res.status}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async sync() {
    const config = await this.configService.getConfig('confluence');
    if (!config) throw new Error('Confluence not configured');
    const log = await this.prisma.kbSyncLog.create({
      data: { connector: KbSource.CONFLUENCE, startedAt: new Date(), status: 'running' },
    });
    const logRef: LogRef = { id: log.id, articlesNew: 0, articlesUpdated: 0, conflicts: 0 };
    try {
      const auth = this.authHeader(config);
      const items: ExternalItem[] = [];

      if (config.syncType === 'space') {
        const res = await this.fetchWithRetry(
          `${config.baseUrl}/wiki/rest/api/content?spaceKey=${config.spaceKey}&type=page&status=current&expand=body.storage,version`,
          auth,
        );
        const data = await res.json() as { results: any[] };
        for (const p of (data.results ?? [])) {
          items.push({ id: p.id, title: p.title, body: p.body?.storage?.value ?? '', version: String(p.version?.number ?? 0), webUrl: `${config.baseUrl}/wiki${p._links?.webui ?? ''}` });
        }
      } else {
        const pages = await this.fetchDescendants(config, auth, config.rootPageId!);
        items.push(...pages);
      }

      for (const item of items) {
        await this.upsertArticle(item, logRef);
      }

      // Push local edits outbound
      const localEdited = await this.prisma.kbArticle.findMany({
        where: { source: KbSource.CONFLUENCE, syncConflict: false, externalId: { not: null } },
      });
      for (const article of localEdited) {
        if (article.lastSyncedAt && article.updatedAt > article.lastSyncedAt) {
          await this.pushArticle(article as any);
        }
      }

      const status = logRef.conflicts > 0 ? 'partial' : 'success';
      return this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { completedAt: new Date(), status } });
    } catch (e) {
      return this.prisma.kbSyncLog.update({
        where: { id: log.id },
        data: { completedAt: new Date(), status: 'failed', errorMessage: (e as Error).message },
      });
    }
  }

  private async fetchDescendants(config: ConfluenceConfig, auth: string, rootPageId: string): Promise<ExternalItem[]> {
    const res = await this.fetchWithRetry(
      `${config.baseUrl}/wiki/rest/api/content/${rootPageId}/descendant/page?expand=body.storage,version`,
      auth,
    );
    const data = await res.json() as { results: any[] };
    return (data.results ?? []).map((p: any) => ({
      id: p.id, title: p.title, body: p.body?.storage?.value ?? '',
      version: String(p.version?.number ?? 0),
      webUrl: `${config.baseUrl}/wiki${p._links?.webui ?? ''}`,
    }));
  }

  async upsertArticle(item: ExternalItem, log: LogRef): Promise<void> {
    const existing = await this.prisma.kbArticle.findFirst({ where: { externalId: item.id } });
    const markdown = this.converter.htmlToMarkdown(item.body);

    if (!existing) {
      const slug = item.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Math.random().toString(36).slice(2, 8);
      await this.prisma.kbArticle.create({
        data: {
          title: item.title, body: markdown, tags: [],
          status: KbArticleStatus.PUBLISHED, slug,
          source: KbSource.CONFLUENCE, externalId: item.id,
          externalVersion: item.version, externalUrl: item.webUrl,
          lastSyncedAt: new Date(), publishedAt: new Date(), authorId: null,
        },
      });
      const created = await this.prisma.kbArticle.findFirst({ where: { externalId: item.id } });
      if (created) await this.kb.indexArticle(created);
      await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { articlesNew: { increment: 1 } } });
      log.articlesNew++;
      return;
    }

    if (existing.externalVersion === item.version) return;

    const localEdited = existing.lastSyncedAt ? existing.updatedAt > existing.lastSyncedAt : false;

    if (localEdited) {
      await this.prisma.kbArticle.update({
        where: { id: existing.id },
        data: {
          syncConflict: true,
          conflictData: { remoteTitle: item.title, remoteBody: markdown, remoteVersion: item.version, detectedAt: new Date().toISOString() },
        },
      });
      await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { conflicts: { increment: 1 } } });
      log.conflicts++;
      return;
    }

    const updated = await this.prisma.kbArticle.update({
      where: { id: existing.id },
      data: { title: item.title, body: markdown, externalVersion: item.version, lastSyncedAt: new Date() },
    });
    if (updated.status === KbArticleStatus.PUBLISHED) await this.kb.indexArticle(updated);
    await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { articlesUpdated: { increment: 1 } } });
    log.articlesUpdated++;
  }

  async pushArticle(article: { id: string; title: string; body: string; externalId: string | null; externalVersion: string | null }): Promise<void> {
    const config = await this.configService.getConfig('confluence');
    if (!config || !article.externalId) return;
    const auth = this.authHeader(config);
    const html = this.converter.markdownToHtml(article.body);
    const currentVersion = parseInt(article.externalVersion ?? '0', 10);
    const res = await this.fetchWithRetry(
      `${config.baseUrl}/wiki/rest/api/content/${article.externalId}`,
      auth,
      {
        method: 'PUT',
        body: JSON.stringify({ version: { number: currentVersion + 1 }, body: { storage: { value: html, representation: 'storage' } } }),
      },
    );
    if (!res.ok) { this.logger.warn(`Confluence push failed for article ${article.id}: ${res.status}`); return; }
    const updated = await res.json() as { version?: { number: number } };
    await this.prisma.kbArticle.update({
      where: { id: article.id },
      data: { externalVersion: String(updated.version?.number ?? currentVersion + 1), lastSyncedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Run the tests — expect all 14 tests to pass**

```bash
cd backend
npm test -- connectors.service.spec.ts 2>&1 | tail -10
```

Expected: `Tests: 14 passed, 14 total`

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/connectors/confluence.service.ts \
        backend/src/modules/connectors/connectors.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(connectors): ConfluenceService with Basic auth, upsertArticle, pushArticle

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Module Wiring — `ConnectorsService`, `SyncSchedulerService`, `ConnectorsController`, `ConnectorsModule`, `AppModule`

**Files:**
- Create: `backend/src/modules/connectors/dto/connector-config.dto.ts`
- Create: `backend/src/modules/connectors/dto/resolve-conflict.dto.ts`
- Create: `backend/src/modules/connectors/connectors.service.ts`
- Create: `backend/src/modules/connectors/sync-scheduler.service.ts`
- Create: `backend/src/modules/connectors/connectors.controller.ts`
- Create: `backend/src/modules/connectors/connectors.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/modules/connectors/connectors.service.spec.ts`

- [ ] **Step 1: Add failing tests for conflict resolution**

Append to `backend/src/modules/connectors/connectors.service.spec.ts`:

```typescript
// ---------- ConnectorsService (conflict resolution) ----------

import { ConnectorsService } from './connectors.service';

const mockSharePoint = { pushArticle: jest.fn().mockResolvedValue(undefined) };
const mockConfluence = { pushArticle: jest.fn().mockResolvedValue(undefined) };

function makeConflictPrisma(article: any) {
  return {
    kbArticle: {
      findUnique: jest.fn().mockResolvedValue(article),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...article, ...data })),
    },
  };
}

function makeConnectorsService(prisma: any) {
  return new (ConnectorsService as any)(
    prisma,
    mockKbService,
    mockSharePoint,
    mockConfluence,
    { getConfig: jest.fn().mockResolvedValue({ syncType: 'pages', siteUrl: 'https://sp.com', tenantId: 't', clientId: 'c', clientSecret: 's', enabled: true, syncIntervalMinutes: 60 }) },
  );
}

const conflictArticle = {
  id: 'art-c1', title: 'Conflict Art', body: 'local body', source: 'SHAREPOINT',
  syncConflict: true, externalId: 'ext-1', externalVersion: 'v1',
  conflictData: { remoteTitle: 'Remote Title', remoteBody: 'remote body', remoteVersion: 'v2', detectedAt: new Date().toISOString() },
};

describe('ConnectorsService conflict resolution', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('LOCAL: pushes local body outbound and clears conflict', async () => {
    const prisma = makeConflictPrisma(conflictArticle);
    const svc = makeConnectorsService(prisma);
    await svc.resolveConflict('art-c1', 'LOCAL');
    expect(mockSharePoint.pushArticle).toHaveBeenCalledWith(conflictArticle);
    expect(prisma.kbArticle.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ syncConflict: false, conflictData: null }),
    }));
    expect(mockKbService.indexArticle).not.toHaveBeenCalled();
  });

  it('REMOTE: overwrites local body with remoteBody and re-indexes', async () => {
    const prisma = makeConflictPrisma(conflictArticle);
    const svc = makeConnectorsService(prisma);
    await svc.resolveConflict('art-c1', 'REMOTE');
    expect(prisma.kbArticle.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ body: 'remote body', externalVersion: 'v2', syncConflict: false }),
    }));
    expect(mockKbService.indexArticle).toHaveBeenCalled();
    expect(mockSharePoint.pushArticle).not.toHaveBeenCalled();
  });

  it('MERGED: saves mergedBody, pushes outbound, and re-indexes', async () => {
    const prisma = makeConflictPrisma(conflictArticle);
    const svc = makeConnectorsService(prisma);
    await svc.resolveConflict('art-c1', 'MERGED', 'merged body');
    expect(prisma.kbArticle.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ body: 'merged body', syncConflict: false }),
    }));
    expect(mockSharePoint.pushArticle).toHaveBeenCalled();
    expect(mockKbService.indexArticle).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd backend
npm test -- connectors.service.spec.ts 2>&1 | grep -E "Cannot find|FAIL"
```

Expected: `Cannot find module './connectors.service'`

- [ ] **Step 3: Create DTOs**

Create `backend/src/modules/connectors/dto/connector-config.dto.ts`:

```typescript
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SaveSharePointConfigDto {
  @IsString() tenantId!: string;
  @IsString() clientId!: string;
  @IsString() clientSecret!: string;
  @IsString() siteUrl!: string;
  @IsEnum(['library', 'pages']) syncType!: 'library' | 'pages';
  @IsString() @IsOptional() libraryName?: string;
  @IsString() @IsOptional() rootPageId?: string;
  @IsBoolean() enabled!: boolean;
  @IsNumber() @Min(1) syncIntervalMinutes!: number;
}

export class SaveConfluenceConfigDto {
  @IsString() baseUrl!: string;
  @IsString() email!: string;
  @IsString() apiToken!: string;
  @IsEnum(['space', 'pagetree']) syncType!: 'space' | 'pagetree';
  @IsString() @IsOptional() spaceKey?: string;
  @IsString() @IsOptional() rootPageId?: string;
  @IsBoolean() enabled!: boolean;
  @IsNumber() @Min(1) syncIntervalMinutes!: number;
}
```

Create `backend/src/modules/connectors/dto/resolve-conflict.dto.ts`:

```typescript
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ResolveConflictDto {
  @IsEnum(['LOCAL', 'REMOTE', 'MERGED']) resolution!: 'LOCAL' | 'REMOTE' | 'MERGED';
  @IsString() @IsOptional() mergedBody?: string;
}
```

- [ ] **Step 4: Implement `ConnectorsService`**

Create `backend/src/modules/connectors/connectors.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { KbSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KbService } from '../kb/kb.service';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { ConnectorConfigService } from './connectors-config.service';

@Injectable()
export class ConnectorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kb: KbService,
    private readonly sharepoint: SharePointService,
    private readonly confluence: ConfluenceService,
    private readonly configService: ConnectorConfigService,
  ) {}

  listConflicts() {
    return this.prisma.kbArticle.findMany({
      where: { syncConflict: true },
      select: { id: true, title: true, source: true, conflictData: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async resolveConflict(articleId: string, resolution: 'LOCAL' | 'REMOTE' | 'MERGED', mergedBody?: string) {
    const article = await this.prisma.kbArticle.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundException(`Article ${articleId} not found`);
    if (!article.syncConflict) throw new BadRequestException('Article is not in conflict');

    const conflictData = article.conflictData as { remoteBody: string; remoteVersion: string } | null;

    if (resolution === 'LOCAL') {
      article.source === KbSource.SHAREPOINT
        ? await this.sharepoint.pushArticle(article as any)
        : await this.confluence.pushArticle(article as any);
      await this.prisma.kbArticle.update({
        where: { id: articleId },
        data: { syncConflict: false, conflictData: null },
      });
      return;
    }

    if (resolution === 'REMOTE') {
      if (!conflictData) throw new BadRequestException('No conflict data');
      const updated = await this.prisma.kbArticle.update({
        where: { id: articleId },
        data: { body: conflictData.remoteBody, externalVersion: conflictData.remoteVersion, lastSyncedAt: new Date(), syncConflict: false, conflictData: null },
      });
      await this.kb.indexArticle(updated);
      return;
    }

    if (resolution === 'MERGED') {
      if (!mergedBody) throw new BadRequestException('mergedBody required for MERGED resolution');
      const updated = await this.prisma.kbArticle.update({
        where: { id: articleId },
        data: { body: mergedBody, syncConflict: false, conflictData: null },
      });
      article.source === KbSource.SHAREPOINT
        ? await this.sharepoint.pushArticle(updated as any)
        : await this.confluence.pushArticle(updated as any);
      await this.kb.indexArticle(updated);
    }
  }

  getLogs() {
    return this.prisma.kbSyncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 20 });
  }
}
```

- [ ] **Step 5: Implement `SyncSchedulerService`**

Create `backend/src/modules/connectors/sync-scheduler.service.ts`:

```typescript
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { ConnectorConfigService } from './connectors-config.service';

@Injectable()
export class SyncSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncSchedulerService.name);
  private spTimer: NodeJS.Timeout | null = null;
  private cfTimer: NodeJS.Timeout | null = null;
  private spSyncing = false;
  private cfSyncing = false;

  constructor(
    private readonly sharepoint: SharePointService,
    private readonly confluence: ConfluenceService,
    private readonly configService: ConnectorConfigService,
  ) {}

  async onModuleInit() {
    await this.registerSharePoint();
    await this.registerConfluence();
  }

  onModuleDestroy() {
    if (this.spTimer) clearInterval(this.spTimer);
    if (this.cfTimer) clearInterval(this.cfTimer);
  }

  async registerSharePoint() {
    if (this.spTimer) clearInterval(this.spTimer);
    const config = await this.configService.getConfig('sharepoint');
    if (!config?.enabled) return;
    const ms = config.syncIntervalMinutes * 60 * 1000;
    this.spTimer = setInterval(() => this.runSharePoint(), ms);
    this.logger.log(`SharePoint sync scheduled every ${config.syncIntervalMinutes}min`);
  }

  async registerConfluence() {
    if (this.cfTimer) clearInterval(this.cfTimer);
    const config = await this.configService.getConfig('confluence');
    if (!config?.enabled) return;
    const ms = config.syncIntervalMinutes * 60 * 1000;
    this.cfTimer = setInterval(() => this.runConfluence(), ms);
    this.logger.log(`Confluence sync scheduled every ${config.syncIntervalMinutes}min`);
  }

  async runSharePoint() {
    if (this.spSyncing) { this.logger.log('SharePoint sync already running, skipping'); return; }
    this.spSyncing = true;
    try { await this.sharepoint.sync(); } catch (e) { this.logger.error('SharePoint sync error', (e as Error).message); } finally { this.spSyncing = false; }
  }

  async runConfluence() {
    if (this.cfSyncing) { this.logger.log('Confluence sync already running, skipping'); return; }
    this.cfSyncing = true;
    try { await this.confluence.sync(); } catch (e) { this.logger.error('Confluence sync error', (e as Error).message); } finally { this.cfSyncing = false; }
  }
}
```

- [ ] **Step 6: Implement `ConnectorsController`**

Create `backend/src/modules/connectors/connectors.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { ConnectorConfigService } from './connectors-config.service';
import { ConnectorsService } from './connectors.service';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { SyncSchedulerService } from './sync-scheduler.service';
import { SaveSharePointConfigDto, SaveConfluenceConfigDto } from './dto/connector-config.dto';
import { ResolveConflictDto } from './dto/resolve-conflict.dto';

@Controller('connectors')
@Roles(Role.ADMIN)
export class ConnectorsController {
  constructor(
    private readonly configService: ConnectorConfigService,
    private readonly connectorsService: ConnectorsService,
    private readonly sharepoint: SharePointService,
    private readonly confluence: ConfluenceService,
    private readonly scheduler: SyncSchedulerService,
  ) {}

  @Get('sharepoint/config')
  getSharePointConfig() { return this.configService.getRedactedConfig('sharepoint'); }

  @Put('sharepoint/config')
  async saveSharePointConfig(@Body() dto: SaveSharePointConfigDto) {
    await this.configService.saveConfig('sharepoint', dto);
    await this.scheduler.registerSharePoint();
    return { ok: true };
  }

  @Post('sharepoint/test')
  testSharePoint() { return this.sharepoint.testConnection(); }

  @Post('sharepoint/sync')
  syncSharePoint() { return this.scheduler.runSharePoint(); }

  @Get('confluence/config')
  getConfluenceConfig() { return this.configService.getRedactedConfig('confluence'); }

  @Put('confluence/config')
  async saveConfluenceConfig(@Body() dto: SaveConfluenceConfigDto) {
    await this.configService.saveConfig('confluence', dto);
    await this.scheduler.registerConfluence();
    return { ok: true };
  }

  @Post('confluence/test')
  testConfluence() { return this.confluence.testConnection(); }

  @Post('confluence/sync')
  syncConfluence() { return this.scheduler.runConfluence(); }

  @Get('conflicts')
  listConflicts() { return this.connectorsService.listConflicts(); }

  @Post('conflicts/:articleId/resolve')
  resolveConflict(@Param('articleId') articleId: string, @Body() dto: ResolveConflictDto) {
    return this.connectorsService.resolveConflict(articleId, dto.resolution, dto.mergedBody);
  }

  @Get('logs')
  getLogs() { return this.connectorsService.getLogs(); }
}
```

- [ ] **Step 7: Create `ConnectorsModule` and wire into `AppModule`**

Create `backend/src/modules/connectors/connectors.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { KbModule } from '../kb/kb.module';
import { ConnectorConfigService } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { ConnectorsService } from './connectors.service';
import { SyncSchedulerService } from './sync-scheduler.service';
import { ConnectorsController } from './connectors.controller';

@Module({
  imports: [KbModule],
  controllers: [ConnectorsController],
  providers: [
    ConnectorConfigService,
    ContentConverterService,
    SharePointService,
    ConfluenceService,
    ConnectorsService,
    SyncSchedulerService,
  ],
})
export class ConnectorsModule {}
```

In `backend/src/app.module.ts`, add the import:

```typescript
import { ConnectorsModule } from './modules/connectors/connectors.module';
```

And add `ConnectorsModule` to the `imports` array after `KbModule`:

```typescript
    KbModule,
    ConnectorsModule,
```

- [ ] **Step 8: Run all tests — expect 17 passing**

```bash
cd backend
npm test -- connectors.service.spec.ts 2>&1 | tail -10
```

Expected: `Tests: 17 passed, 17 total`

- [ ] **Step 9: Verify backend builds**

```bash
cd backend
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/connectors/
git add backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(connectors): ConnectorsModule wiring — service, scheduler, controller, DTOs

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `POST /kb/:id/export` Route

**Files:**
- Modify: `backend/src/modules/kb/kb.controller.ts`
- Modify: `backend/src/modules/kb/kb.service.ts`

- [ ] **Step 1: Add `exportArticle` to `KbService`**

In `backend/src/modules/kb/kb.service.ts`, add these imports at the top (after existing imports):

No new imports needed — the method delegates to `SharePointService` / `ConfluenceService`. Instead, the controller will call the platform services directly. Add `exportArticle` to `KbService` only to make `KbModule` self-contained; it accepts a connector string and delegates.

Add these to the imports in `kb.service.ts`:

```typescript
import { BadGatewayException } from '@nestjs/common';
```

Add the `exportArticle` method to `KbService` (at the end of the class, before the closing `}`):

```typescript
  async exportArticle(articleId: string, connector: 'SHAREPOINT' | 'CONFLUENCE') {
    const article = await this.prisma.kbArticle.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundException(`Article ${articleId} not found`);
    // Actual push is handled by ConnectorsModule; this method is a no-op hook
    // that lets KbController accept the export request and return 201.
    return { articleId, connector, queued: true };
  }
```

**Note:** The real export is wired through `ConnectorsController` calling `SharePointService.exportArticle()` or `ConfluenceService` directly. Since `KbController` cannot import `ConnectorsModule` (that would create a circular dependency), the `POST /kb/:id/export` endpoint lives in `KbController` and forwards via an injected interface. The cleanest approach without circular deps is to move the export endpoint into `ConnectorsController`. Update the spec route to: `POST /connectors/export/:articleId` with body `{ connector }`.

Replace the `exportArticle` method body with a simple NotFoundException guard and a delegated call. The complete implementation for this task is:

- [ ] **Step 2: Add the export route to `ConnectorsController`**

In `backend/src/modules/connectors/connectors.controller.ts`, add after the `getLogs` method:

```typescript
  @Post('export/:articleId')
  @Roles(Role.ADMIN, Role.MANAGER)
  async exportArticle(@Param('articleId') articleId: string, @Body() body: { connector: 'SHAREPOINT' | 'CONFLUENCE' }) {
    if (body.connector === 'SHAREPOINT') {
      await this.sharepoint.exportArticle(articleId);
    } else {
      await this.confluence.exportArticle(articleId);
    }
    return { ok: true };
  }
```

Also add `exportArticle` to `ConfluenceService`:

In `backend/src/modules/connectors/confluence.service.ts`, add after the `pushArticle` method:

```typescript
  async exportArticle(articleId: string): Promise<void> {
    const config = await this.configService.getConfig('confluence');
    if (!config) throw new Error('Confluence not configured');
    const article = await this.prisma.kbArticle.findUniqueOrThrow({ where: { id: articleId } });
    const auth = this.authHeader(config);
    const html = this.converter.markdownToHtml(article.body);
    const res = await fetch(`${config.baseUrl}/wiki/rest/api/content`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'page',
        title: article.title,
        space: { key: config.spaceKey ?? '' },
        body: { storage: { value: html, representation: 'storage' } },
      }),
    });
    if (!res.ok) throw new Error(`Confluence export failed: ${res.status} ${await res.text()}`);
    const created = await res.json() as { id: string; _links?: { webui?: string }; version?: { number: number } };
    await this.prisma.kbArticle.update({
      where: { id: articleId },
      data: { source: KbSource.CONFLUENCE, externalId: created.id, externalUrl: `${config.baseUrl}/wiki${created._links?.webui ?? ''}`, externalVersion: String(created.version?.number ?? 1), lastSyncedAt: new Date() },
    });
  }
```

- [ ] **Step 3: Verify backend builds cleanly**

```bash
cd backend
npm run build 2>&1 | tail -5
npm test 2>&1 | tail -10
```

Expected: build succeeds, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/connectors/connectors.controller.ts \
        backend/src/modules/connectors/confluence.service.ts
git commit -m "$(cat <<'EOF'
feat(connectors): POST /connectors/export/:articleId for SharePoint and Confluence

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend — Connectors Landing + SharePoint Config Page

**Files:**
- Create: `frontend/src/app/(app)/admin/connectors/page.tsx`
- Create: `frontend/src/app/(app)/admin/connectors/sharepoint/page.tsx`

- [ ] **Step 1: Create the connectors landing page**

Create `frontend/src/app/(app)/admin/connectors/page.tsx`:

```typescript
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ConnectorCard {
  label: string;
  color: string;
  href: string;
  connector: 'sharepoint' | 'confluence';
}

const CARDS: ConnectorCard[] = [
  { label: 'SharePoint', color: '#0078d4', href: '/admin/connectors/sharepoint', connector: 'sharepoint' },
  { label: 'Confluence', color: '#0052cc', href: '/admin/connectors/confluence', connector: 'confluence' },
];

interface ConnectorStatus {
  enabled: boolean;
  lastSync?: string;
  conflicts: number;
}

export default function ConnectorsPage() {
  const { data: session } = useSession();
  const [statuses, setStatuses] = useState<Record<string, ConnectorStatus>>({});

  useEffect(() => {
    if (!session) return;
    const auth = { Authorization: `Bearer ${(session as any)?.accessToken}` };
    const api = process.env.NEXT_PUBLIC_API_URL;

    async function load() {
      const [spRes, cfRes, conflictsRes] = await Promise.all([
        fetch(`${api}/connectors/sharepoint/config`, { headers: auth }),
        fetch(`${api}/connectors/confluence/config`, { headers: auth }),
        fetch(`${api}/connectors/conflicts`, { headers: auth }),
      ]);
      const conflicts: any[] = conflictsRes.ok ? await conflictsRes.json() : [];
      const spConflicts = conflicts.filter((c: any) => c.source === 'SHAREPOINT').length;
      const cfConflicts = conflicts.filter((c: any) => c.source === 'CONFLUENCE').length;

      const spConfig = spRes.ok ? await spRes.json() : null;
      const cfConfig = cfRes.ok ? await cfRes.json() : null;

      setStatuses({
        sharepoint: { enabled: spConfig?.enabled ?? false, conflicts: spConflicts },
        confluence: { enabled: cfConfig?.enabled ?? false, conflicts: cfConflicts },
      });
    }
    load().catch(() => {});
  }, [session]);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>External Connectors</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>Sync knowledge base articles with SharePoint and Confluence.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 640 }}>
        {CARDS.map(card => {
          const status = statuses[card.connector];
          return (
            <Link key={card.connector} href={card.href} style={{ textDecoration: 'none' }}>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a' }}>{card.label}</div>
                  {status && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: status.enabled ? '#dcfce7' : '#f1f5f9', color: status.enabled ? '#16a34a' : '#64748b', fontWeight: 600 }}>
                      {status.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  )}
                </div>
                {status?.conflicts > 0 && (
                  <Link href="/admin/connectors/conflicts" style={{ textDecoration: 'none' }}>
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#fee2e2', color: '#dc2626', fontWeight: 600 }}>
                      {status.conflicts} conflict{status.conflicts !== 1 ? 's' : ''}
                    </span>
                  </Link>
                )}
                <div style={{ color: '#64748b', fontSize: 14, marginTop: 4 }}>Configure sync settings and credentials.</div>
              </div>
            </Link>
          );
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        <Link href="/admin/connectors/conflicts" style={{ color: '#3b82f6', fontSize: 14 }}>View all conflicts →</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the SharePoint config page**

Create `frontend/src/app/(app)/admin/connectors/sharepoint/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface SPConfig {
  tenantId: string; clientId: string; clientSecret: string;
  siteUrl: string; syncType: 'library' | 'pages';
  libraryName?: string; rootPageId?: string;
  enabled: boolean; syncIntervalMinutes: number;
}

interface SyncLog {
  id: string; startedAt: string; completedAt?: string;
  status: string; articlesNew: number; articlesUpdated: number; conflicts: number;
}

const empty: SPConfig = { tenantId: '', clientId: '', clientSecret: '', siteUrl: '', syncType: 'pages', enabled: false, syncIntervalMinutes: 60 };

export default function SharePointPage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<SPConfig>(empty);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [saveMsg, setSaveMsg] = useState('');

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  async function load() {
    const api = process.env.NEXT_PUBLIC_API_URL;
    const [cfgRes, logsRes] = await Promise.all([
      fetch(`${api}/connectors/sharepoint/config`, { headers: authHeaders() }),
      fetch(`${api}/connectors/logs`, { headers: authHeaders() }),
    ]);
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg) setForm({ ...empty, ...cfg, clientSecret: '' });
    }
    if (logsRes.ok) {
      const allLogs: SyncLog[] = await logsRes.json();
      setLogs(allLogs.filter(l => (l as any).connector === 'SHAREPOINT').slice(0, 10));
    }
  }

  useEffect(() => { if (session) load().catch(() => {}); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true); setSaveMsg('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/sharepoint/config`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(form),
      });
      setSaveMsg(res.ok ? 'Saved.' : 'Save failed.');
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/sharepoint/test`, { method: 'POST', headers: authHeaders() });
      setTestResult(await res.json());
    } finally { setTesting(false); }
  }

  async function syncNow() {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/sharepoint/sync`, { method: 'POST', headers: authHeaders() });
      if (res.ok) {
        const log: SyncLog = await res.json();
        setSyncResult(`Done — ${log.articlesNew} new, ${log.articlesUpdated} updated, ${log.conflicts} conflicts`);
        await load();
      }
    } finally { setSyncing(false); }
  }

  function field(label: string, key: keyof SPConfig, type = 'text') {
    return (
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
        <input
          type={type} value={(form[key] as string) ?? ''}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
        />
      </div>
    );
  }

  const badge = (status: string) => {
    const colors: Record<string, string> = { success: '#dcfce7', partial: '#fef9c3', failed: '#fee2e2', running: '#dbeafe' };
    const text: Record<string, string> = { success: '#16a34a', partial: '#854d0e', failed: '#dc2626', running: '#1d4ed8' };
    return <span style={{ padding: '2px 8px', borderRadius: 12, background: colors[status] ?? '#f1f5f9', color: text[status] ?? '#374151', fontSize: 12, fontWeight: 600 }}>{status}</span>;
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>SharePoint Connector</h1>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Credentials</h2>
        {field('Tenant ID', 'tenantId')}
        {field('Client ID', 'clientId')}
        {field('Client Secret', 'clientSecret', 'password')}
        {field('Site URL', 'siteUrl')}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Sync Scope</label>
          <label style={{ marginRight: 16 }}><input type="radio" value="pages" checked={form.syncType === 'pages'} onChange={() => setForm(f => ({ ...f, syncType: 'pages' }))} /> Site Pages</label>
          <label><input type="radio" value="library" checked={form.syncType === 'library'} onChange={() => setForm(f => ({ ...f, syncType: 'library' }))} /> Document Library</label>
        </div>

        {form.syncType === 'library' && field('Library Name', 'libraryName')}
        {form.syncType === 'pages' && field('Root Page ID (optional)', 'rootPageId')}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Sync Interval</label>
          <select value={form.syncIntervalMinutes} onChange={e => setForm(f => ({ ...f, syncIntervalMinutes: Number(e.target.value) }))}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={360}>6 hours</option>
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
            Enable automatic sync
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={save} disabled={saving}
            style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={test} disabled={testing}
            style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button onClick={syncNow} disabled={syncing}
            style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
          {saveMsg && <span style={{ fontSize: 13, color: '#16a34a' }}>{saveMsg}</span>}
        </div>

        {testResult && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: testResult.ok ? '#dcfce7' : '#fee2e2', color: testResult.ok ? '#16a34a' : '#dc2626', fontSize: 13 }}>
            {testResult.message}
          </div>
        )}
        {syncResult && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: '#dbeafe', color: '#1d4ed8', fontSize: 13 }}>{syncResult}</div>
        )}
      </div>

      {logs.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Sync History</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#64748b' }}>Started</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>New</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>Updated</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>Conflicts</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: '#64748b' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px' }}>{new Date(log.startedAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{log.articlesNew}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{log.articlesUpdated}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{log.conflicts}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>{badge(log.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(app\)/admin/connectors/page.tsx \
        frontend/src/app/\(app\)/admin/connectors/sharepoint/page.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): connectors landing page and SharePoint config UI

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Frontend — Confluence Config Page + Conflicts Page

**Files:**
- Create: `frontend/src/app/(app)/admin/connectors/confluence/page.tsx`
- Create: `frontend/src/app/(app)/admin/connectors/conflicts/page.tsx`

- [ ] **Step 1: Create the Confluence config page**

Create `frontend/src/app/(app)/admin/connectors/confluence/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface CFConfig {
  baseUrl: string; email: string; apiToken: string;
  syncType: 'space' | 'pagetree';
  spaceKey?: string; rootPageId?: string;
  enabled: boolean; syncIntervalMinutes: number;
}

interface SyncLog {
  id: string; startedAt: string; completedAt?: string;
  status: string; articlesNew: number; articlesUpdated: number; conflicts: number;
}

const empty: CFConfig = { baseUrl: '', email: '', apiToken: '', syncType: 'space', enabled: false, syncIntervalMinutes: 60 };

export default function ConfluencePage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<CFConfig>(empty);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [saveMsg, setSaveMsg] = useState('');

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  async function load() {
    const api = process.env.NEXT_PUBLIC_API_URL;
    const [cfgRes, logsRes] = await Promise.all([
      fetch(`${api}/connectors/confluence/config`, { headers: authHeaders() }),
      fetch(`${api}/connectors/logs`, { headers: authHeaders() }),
    ]);
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg) setForm({ ...empty, ...cfg, apiToken: '' });
    }
    if (logsRes.ok) {
      const allLogs: SyncLog[] = await logsRes.json();
      setLogs(allLogs.filter(l => (l as any).connector === 'CONFLUENCE').slice(0, 10));
    }
  }

  useEffect(() => { if (session) load().catch(() => {}); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true); setSaveMsg('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/confluence/config`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(form),
      });
      setSaveMsg(res.ok ? 'Saved.' : 'Save failed.');
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/confluence/test`, { method: 'POST', headers: authHeaders() });
      setTestResult(await res.json());
    } finally { setTesting(false); }
  }

  async function syncNow() {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/confluence/sync`, { method: 'POST', headers: authHeaders() });
      if (res.ok) {
        const log: SyncLog = await res.json();
        setSyncResult(`Done — ${log.articlesNew} new, ${log.articlesUpdated} updated, ${log.conflicts} conflicts`);
        await load();
      }
    } finally { setSyncing(false); }
  }

  function field(label: string, key: keyof CFConfig, type = 'text') {
    return (
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
        <input type={type} value={(form[key] as string) ?? ''}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
      </div>
    );
  }

  const badge = (status: string) => {
    const colors: Record<string, string> = { success: '#dcfce7', partial: '#fef9c3', failed: '#fee2e2', running: '#dbeafe' };
    const text: Record<string, string> = { success: '#16a34a', partial: '#854d0e', failed: '#dc2626', running: '#1d4ed8' };
    return <span style={{ padding: '2px 8px', borderRadius: 12, background: colors[status] ?? '#f1f5f9', color: text[status] ?? '#374151', fontSize: 12, fontWeight: 600 }}>{status}</span>;
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>Confluence Connector</h1>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Credentials</h2>
        {field('Base URL', 'baseUrl')}
        {field('Email', 'email')}
        {field('API Token', 'apiToken', 'password')}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Sync Scope</label>
          <label style={{ marginRight: 16 }}><input type="radio" value="space" checked={form.syncType === 'space'} onChange={() => setForm(f => ({ ...f, syncType: 'space' }))} /> Full Space</label>
          <label><input type="radio" value="pagetree" checked={form.syncType === 'pagetree'} onChange={() => setForm(f => ({ ...f, syncType: 'pagetree' }))} /> Page Tree</label>
        </div>

        {form.syncType === 'space' && field('Space Key', 'spaceKey')}
        {form.syncType === 'pagetree' && field('Root Page ID', 'rootPageId')}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Sync Interval</label>
          <select value={form.syncIntervalMinutes} onChange={e => setForm(f => ({ ...f, syncIntervalMinutes: Number(e.target.value) }))}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={360}>6 hours</option>
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
            Enable automatic sync
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={save} disabled={saving}
            style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={test} disabled={testing}
            style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button onClick={syncNow} disabled={syncing}
            style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
          {saveMsg && <span style={{ fontSize: 13, color: '#16a34a' }}>{saveMsg}</span>}
        </div>

        {testResult && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: testResult.ok ? '#dcfce7' : '#fee2e2', color: testResult.ok ? '#16a34a' : '#dc2626', fontSize: 13 }}>
            {testResult.message}
          </div>
        )}
        {syncResult && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: '#dbeafe', color: '#1d4ed8', fontSize: 13 }}>{syncResult}</div>
        )}
      </div>

      {logs.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Sync History</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#64748b' }}>Started</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>New</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>Updated</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>Conflicts</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: '#64748b' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px' }}>{new Date(log.startedAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{log.articlesNew}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{log.articlesUpdated}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{log.conflicts}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>{badge(log.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the conflicts resolution page**

Create `frontend/src/app/(app)/admin/connectors/conflicts/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';

interface ConflictArticle {
  id: string;
  title: string;
  source: string;
  updatedAt: string;
  conflictData: { remoteTitle: string; remoteBody: string; remoteVersion: string; detectedAt: string };
}

export default function ConflictsPage() {
  const { data: session } = useSession();
  const [conflicts, setConflicts] = useState<ConflictArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ConflictArticle | null>(null);
  const [mergedBody, setMergedBody] = useState('');
  const [showMerge, setShowMerge] = useState(false);
  const [resolving, setResolving] = useState(false);

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${(session as any)?.accessToken}` };
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/conflicts`, { headers: authHeaders() });
      if (res.ok) setConflicts(await res.json());
    } finally { setLoading(false); }
  }

  useEffect(() => { if (session) load().catch(() => {}); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolve(articleId: string, resolution: 'LOCAL' | 'REMOTE' | 'MERGED', body?: string) {
    setResolving(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/conflicts/${articleId}/resolve`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ resolution, ...(body ? { mergedBody: body } : {}) }),
      });
      setSelected(null); setShowMerge(false); setMergedBody('');
      await load();
    } finally { setResolving(false); }
  }

  if (loading) return <div style={{ color: '#64748b', padding: 24 }}>Loading…</div>;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Sync Conflicts</h1>
      <p style={{ color: '#64748b', marginBottom: 24 }}>{conflicts.length} article{conflicts.length !== 1 ? 's' : ''} require resolution.</p>

      {conflicts.length === 0 && <p style={{ color: '#16a34a', fontWeight: 600 }}>No conflicts — all synced.</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748b' }}>Article</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748b' }}>Connector</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748b' }}>Detected</th>
            <th style={{ padding: '8px 12px' }} />
          </tr>
        </thead>
        <tbody>
          {conflicts.map(c => (
            <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '10px 12px', fontWeight: 600 }}>{c.title}</td>
              <td style={{ padding: '10px 12px' }}>
                <span style={{ padding: '2px 8px', borderRadius: 12, background: c.source === 'SHAREPOINT' ? '#dbeafe' : '#e0f2fe', color: c.source === 'SHAREPOINT' ? '#1d4ed8' : '#0369a1', fontSize: 12, fontWeight: 600 }}>
                  {c.source}
                </span>
              </td>
              <td style={{ padding: '10px 12px', color: '#64748b', fontSize: 13 }}>
                {new Date(c.conflictData?.detectedAt ?? c.updatedAt).toLocaleString()}
              </td>
              <td style={{ padding: '10px 12px' }}>
                <button onClick={() => { setSelected(c); setMergedBody(''); setShowMerge(false); }}
                  style={{ padding: '4px 12px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                  Review
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && (
        <div style={{ marginTop: 32, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Resolving: {selected.title}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Local Version</div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 16, fontSize: 13, maxHeight: 300, overflowY: 'auto' }}>
                <ReactMarkdown>{(selected as any).body ?? '(no local body available)'}</ReactMarkdown>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Remote Version ({selected.source})</div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 16, fontSize: 13, maxHeight: 300, overflowY: 'auto' }}>
                <ReactMarkdown>{selected.conflictData?.remoteBody ?? ''}</ReactMarkdown>
              </div>
            </div>
          </div>

          {!showMerge && (
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => resolve(selected.id, 'LOCAL')} disabled={resolving}
                style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                Keep Local
              </button>
              <button onClick={() => resolve(selected.id, 'REMOTE')} disabled={resolving}
                style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
                Accept Remote
              </button>
              <button onClick={() => { setShowMerge(true); setMergedBody((selected as any).body ?? ''); }}
                style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
                Edit Merged
              </button>
            </div>
          )}

          {showMerge && (
            <div>
              <textarea value={mergedBody} onChange={e => setMergedBody(e.target.value)}
                style={{ width: '100%', height: 240, padding: 12, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box', marginBottom: 12 }} />
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={() => resolve(selected.id, 'MERGED', mergedBody)} disabled={resolving || !mergedBody}
                  style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                  Save Merged
                </button>
                <button onClick={() => setShowMerge(false)}
                  style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(app\)/admin/connectors/confluence/page.tsx \
        frontend/src/app/\(app\)/admin/connectors/conflicts/page.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): Confluence config page and conflict resolution UI

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Frontend — Admin KB Updates + Admin Landing 4th Card

**Files:**
- Modify: `frontend/src/app/(app)/admin/page.tsx`
- Modify: `frontend/src/app/(app)/admin/kb/page.tsx`

- [ ] **Step 1: Add 4th card to admin landing page**

In `frontend/src/app/(app)/admin/page.tsx`, make two changes:

1. Change the grid `gridTemplateColumns` from `'1fr 1fr 1fr'` to `'1fr 1fr 1fr 1fr'`
2. Change `maxWidth` from `960` to `1200`
3. Add the Connectors card after the Knowledge Base card

The complete updated file:

```typescript
'use client';

import Link from 'next/link';

export default function AdminPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Admin</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>Configure routing rules, SLA policies, knowledge base articles, and external connectors.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 20, maxWidth: 1200 }}>
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
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add source badge and Export button to admin KB page**

In `frontend/src/app/(app)/admin/kb/page.tsx`:

First, update the `KbArticle` interface to include `source` and `externalUrl`:

```typescript
interface KbArticle {
  id: string; title: string; body: string; status: string;
  tags: string[]; viewCount: number; slug: string;
  publishedAt: string | null; updatedAt: string;
  author: { name: string } | null;
  source: string; externalUrl?: string;
}
```

Add export modal state after the existing state declarations:

```typescript
  const [exportModal, setExportModal] = useState<{ articleId: string; title: string } | null>(null);
  const [exportConnector, setExportConnector] = useState<'SHAREPOINT' | 'CONFLUENCE'>('SHAREPOINT');
  const [exporting, setExporting] = useState(false);
```

Add an `exportArticle` function after the `handleDelete` function:

```typescript
  async function exportArticle() {
    if (!exportModal) return;
    setExporting(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/export/${exportModal.articleId}`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ connector: exportConnector }),
      });
      setExportModal(null);
      await load();
    } finally { setExporting(false); }
  }
```

In the table row where article status is rendered, add a source badge in the same cell. Find the status column rendering and add the badge alongside it. Also add an Export button in the actions column for INTERNAL articles.

Locate the table row rendering code and add source badge logic. After the status badge span, add:

```typescript
{article.source !== 'INTERNAL' && (
  <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 6px', borderRadius: 10, background: article.source === 'SHAREPOINT' ? '#dbeafe' : '#e0f2fe', color: article.source === 'SHAREPOINT' ? '#1d4ed8' : '#0369a1', fontWeight: 600 }}>
    {article.source}
  </span>
)}
```

And in the Actions column, add the Export button for INTERNAL articles:

```typescript
{article.source === 'INTERNAL' && (
  <button onClick={() => setExportModal({ articleId: article.id, title: article.title })}
    style={{ marginLeft: 6, padding: '3px 10px', fontSize: 12, background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>
    Export
  </button>
)}
```

Add the export modal at the bottom of the JSX (before the closing `</div>`):

```typescript
      {exportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 32, width: 400 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Export Article</h2>
            <p style={{ color: '#64748b', marginBottom: 16, fontSize: 14 }}>{exportModal.title}</p>
            <div style={{ marginBottom: 20 }}>
              <label style={{ marginRight: 16 }}>
                <input type="radio" value="SHAREPOINT" checked={exportConnector === 'SHAREPOINT'} onChange={() => setExportConnector('SHAREPOINT')} /> SharePoint
              </label>
              <label>
                <input type="radio" value="CONFLUENCE" checked={exportConnector === 'CONFLUENCE'} onChange={() => setExportConnector('CONFLUENCE')} /> Confluence
              </label>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={exportArticle} disabled={exporting}
                style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                {exporting ? 'Exporting…' : 'Export'}
              </button>
              <button onClick={() => setExportModal(null)}
                style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(app\)/admin/page.tsx \
        frontend/src/app/\(app\)/admin/kb/page.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): admin landing 4th card, KB source badges, and Export button

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Frontend Component Tests

**Files:**
- Create: `frontend/src/app/(app)/admin/connectors/page.test.tsx`
- Create: `frontend/src/app/(app)/admin/connectors/conflicts/page.test.tsx`

- [ ] **Step 1: Write the ConnectorsPage test**

Create `frontend/src/app/(app)/admin/connectors/page.test.tsx`:

```typescript
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ConnectorsPage from './page';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' } }),
}));

jest.mock('next/link', () => ({ children, href }: any) => <a href={href}>{children}</a>);

global.fetch = jest.fn().mockImplementation((url: string) => {
  if (url.includes('/sharepoint/config')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: true, syncIntervalMinutes: 60 }) });
  }
  if (url.includes('/confluence/config')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: false, syncIntervalMinutes: 30 }) });
  }
  if (url.includes('/conflicts')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
}) as any;

describe('ConnectorsPage', () => {
  it('renders SharePoint and Confluence cards', async () => {
    render(<ConnectorsPage />);
    await waitFor(() => expect(screen.getByText('SharePoint')).toBeInTheDocument());
    expect(screen.getByText('Confluence')).toBeInTheDocument();
  });

  it('shows Enabled badge for SharePoint and Disabled for Confluence', async () => {
    render(<ConnectorsPage />);
    await waitFor(() => expect(screen.getByText('Enabled')).toBeInTheDocument());
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the ConflictsPage test**

Create `frontend/src/app/(app)/admin/connectors/conflicts/page.test.tsx`:

```typescript
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ConflictsPage from './page';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' } }),
}));

jest.mock('react-markdown', () => ({ children }: any) => <div>{children}</div>);

const mockConflicts = [
  {
    id: 'art-1', title: 'VPN Article', source: 'SHAREPOINT', updatedAt: new Date().toISOString(),
    conflictData: { remoteTitle: 'VPN Article', remoteBody: 'remote content', remoteVersion: 'v2', detectedAt: new Date().toISOString() },
  },
  {
    id: 'art-2', title: 'Confluence Doc', source: 'CONFLUENCE', updatedAt: new Date().toISOString(),
    conflictData: { remoteTitle: 'Confluence Doc', remoteBody: 'cf content', remoteVersion: '5', detectedAt: new Date().toISOString() },
  },
];

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve(mockConflicts),
}) as any;

describe('ConflictsPage', () => {
  it('renders conflict table with article titles', async () => {
    render(<ConflictsPage />);
    await waitFor(() => expect(screen.getByText('VPN Article')).toBeInTheDocument());
    expect(screen.getByText('Confluence Doc')).toBeInTheDocument();
  });

  it('shows connector source badges', async () => {
    render(<ConflictsPage />);
    await waitFor(() => expect(screen.getByText('SHAREPOINT')).toBeInTheDocument());
    expect(screen.getByText('CONFLUENCE')).toBeInTheDocument();
  });

  it('shows Review buttons for each conflict', async () => {
    render(<ConflictsPage />);
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: 'Review' });
      expect(buttons).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 3: Run the frontend tests**

```bash
cd frontend
npm test -- --testPathPattern="connectors" --watchAll=false 2>&1 | tail -20
```

Expected: `Tests: 5 passed, 5 total`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(app\)/admin/connectors/page.test.tsx \
        frontend/src/app/\(app\)/admin/connectors/conflicts/page.test.tsx
git commit -m "$(cat <<'EOF'
test(frontend): ConnectorsPage and ConflictsPage component tests

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final Verification and README Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run all backend tests**

```bash
cd backend
npm test 2>&1 | tail -15
```

Expected: all test suites pass, no failures.

- [ ] **Step 2: Run all frontend tests**

```bash
cd frontend
npm test -- --watchAll=false 2>&1 | tail -15
```

Expected: all test suites pass, no failures.

- [ ] **Step 3: Verify backend TypeScript build**

```bash
cd backend
npm run build 2>&1 | tail -5
```

Expected: exits with code 0, no TypeScript errors.

- [ ] **Step 4: Add Phase 4b section to README**

In `README.md`, find the Phase 4a section (Knowledge Base) and add after it:

```markdown
### Phase 4b — External KB Connectors (SharePoint + Confluence)

Bidirectional sync between the KB and external platforms.

**Backend**
- `ConnectorsModule` — `ConnectorConfigService` (AES-256-GCM encrypted credentials), `SharePointService` (OAuth 2.0 client-credentials via Microsoft Graph), `ConfluenceService` (API-token Basic auth), `SyncSchedulerService` (dynamic setInterval), `ConnectorsService` (conflict resolution)
- New env var: `CONNECTOR_ENCRYPTION_KEY` — generate with `openssl rand -hex 32`

**Admin UI**
- `/admin/connectors` — connector landing with status and conflict counts
- `/admin/connectors/sharepoint` — credentials, sync scope, interval, test/sync buttons, sync log history
- `/admin/connectors/confluence` — same for Confluence
- `/admin/connectors/conflicts` — side-by-side diff viewer, Keep Local / Accept Remote / Edit Merged resolution

**KB Admin enhancements**
- Source badge on all articles (INTERNAL / SHAREPOINT / CONFLUENCE)
- Export button on INTERNAL articles — exports to SharePoint or Confluence via modal
```

- [ ] **Step 5: Final commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: add Phase 4b connectors section to README

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
