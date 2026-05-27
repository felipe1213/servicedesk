import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, TicketStatus, Channel } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaService } from '../sla/sla.service';

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

const mockSlaService = { stampDeadlines: jest.fn() };
const mockEventEmitter = { emit: jest.fn() };

describe('TicketsService', () => {
  let service: TicketsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SlaService, useValue: mockSlaService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();
    service = module.get<TicketsService>(TicketsService);
    jest.clearAllMocks();
    mockSlaService.stampDeadlines.mockResolvedValue(undefined);
    mockEventEmitter.emit.mockReturnValue(true);
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
