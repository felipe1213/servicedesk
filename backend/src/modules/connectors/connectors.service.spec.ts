import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KbArticleStatus, KbSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectorConfigService } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';
import { SharePointService } from './sharepoint.service';

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
        { provide: PrismaService, useValue: mockPrisma },
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

// ---------- SharePointService ----------

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
    prisma.kbArticle.findFirst.mockResolvedValueOnce(null);
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
    prisma.kbArticle.findFirst.mockResolvedValueOnce(null);
    prisma.kbArticle.create.mockResolvedValueOnce({ id: 'new-id', status: KbArticleStatus.PUBLISHED, title: 'CF Page', body: '# CF', tags: [], slug: 'cf-page', publishedAt: new Date() });
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
