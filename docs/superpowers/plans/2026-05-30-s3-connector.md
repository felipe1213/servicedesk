# Amazon S3 KB Connector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Amazon S3 connector that syncs .md, .html, .txt, and .pdf files from an S3 bucket into the knowledge base, following the same pattern as the existing SharePoint and Confluence connectors.

**Architecture:** `S3ConnectorService` lists objects under a configured bucket+prefix, fetches changed files by ETag comparison, converts content to Markdown, and upserts KbArticle records. Config stored AES-256-GCM encrypted in AppConfig. Scheduler integrates into the existing `SyncSchedulerService`. Read-only — S3 is always source of truth (no conflict detection, no write-back).

**Tech Stack:** `@aws-sdk/client-s3` (v3), `pdf-parse`, existing `ContentConverterService` for HTML→Markdown, NestJS 10, Prisma 5, Next.js 14 App Router.

---

## File Map

| Action | Path |
|---|---|
| Create | `backend/src/modules/connectors/s3.service.ts` |
| Create | `backend/src/modules/connectors/s3.service.spec.ts` |
| Create | `frontend/src/app/(app)/admin/connectors/s3/page.tsx` |
| Modify | `backend/prisma/schema.prisma` |
| Create | `backend/prisma/migrations/<timestamp>_add_s3_kb_source/migration.sql` |
| Modify | `backend/src/modules/connectors/connectors-config.service.ts` |
| Modify | `backend/src/modules/connectors/connectors.controller.ts` |
| Modify | `backend/src/modules/connectors/connectors.module.ts` |
| Modify | `backend/src/modules/connectors/sync-scheduler.service.ts` |
| Modify | `backend/src/modules/connectors/dto/connector-config.dto.ts` |
| Modify | `frontend/src/app/(app)/admin/connectors/page.tsx` |

---

### Task 1: Install dependencies and Prisma migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_s3_kb_source/migration.sql`

- [ ] **Step 1: Install backend npm packages**

```bash
cd backend && npm install @aws-sdk/client-s3 pdf-parse && npm install -D @types/pdf-parse
```

Expected: packages installed, no peer dep errors.

- [ ] **Step 2: Add S3 to KbSource enum in schema**

Open `backend/prisma/schema.prisma`. The current `KbSource` enum (around line 45) is:

```prisma
enum KbSource {
  INTERNAL
  SHAREPOINT
  CONFLUENCE
}
```

Change it to:

```prisma
enum KbSource {
  INTERNAL
  SHAREPOINT
  CONFLUENCE
  S3
}
```

- [ ] **Step 3: Create the migration manually**

PostgreSQL enums cannot be altered in a transaction, so Prisma generates a raw SQL migration.

```bash
cd backend && npx prisma migrate dev --name add_s3_kb_source
```

Expected output ends with: `Your database is now in sync with your schema.`

If it prompts about the existing database being out of sync, press Enter to continue.

- [ ] **Step 4: Verify migration ran**

```bash
cd backend && npx prisma migrate status
```

