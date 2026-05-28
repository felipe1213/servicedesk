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

  describe('search', () => {
    it('calls ES multi-match query with title boost and returns mapped hits', async () => {
      mockEs.search.mockResolvedValue({
        hits: {
          hits: [
            { _id: 'art-1', _source: { title: 'Login Guide', slug: 'login-guide', tags: ['auth'], body: 'How to log in to the system' } },
          ],
        },
      });

      const result = await service.search('login issue');

      expect(mockEs.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'kb_articles',
          query: {
            multi_match: expect.objectContaining({
              query: 'login issue',
              fields: expect.arrayContaining(['title^3', 'body', 'tags']),
            }),
          },
        }),
      );
      expect(result[0]).toMatchObject({ id: 'art-1', title: 'Login Guide', slug: 'login-guide' });
      expect(typeof result[0].excerpt).toBe('string');
    });

    it('throws ServiceUnavailableException when Elasticsearch is unavailable', async () => {
      mockEs.search.mockRejectedValue(new Error('Connection refused'));
      await expect(service.search('login')).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('suggest', () => {
    it('fetches ticket and calls ES more_like_this, returns top 5', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
        id: 't-1', title: 'Login broken', description: 'Cannot log in',
      });
      mockEs.search.mockResolvedValue({
        hits: {
          hits: [
            { _id: 'art-1', _source: { title: 'Login Guide', slug: 'login-guide' } },
          ],
        },
      });

      const result = await service.suggest('t-1');

      expect(mockEs.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            more_like_this: expect.objectContaining({ fields: ['title', 'body'] }),
          },
          size: 5,
        }),
      );
      expect(result).toEqual([{ id: 'art-1', title: 'Login Guide', slug: 'login-guide' }]);
    });

    it('throws NotFoundException for unknown ticketId', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(null);
      await expect(service.suggest('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deflect', () => {
    const agent: RequestUser = { id: 'agent-1', role: Role.AGENT };
    const endUser: RequestUser = { id: 'user-1', role: Role.END_USER };

    it('AGENT type calls TicketsService.update() with RESOLVED status', async () => {
      mockPrisma.kbArticle.findUnique.mockResolvedValue({ id: 'art-1' });
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't-1', createdById: 'user-1' });
      mockPrisma.kbDeflection.create.mockResolvedValue({ id: 'def-1' });
      mockTicketsService.update.mockResolvedValue({});

      await service.deflect('art-1', 't-1', DeflectionType.AGENT, agent);

      expect(mockTicketsService.update).toHaveBeenCalledWith(
        't-1',
        { status: TicketStatus.RESOLVED },
        agent,
      );
    });

    it('END_USER type does not call TicketsService.update()', async () => {
      mockPrisma.kbArticle.findUnique.mockResolvedValue({ id: 'art-1' });
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't-1', createdById: 'user-1' });
      mockPrisma.kbDeflection.create.mockResolvedValue({ id: 'def-1' });

      await service.deflect('art-1', 't-1', DeflectionType.END_USER, endUser);

      expect(mockTicketsService.update).not.toHaveBeenCalled();
    });

    it('END_USER with mismatched ticket.createdById throws ForbiddenException', async () => {
      mockPrisma.kbArticle.findUnique.mockResolvedValue({ id: 'art-1' });
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't-1', createdById: 'other-user' });

      await expect(
        service.deflect('art-1', 't-1', DeflectionType.END_USER, endUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
