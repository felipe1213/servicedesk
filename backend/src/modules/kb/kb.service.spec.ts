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
});