Expected: all migrations listed as `Applied`.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/ backend/package.json backend/package-lock.json
git commit -m "feat: add S3 to KbSource enum and install aws-sdk + pdf-parse"
```

---

### Task 2: S3Config interface and DTO

**Files:**
- Modify: `backend/src/modules/connectors/connectors-config.service.ts`
- Modify: `backend/src/modules/connectors/dto/connector-config.dto.ts`

- [ ] **Step 1: Add S3Config interface and update ConnectorConfigService overloads**

Replace the entire contents of `backend/src/modules/connectors/connectors-config.service.ts`:

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

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  prefix: string;
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
    const hex = this.config.getOrThrow<string>('CONNECTOR_ENCRYPTION_KEY');
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('CONNECTOR_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    return Buffer.from(hex, 'hex');
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
  async getConfig(connector: 's3'): Promise<S3Config | null>;
  async getConfig(connector: 'sharepoint' | 'confluence' | 's3'): Promise<SharePointConfig | ConfluenceConfig | S3Config | null> {
    const record = await this.prisma.appConfig.findUnique({ where: { key: `connector.${connector}` } });
    if (!record) return null;
    try {
      const parsed = JSON.parse(record.value);
      if (connector === 'sharepoint') return { ...parsed, clientSecret: this.decrypt(parsed.clientSecret) };
      if (connector === 's3') return { ...parsed, secretAccessKey: this.decrypt(parsed.secretAccessKey) };
      return { ...parsed, apiToken: this.decrypt(parsed.apiToken) };
    } catch {
      throw new Error(`Connector config for ${connector} is corrupt or encrypted with a different key`);
    }
  }

  async getRedactedConfig(connector: 'sharepoint' | 'confluence' | 's3') {
    const cfg = await this.getConfig(connector as any);
    if (!cfg) return null;
    if (connector === 'sharepoint') return { ...(cfg as SharePointConfig), clientSecret: '***' };
    if (connector === 's3') return { ...(cfg as S3Config), secretAccessKey: '***' };
    return { ...(cfg as ConfluenceConfig), apiToken: '***' };
  }

  async saveConfig(connector: 'sharepoint', config: SharePointConfig): Promise<void>;
  async saveConfig(connector: 'confluence', config: ConfluenceConfig): Promise<void>;
  async saveConfig(connector: 's3', config: S3Config): Promise<void>;
  async saveConfig(connector: 'sharepoint' | 'confluence' | 's3', config: SharePointConfig | ConfluenceConfig | S3Config): Promise<void> {
    let toStore: Record<string, unknown>;
    if (connector === 'sharepoint') {
      const sp = config as SharePointConfig;
      toStore = { ...sp, clientSecret: this.encrypt(sp.clientSecret) };
    } else if (connector === 's3') {
      const s3 = config as S3Config;
      toStore = { ...s3, secretAccessKey: this.encrypt(s3.secretAccessKey) };
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

- [ ] **Step 2: Add SaveS3ConfigDto to the DTO file**

Open `backend/src/modules/connectors/dto/connector-config.dto.ts`. Append after `ExportArticleDto`:

```typescript
export class SaveS3ConfigDto {
  @IsString() @IsNotEmpty() accessKeyId!: string;
  @IsString() @IsNotEmpty() secretAccessKey!: string;
  @IsString() @IsNotEmpty() region!: string;
  @IsString() @IsNotEmpty() bucket!: string;
  @IsString() @IsOptional() prefix?: string;
  @IsBoolean() enabled!: boolean;
  @IsNumber() @Min(1) syncIntervalMinutes!: number;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/connectors/connectors-config.service.ts backend/src/modules/connectors/dto/connector-config.dto.ts
git commit -m "feat: add S3Config interface and SaveS3ConfigDto"
```

---

### Task 3: S3ConnectorService — write tests first

**Files:**
- Create: `backend/src/modules/connectors/s3.service.spec.ts`

- [ ] **Step 1: Write the test file**

Create `backend/src/modules/connectors/s3.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';
import { S3ConnectorService } from './s3.service';
import { PrismaService } from '../../prisma/prisma.service';
import { KbService } from '../kb/kb.service';
import { ConnectorConfigService } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';
import { S3Client } from '@aws-sdk/client-s3';
import pdfParse from 'pdf-parse';

jest.mock('@aws-sdk/client-s3');
jest.mock('pdf-parse');

const mockSend = jest.fn();
(S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

const S3_CONFIG = {
  accessKeyId: 'AKIA_TEST',
  secretAccessKey: 'secret',
  region: 'us-east-1',
  bucket: 'my-bucket',
  prefix: 'kb/',
  enabled: true,
  syncIntervalMinutes: 60,
};

const MOCK_LOG = { id: 'log-1', articlesNew: 0, articlesUpdated: 0, conflicts: 0 };
const MOCK_ARTICLE = {
  id: 'art-1', title: 'Test', body: '',
  externalId: 'my-bucket/kb/test.md',
  externalVersion: '"old"',
  status: 'PUBLISHED',
  lastSyncedAt: null,
};

function makeBody(content: string): Readable {
  return Readable.from([Buffer.from(content)]);
}

describe('S3ConnectorService', () => {
  let service: S3ConnectorService;
  let prisma: any;
  let configService: any;
  let kb: any;
  let converter: any;

  beforeEach(async () => {
    mockSend.mockReset();
    jest.clearAllMocks();
    (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3ConnectorService,
        {
          provide: PrismaService,
          useValue: {
            kbSyncLog: {
              create: jest.fn().mockResolvedValue(MOCK_LOG),
              update: jest.fn().mockResolvedValue({}),
            },
            kbArticle: {
              findFirst: jest.fn(),
              create: jest.fn().mockResolvedValue(MOCK_ARTICLE),
              update: jest.fn().mockResolvedValue({ ...MOCK_ARTICLE, status: 'PUBLISHED' }),
            },
          },
        },
        { provide: ConnectorConfigService, useValue: { getConfig: jest.fn() } },
        { provide: KbService, useValue: { indexArticle: jest.fn() } },
        { provide: ContentConverterService, useValue: { htmlToMarkdown: jest.fn() } },
      ],
    }).compile();

    service = module.get(S3ConnectorService);
    prisma = module.get(PrismaService);
    configService = module.get(ConnectorConfigService);
    kb = module.get(KbService);
    converter = module.get(ContentConverterService);
  });

  describe('testConnection', () => {
    it('returns ok:true when S3 responds', async () => {
      configService.getConfig.mockResolvedValue(S3_CONFIG);
      mockSend.mockResolvedValue({});

      const result = await service.testConnection();

      expect(result).toEqual({ ok: true, message: 'Connection successful' });
    });

    it('returns ok:false with message when S3 throws', async () => {
      configService.getConfig.mockResolvedValue(S3_CONFIG);
      mockSend.mockRejectedValue(new Error('Access Denied'));

      const result = await service.testConnection();

      expect(result).toEqual({ ok: false, message: 'Access Denied' });
    });
  });

  describe('sync', () => {
    it('creates a new KbArticle for a new .md file', async () => {
      configService.getConfig.mockResolvedValue(S3_CONFIG);
      prisma.kbArticle.findFirst.mockResolvedValue(null);
      mockSend
        .mockResolvedValueOnce({ Contents: [{ Key: 'kb/guide.md', ETag: '"etag1"' }], IsTruncated: false })
        .mockResolvedValueOnce({ Body: makeBody('# Guide\n\nContent') });

      await service.sync();

      expect(prisma.kbArticle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            externalId: 'my-bucket/kb/guide.md',
            externalVersion: '"etag1"',
            source: 'S3',
          }),
        }),
      );
      expect(kb.indexArticle).toHaveBeenCalled();
    });

    it('skips an object when ETag matches stored externalVersion', async () => {
      configService.getConfig.mockResolvedValue(S3_CONFIG);
      prisma.kbArticle.findFirst.mockResolvedValue({ ...MOCK_ARTICLE, externalVersion: '"etag1"' });
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: 'kb/test.md', ETag: '"etag1"' }],
        IsTruncated: false,
      });

      await service.sync();

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(prisma.kbArticle.create).not.toHaveBeenCalled();
      expect(prisma.kbArticle.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ body: expect.anything() }) }),
      );
    });

    it('updates an existing article when ETag changes', async () => {
      configService.getConfig.mockResolvedValue(S3_CONFIG);
      prisma.kbArticle.findFirst.mockResolvedValue({ ...MOCK_ARTICLE, externalVersion: '"old"' });
      mockSend
        .mockResolvedValueOnce({ Contents: [{ Key: 'kb/test.md', ETag: '"new"' }], IsTruncated: false })
        .mockResolvedValueOnce({ Body: makeBody('# Updated') });

      await service.sync();

      expect(prisma.kbArticle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ externalVersion: '"new"' }),
        }),
      );
    });

    it('converts .html file via ContentConverterService.htmlToMarkdown', async () => {
      configService.getConfig.mockResolvedValue(S3_CONFIG);
      prisma.kbArticle.findFirst.mockResolvedValue(null);
      converter.htmlToMarkdown.mockReturnValue('# Converted');
      mockSend
        .mockResolvedValueOnce({ Contents: [{ Key: 'kb/page.html', ETag: '"etag1"' }], IsTruncated: false })
        .mockResolvedValueOnce({ Body: makeBody('<h1>Page</h1>') });

      await service.sync();

      expect(converter.htmlToMarkdown).toHaveBeenCalledWith('<h1>Page</h1>');
      expect(prisma.kbArticle.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ body: '# Converted' }) }),
      );
    });

    it('extracts text from .pdf file via pdf-parse', async () => {
      configService.getConfig.mockResolvedValue(S3_CONFIG);
      prisma.kbArticle.findFirst.mockResolvedValue(null);
      (pdfParse as jest.Mock).mockResolvedValue({ text: 'PDF text content' });
      mockSend
        .mockResolvedValueOnce({ Contents: [{ Key: 'kb/manual.pdf', ETag: '"etag1"' }], IsTruncated: false })
        .mockResolvedValueOnce({ Body: makeBody('fake pdf bytes') });

      await service.sync();

      expect(pdfParse).toHaveBeenCalled();
      expect(prisma.kbArticle.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ body: 'PDF text content' }) }),
      );
    });

    it('logs warning and continues when pdf-parse throws on one file', async () => {
      configService.getConfig.mockResolvedValue(S3_CONFIG);
      prisma.kbArticle.findFirst.mockResolvedValue(null);
      (pdfParse as jest.Mock).mockRejectedValue(new Error('Invalid PDF'));
      mockSend
        .mockResolvedValueOnce({ Contents: [{ Key: 'kb/bad.pdf', ETag: '"etag1"' }], IsTruncated: false })
        .mockResolvedValueOnce({ Body: makeBody('garbage bytes') });

      await service.sync();

      expect(prisma.kbArticle.create).not.toHaveBeenCalled();
      expect(prisma.kbSyncLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'success' }) }),
      );
    });

    it('ignores files with unsupported extensions', async () => {
      configService.getConfig.mockResolvedValue(S3_CONFIG);
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: 'kb/image.png', ETag: '"etag1"' },
          { Key: 'kb/data.csv', ETag: '"etag2"' },
        ],
        IsTruncated: false,
      });

      await service.sync();

      expect(prisma.kbArticle.findFirst).not.toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (service doesn't exist yet)**

```bash
cd backend && npm test -- --testPathPattern=s3.service.spec --passWithNoTests 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module './s3.service'`

---

### Task 4: S3ConnectorService — implement

**Files:**
- Create: `backend/src/modules/connectors/s3.service.ts`

- [ ] **Step 1: Create the service**

Create `backend/src/modules/connectors/s3.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { KbArticleStatus, KbSource } from '@prisma/client';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import pdfParse from 'pdf-parse';
import { PrismaService } from '../../prisma/prisma.service';
import { KbService } from '../kb/kb.service';
import { ConnectorConfigService, S3Config } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';

const SUPPORTED_EXTENSIONS = ['.md', '.txt', '.html', '.pdf'] as const;

@Injectable()
export class S3ConnectorService {
  private readonly logger = new Logger(S3ConnectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kb: KbService,
    private readonly configService: ConnectorConfigService,
    private readonly converter: ContentConverterService,
  ) {}

  private makeClient(config: S3Config): S3Client {
    return new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private async readBody(body: Readable): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk as Uint8Array);
    return Buffer.concat(chunks);
  }

  private titleFromKey(key: string): string {
    const filename = key.split('/').pop() ?? key;
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const config = await this.configService.getConfig('s3');
    if (!config) return { ok: false, message: 'Not configured' };
    try {
      const client = this.makeClient(config);
      await client.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }));
      return { ok: true, message: 'Connection successful' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async sync() {
    const config = await this.configService.getConfig('s3');
    if (!config) throw new Error('S3 not configured');
    const log = await this.prisma.kbSyncLog.create({
      data: { connector: KbSource.S3, startedAt: new Date(), status: 'running' },
    });
    try {
      const client = this.makeClient(config);
      let continuationToken: string | undefined;

      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: config.prefix || undefined,
            ContinuationToken: continuationToken,
          }),
        );

        for (const obj of res.Contents ?? []) {
          const key = obj.Key!;
          const ext = key.substring(key.lastIndexOf('.')).toLowerCase();
          if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) continue;

          const externalId = `${config.bucket}/${key}`;
          const existing = await this.prisma.kbArticle.findFirst({ where: { externalId } });
          if (existing?.externalVersion === obj.ETag) continue;

          const getRes = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
          const buffer = await this.readBody(getRes.Body as Readable);

          let body: string;
          try {
            if (ext === '.pdf') {
              const parsed = await pdfParse(buffer);
              body = parsed.text;
            } else if (ext === '.html') {
              body = this.converter.htmlToMarkdown(buffer.toString('utf-8'));
            } else {
              body = buffer.toString('utf-8');
            }
          } catch (e) {
            this.logger.warn(`Skipping ${key}: ${(e as Error).message}`);
            continue;
          }

          const title = this.titleFromKey(key);
          const slug = `s3-${key.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

          if (!existing) {
            const created = await this.prisma.kbArticle.create({
              data: {
                title, body, tags: [],
                status: KbArticleStatus.PUBLISHED, slug,
                source: KbSource.S3, externalId,
                externalVersion: obj.ETag!,
                externalUrl: `s3://${config.bucket}/${key}`,
                lastSyncedAt: new Date(), publishedAt: new Date(), authorId: null,
              },
            });
            await this.kb.indexArticle(created);
            await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { articlesNew: { increment: 1 } } });
          } else {
            const updated = await this.prisma.kbArticle.update({
              where: { id: existing.id },
              data: { title, body, externalVersion: obj.ETag!, lastSyncedAt: new Date() },
            });
            if (updated.status === KbArticleStatus.PUBLISHED) await this.kb.indexArticle(updated);
            await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { articlesUpdated: { increment: 1 } } });
          }
        }

        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);

      return this.prisma.kbSyncLog.update({
        where: { id: log.id },
        data: { completedAt: new Date(), status: 'success' },
      });
    } catch (e) {
      return this.prisma.kbSyncLog.update({
        where: { id: log.id },
        data: { completedAt: new Date(), status: 'failed', errorMessage: (e as Error).message },
      });
    }
  }
}
```

- [ ] **Step 2: Run the tests**

```bash
cd backend && npm test -- --testPathPattern=s3.service.spec 2>&1 | tail -30
```

Expected: all 8 tests PASS.

If you see `SyntaxError: The requested module 'pdf-parse' does not provide an export named 'default'`, change the import in `s3.service.ts` to:

```typescript
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
```

And update the mock in `s3.service.spec.ts`:

```typescript
jest.mock('pdf-parse', () => jest.fn());
import pdfParse = require('pdf-parse');
// Replace (pdfParse as jest.Mock) with just pdfParse as jest.Mock directly
```

- [ ] **Step 3: Run all backend tests to check for regressions**

```bash
cd backend && npm test 2>&1 | tail -10
```

Expected: all tests pass (was 117 before this task).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/connectors/s3.service.ts backend/src/modules/connectors/s3.service.spec.ts
git commit -m "feat: add S3ConnectorService with testConnection and sync"
```

