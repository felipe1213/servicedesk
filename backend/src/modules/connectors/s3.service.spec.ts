import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';
import { S3ConnectorService } from './s3.service';
import { PrismaService } from '../../prisma/prisma.service';
import { KbService } from '../kb/kb.service';
import { ConnectorConfigService } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';
import { S3Client } from '@aws-sdk/client-s3';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse') as jest.Mock;

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
      pdfParse.mockResolvedValue({ text: 'PDF text content' });
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
      pdfParse.mockRejectedValue(new Error('Invalid PDF'));
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
