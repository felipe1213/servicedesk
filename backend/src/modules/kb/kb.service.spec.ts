import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DeflectionType, KbArticleStatus, Role, TicketStatus } from '@prisma/client';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { KbService } from './kb.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';

const mockPrisma = {
  kbArticle: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  ticket: { findUnique: jest.fn() },
  kbDeflection: { create: jest.fn() },
};

const mockEs = {
  indices: { exists: jest.fn(), create: jest.fn() },
  index: jest.fn(),
  delete: jest.fn(),
  search: jest.fn(),
};

const mockTicketsService = { update: jest.fn() };

type RequestUser = { id: string; role: Role };

describe('KbService', () => {
  let service: KbService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KbService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ElasticsearchService, useValue: mockEs },
        { provide: TicketsService, useValue: mockTicketsService },
      ],
    }).compile();
    service = module.get<KbService>(KbService);
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('creates the kb_articles index when it does not exist', async () => {
      mockEs.indices.exists.mockResolvedValue(false);
      mockEs.indices.create.mockResolvedValue({});
      await service.onModuleInit();
      expect(mockEs.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'kb_articles' }),
      );
    });

    it('skips index creation when index already exists', async () => {
      mockEs.indices.exists.mockResolvedValue(true);
      await service.onModuleInit();
      expect(mockEs.indices.create).not.toHaveBeenCalled();
    });
  });

  const admin: RequestUser = { id: 'user-1', role: Role.ADMIN };

  describe('create', () => {
    it('indexes to Elasticsearch when status is PUBLISHED', async () => {
      const article = {
        id: 'art-1', title: 'T', body: 'B', tags: [], slug: 't-abc123',
        status: KbArticleStatus.PUBLISHED, publishedAt: new Date(),
      };
      mockPrisma.kbArticle.create.mockResolvedValue(article);
      mockEs.index.mockResolvedValue({});

      await service.create({ title: 'T', body: 'B', status: KbArticleStatus.PUBLISHED }, admin);

      expect(mockEs.index).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'kb_articles', id: 'art-1' }),
      );
    });

    it('skips ES sync when status is DRAFT', async () => {
      const article = {
        id: 'art-1', title: 'T', body: 'B', tags: [], slug: 't-abc123',
        status: KbArticleStatus.DRAFT, publishedAt: null,
      };
      mockPrisma.kbArticle.create.mockResolvedValue(article);

      await service.create({ title: 'T', body: 'B', status: KbArticleStatus.DRAFT }, admin);

      expect(mockEs.index).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('re-indexes and sets publishedAt when transitioning DRAFT → PUBLISHED', async () => {
      const existing = { id: 'art-1', status: KbArticleStatus.DRAFT, publishedAt: null };
      const updated = {
        id: 'art-1', title: 'T', body: 'B', tags: [], slug: 't-abc',
        status: KbArticleStatus.PUBLISHED, publishedAt: new Date(),
      };
      mockPrisma.kbArticle.findUnique.mockResolvedValue(existing);
      mockPrisma.kbArticle.update.mockResolvedValue(updated);
      mockEs.index.mockResolvedValue({});

      await service.update('art-1', { status: KbArticleStatus.PUBLISHED });

      expect(mockEs.index).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'kb_articles', id: 'art-1' }),
      );
      expect(mockPrisma.kbArticle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ publishedAt: expect.any(Date) }),
        }),
      );
    });

    it('removes from ES index when changing PUBLISHED → DRAFT', async () => {
      const existing = { id: 'art-1', status: KbArticleStatus.PUBLISHED, publishedAt: new Date() };
      const updated = {
        id: 'art-1', title: 'T', body: 'B', tags: [], slug: 't-abc',
        status: KbArticleStatus.DRAFT, publishedAt: new Date(),
      };
      mockPrisma.kbArticle.findUnique.mockResolvedValue(existing);
      mockPrisma.kbArticle.update.mockResolvedValue(updated);
      mockEs.delete.mockResolvedValue({});

      await service.update('art-1', { status: KbArticleStatus.DRAFT });

      expect(mockEs.delete).toHaveBeenCalledWith({ index: 'kb_articles', id: 'art-1' });
      expect(mockEs.index).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.kbArticle.findUnique.mockResolvedValue(null);
      await expect(service.update('bad', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes from both Postgres and Elasticsearch', async () => {
      mockPrisma.kbArticle.delete.mockResolvedValue({});
      mockEs.delete.mockResolvedValue({});

      await service.remove('art-1');

      expect(mockPrisma.kbArticle.delete).toHaveBeenCalledWith({ where: { id: 'art-1' } });
      expect(mockEs.delete).toHaveBeenCalledWith({ index: 'kb_articles', id: 'art-1' });
    });
  });
});