---

### Task 5: Wire backend — Scheduler, Controller, Module

**Files:**
- Modify: `backend/src/modules/connectors/sync-scheduler.service.ts`
- Modify: `backend/src/modules/connectors/connectors.controller.ts`
- Modify: `backend/src/modules/connectors/connectors.module.ts`

- [ ] **Step 1: Update SyncSchedulerService**

Replace the entire contents of `backend/src/modules/connectors/sync-scheduler.service.ts`:

```typescript
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { S3ConnectorService } from './s3.service';
import { ConnectorConfigService } from './connectors-config.service';

@Injectable()
export class SyncSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncSchedulerService.name);
  private spTimer: NodeJS.Timeout | null = null;
  private cfTimer: NodeJS.Timeout | null = null;
  private s3Timer: NodeJS.Timeout | null = null;
  private spSyncing = false;
  private cfSyncing = false;
  private s3Syncing = false;

  constructor(
    private readonly sharepoint: SharePointService,
    private readonly confluence: ConfluenceService,
    private readonly s3: S3ConnectorService,
    private readonly configService: ConnectorConfigService,
  ) {}

  async onModuleInit() {
    await this.registerSharePoint();
    await this.registerConfluence();
    await this.registerS3();
  }

  onModuleDestroy() {
    if (this.spTimer) clearInterval(this.spTimer);
    if (this.cfTimer) clearInterval(this.cfTimer);
    if (this.s3Timer) clearInterval(this.s3Timer);
  }

  async registerSharePoint() {
    if (this.spTimer) clearInterval(this.spTimer);
    try {
      const config = await this.configService.getConfig('sharepoint');
      if (!config?.enabled) return;
      const ms = config.syncIntervalMinutes * 60 * 1000;
      this.spTimer = setInterval(() => this.runSharePoint(), ms);
      this.logger.log(`SharePoint sync scheduled every ${config.syncIntervalMinutes}min`);
    } catch (e) {
      this.logger.warn(`Could not register SharePoint scheduler: ${(e as Error).message}`);
    }
  }

  async registerConfluence() {
    if (this.cfTimer) clearInterval(this.cfTimer);
    try {
      const config = await this.configService.getConfig('confluence');
      if (!config?.enabled) return;
      const ms = config.syncIntervalMinutes * 60 * 1000;
      this.cfTimer = setInterval(() => this.runConfluence(), ms);
      this.logger.log(`Confluence sync scheduled every ${config.syncIntervalMinutes}min`);
    } catch (e) {
      this.logger.warn(`Could not register Confluence scheduler: ${(e as Error).message}`);
    }
  }

  async registerS3() {
    if (this.s3Timer) clearInterval(this.s3Timer);
    try {
      const config = await this.configService.getConfig('s3');
      if (!config?.enabled) return;
      const ms = config.syncIntervalMinutes * 60 * 1000;
      this.s3Timer = setInterval(() => this.runS3(), ms);
      this.logger.log(`S3 sync scheduled every ${config.syncIntervalMinutes}min`);
    } catch (e) {
      this.logger.warn(`Could not register S3 scheduler: ${(e as Error).message}`);
    }
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

  async runS3() {
    if (this.s3Syncing) { this.logger.log('S3 sync already running, skipping'); return; }
    this.s3Syncing = true;
    try { await this.s3.sync(); } catch (e) { this.logger.error('S3 sync error', (e as Error).message); } finally { this.s3Syncing = false; }
  }
}
```

