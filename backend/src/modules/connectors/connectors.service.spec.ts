import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
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