- [ ] **Step 2: Update ConnectorsController**

Replace the entire contents of `backend/src/modules/connectors/connectors.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { ConnectorConfigService } from './connectors-config.service';
import { ConnectorsService } from './connectors.service';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { S3ConnectorService } from './s3.service';
import { SyncSchedulerService } from './sync-scheduler.service';
import {
  SaveSharePointConfigDto,
  SaveConfluenceConfigDto,
  SaveS3ConfigDto,
  ExportArticleDto,
} from './dto/connector-config.dto';
import { ResolveConflictDto } from './dto/resolve-conflict.dto';

@Controller('connectors')
@Roles(Role.ADMIN)
export class ConnectorsController {
  constructor(
    private readonly configService: ConnectorConfigService,
    private readonly connectorsService: ConnectorsService,
    private readonly sharepoint: SharePointService,
    private readonly confluence: ConfluenceService,
    private readonly s3: S3ConnectorService,
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

  @Get('s3/config')
  getS3Config() { return this.configService.getRedactedConfig('s3'); }

  @Put('s3/config')
  async saveS3Config(@Body() dto: SaveS3ConfigDto) {
    await this.configService.saveConfig('s3', dto);
    await this.scheduler.registerS3();
    return { ok: true };
  }

  @Post('s3/test')
  testS3() { return this.s3.testConnection(); }

  @Post('s3/sync')
  syncS3() { return this.scheduler.runS3(); }

  @Get('conflicts')
  listConflicts() { return this.connectorsService.listConflicts(); }

  @Post('conflicts/:articleId/resolve')
  resolveConflict(@Param('articleId') articleId: string, @Body() dto: ResolveConflictDto) {
    return this.connectorsService.resolveConflict(articleId, dto.resolution, dto.mergedBody);
  }

  @Get('logs')
  getLogs() { return this.connectorsService.getLogs(); }

  @Post('export/:articleId')
  @Roles(Role.ADMIN, Role.MANAGER)
  async exportArticle(@Param('articleId') articleId: string, @Body() dto: ExportArticleDto) {
    if (dto.connector === 'SHAREPOINT') {
      await this.sharepoint.exportArticle(articleId);
    } else {
      await this.confluence.exportArticle(articleId);
    }
    return { ok: true };
  }
}
```

- [ ] **Step 3: Update ConnectorsModule**

Replace the entire contents of `backend/src/modules/connectors/connectors.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { KbModule } from '../kb/kb.module';
import { ConnectorConfigService } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { S3ConnectorService } from './s3.service';
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
    S3ConnectorService,
    ConnectorsService,
    SyncSchedulerService,
  ],
})
export class ConnectorsModule {}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 5: Run all tests**

```bash
cd backend && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/connectors/sync-scheduler.service.ts \
        backend/src/modules/connectors/connectors.controller.ts \
        backend/src/modules/connectors/connectors.module.ts
git commit -m "feat: wire S3ConnectorService into scheduler, controller, and module"
```

---

### Task 6: Frontend — S3 config page

**Files:**
- Create: `frontend/src/app/(app)/admin/connectors/s3/page.tsx`

- [ ] **Step 1: Create the directory and page**

```bash
mkdir -p "frontend/src/app/(app)/admin/connectors/s3"
```

Create `frontend/src/app/(app)/admin/connectors/s3/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  prefix: string;
  enabled: boolean;
  syncIntervalMinutes: number;
}

interface SyncLog {
  id: string; startedAt: string; completedAt?: string;
  status: string; articlesNew: number; articlesUpdated: number; conflicts: number;
  connector: string;
}

const empty: S3Config = {
  accessKeyId: '', secretAccessKey: '', region: '', bucket: '', prefix: '',
  enabled: false, syncIntervalMinutes: 60,
};

export default function S3ConnectorPage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<S3Config>(empty);
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
      fetch(`${api}/connectors/s3/config`, { headers: authHeaders() }),
      fetch(`${api}/connectors/logs`, { headers: authHeaders() }),
    ]);
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg) setForm({ ...empty, ...cfg, secretAccessKey: '' });
    }
    if (logsRes.ok) {
      const allLogs: SyncLog[] = await logsRes.json();
      setLogs(allLogs.filter((l) => l.connector === 'S3').slice(0, 10));
    }
  }

  useEffect(() => { if (session) load().catch(() => {}); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true); setSaveMsg('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/s3/config`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(form),
      });
      setSaveMsg(res.ok ? 'Saved.' : 'Save failed.');
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/s3/test`, {
        method: 'POST', headers: authHeaders(),
      });
      setTestResult(res.ok ? await res.json() : { ok: false, message: 'Connection test failed' });
    } finally { setTesting(false); }
  }

  async function syncNow() {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connectors/s3/sync`, {
        method: 'POST', headers: authHeaders(),
      });
      if (res.ok) {
        const log: SyncLog = await res.json();
        setSyncResult(`Done — ${log.articlesNew} new, ${log.articlesUpdated} updated, ${log.conflicts} conflicts`);
        await load();
      } else {
        setSyncResult('Sync failed');
      }
    } finally { setSyncing(false); }
  }

  function field(label: string, key: keyof S3Config, type = 'text', placeholder = '') {
    return (
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
        <input
          type={type}
          value={(form[key] as string) ?? ''}
          placeholder={placeholder}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
        />
      </div>
    );
  }

  const badge = (status: string) => {
    const bg: Record<string, string> = { success: '#dcfce7', partial: '#fef9c3', failed: '#fee2e2', running: '#dbeafe' };
    const fg: Record<string, string> = { success: '#16a34a', partial: '#854d0e', failed: '#dc2626', running: '#1d4ed8' };
    return (
      <span style={{ padding: '2px 8px', borderRadius: 12, background: bg[status] ?? '#f1f5f9', color: fg[status] ?? '#374151', fontSize: 12, fontWeight: 600 }}>
        {status}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>Amazon S3 Connector</h1>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Credentials</h2>
        {field('Access Key ID', 'accessKeyId')}
        {field('Secret Access Key', 'secretAccessKey', 'password')}
        {field('Region', 'region', 'text', 'us-east-1')}
        {field('Bucket', 'bucket')}
        {field('Prefix (optional)', 'prefix', 'text', 'kb/')}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Sync Interval</label>
          <select
            value={form.syncIntervalMinutes}
            onChange={(e) => setForm((f) => ({ ...f, syncIntervalMinutes: Number(e.target.value) }))}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={360}>6 hours</option>
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
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
          {saveMsg && (
            <span style={{ fontSize: 13, color: saveMsg === 'Saved.' ? '#16a34a' : '#dc2626' }}>{saveMsg}</span>
          )}
        </div>

        {testResult && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: testResult.ok ? '#dcfce7' : '#fee2e2', color: testResult.ok ? '#16a34a' : '#dc2626', fontSize: 13 }}>
            {testResult.message}
          </div>
        )}
        {syncResult && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: '#dbeafe', color: '#1d4ed8', fontSize: 13 }}>
            {syncResult}
          </div>
        )}
      </div>

      {logs.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Sync History</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#64748b' }}>Started</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>Duration</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>New</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>Updated</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', color: '#64748b' }}>Conflicts</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: '#64748b' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px' }}>{new Date(log.startedAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {log.completedAt
                      ? (() => {
                          const secs = Math.round((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000);
                          return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
                        })()
                      : '—'}
                  </td>
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

- [ ] **Step 2: Commit**

```bash
git add "frontend/src/app/(app)/admin/connectors/s3/"
git commit -m "feat: add Amazon S3 connector admin page"
```

---

### Task 7: Frontend — update connectors list page

**Files:**
- Modify: `frontend/src/app/(app)/admin/connectors/page.tsx`

- [ ] **Step 1: Update the connectors list page**

Replace the entire contents of `frontend/src/app/(app)/admin/connectors/page.tsx`:

```typescript
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ConnectorStatus {
  enabled: boolean;
  conflicts: number;
  lastSyncedAt: string | null;
}

const CARDS = [
  { label: 'SharePoint', connector: 'sharepoint' as const, href: '/admin/connectors/sharepoint' },
  { label: 'Confluence', connector: 'confluence' as const, href: '/admin/connectors/confluence' },
  { label: 'Amazon S3', connector: 's3' as const, href: '/admin/connectors/s3' },
];

export default function ConnectorsPage() {
  const { data: session } = useSession();
  const [statuses, setStatuses] = useState<Record<string, ConnectorStatus>>({});

  useEffect(() => {
    if (!session) return;
    const api = process.env.NEXT_PUBLIC_API_URL;

    async function load() {
      const auth = { Authorization: `Bearer ${(session as any)?.accessToken}` };
      const [spRes, cfRes, s3Res, conflictsRes, logsRes] = await Promise.all([
        fetch(`${api}/connectors/sharepoint/config`, { headers: auth }),
        fetch(`${api}/connectors/confluence/config`, { headers: auth }),
        fetch(`${api}/connectors/s3/config`, { headers: auth }),
        fetch(`${api}/connectors/conflicts`, { headers: auth }),
        fetch(`${api}/connectors/logs`, { headers: auth }),
      ]);
      const conflicts: any[] = conflictsRes.ok ? await conflictsRes.json() : [];
      const spConfig = spRes.ok ? await spRes.json() : null;
      const cfConfig = cfRes.ok ? await cfRes.json() : null;
      const s3Config = s3Res.ok ? await s3Res.json() : null;
      const allLogs: any[] = logsRes.ok ? await logsRes.json() : [];

      const lastSync = (connector: string) => {
        const log = allLogs.find((l: any) => l.connector === connector);
        return log?.startedAt ?? null;
      };

      setStatuses({
        sharepoint: { enabled: spConfig?.enabled ?? false, conflicts: conflicts.filter((c: any) => c.source === 'SHAREPOINT').length, lastSyncedAt: lastSync('SHAREPOINT') },
        confluence: { enabled: cfConfig?.enabled ?? false, conflicts: conflicts.filter((c: any) => c.source === 'CONFLUENCE').length, lastSyncedAt: lastSync('CONFLUENCE') },
        s3: { enabled: s3Config?.enabled ?? false, conflicts: 0, lastSyncedAt: lastSync('S3') },
      });
    }
    load().catch(() => {});
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>External Connectors</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>Sync knowledge base articles with SharePoint, Confluence, and Amazon S3.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, maxWidth: 960 }}>
        {CARDS.map((card) => {
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
                  <div>
                    <Link href="/admin/connectors/conflicts" style={{ textDecoration: 'none' }}>
                      <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#fee2e2', color: '#dc2626', fontWeight: 600 }}>
                        {status.conflicts} conflict{status.conflicts !== 1 ? 's' : ''}
                      </span>
                    </Link>
                  </div>
                )}
                <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
                  Last sync: {status?.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'Never'}
                </div>
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

- [ ] **Step 2: Run all backend tests one final time**

```bash
cd backend && npm test 2>&1 | tail -10
```

Expected: all tests pass (8 new S3 tests + all existing tests).

- [ ] **Step 3: Commit and push**

```bash
git add "frontend/src/app/(app)/admin/connectors/page.tsx"
git commit -m "feat: add Amazon S3 card to connectors list page"
git push origin master
```
