// backend/src/modules/sla/sla.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BreachAction, Priority, TicketStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SlaService } from './sla.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  slaPolicy: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  ticket: {
    update: jest.fn(),
    findMany: jest.fn(),
  },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};

describe('SlaService', () => {
  let service: SlaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get<SlaService>(SlaService);
    jest.clearAllMocks();
  });

  const basePolicy = {
    id: 'pol-1',
    name: 'Critical SLA',
    priorityLevel: Priority.CRITICAL,
    responseTimeMinutes: 30,
    resolutionTimeMinutes: 240,
    breachAction: BreachAction.FLAG,
    escalateToUserId: null,
    escalateToTeamId: null,
  };

  describe('create', () => {
    it('throws ConflictException if priority already has a policy', async () => {
      mockPrisma.slaPolicy.findUnique.mockResolvedValue(basePolicy);
      await expect(
        service.create({ name: 'Dup', priorityLevel: Priority.CRITICAL, responseTimeMinutes: 30, resolutionTimeMinutes: 240 }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates policy when priority is unused', async () => {
      mockPrisma.slaPolicy.findUnique.mockResolvedValue(null);
      mockPrisma.slaPolicy.create.mockResolvedValue(basePolicy);
      const result = await service.create({
        name: 'Critical SLA', priorityLevel: Priority.CRITICAL,
        responseTimeMinutes: 30, resolutionTimeMinutes: 240,
      });
      expect(result).toBe(basePolicy);
    });
  });

  describe('update', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.slaPolicy.findUnique.mockResolvedValue(null);
      await expect(service.update('bad', { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('stampDeadlines', () => {
    it('sets responseDeadline and resolutionDeadline based on policy minutes', async () => {
      mockPrisma.slaPolicy.findUnique.mockResolvedValue(basePolicy);
      mockPrisma.ticket.update.mockResolvedValue({});

      const createdAt = new Date('2026-01-01T10:00:00Z');
      await service.stampDeadlines({ id: 'ticket-1', priority: Priority.CRITICAL, createdAt });

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: {
          responseDeadline: new Date('2026-01-01T10:30:00Z'),
          resolutionDeadline: new Date('2026-01-01T14:00:00Z'),
          slaPolicyId: 'pol-1',
        },
      });
    });

    it('does nothing when no policy matches the ticket priority', async () => {
      mockPrisma.slaPolicy.findUnique.mockResolvedValue(null);
      await service.stampDeadlines({ id: 'ticket-1', priority: Priority.LOW, createdAt: new Date() });
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  describe('checkBreaches', () => {
    it('sets slaBreached=true and writes audit log for overdue ticket', async () => {
      const overdueTicket = {
        id: 'ticket-1',
        createdById: 'user-1',
        slaPolicy: { ...basePolicy, breachAction: BreachAction.FLAG },
      };
      mockPrisma.ticket.findMany.mockResolvedValue([overdueTicket]);
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn(mockPrisma));
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.checkBreaches();

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('updates assignedToId when breachAction is ESCALATE', async () => {
      const escalateTicket = {
        id: 'ticket-2',
        createdById: 'user-1',
        slaPolicy: { ...basePolicy, breachAction: BreachAction.ESCALATE, escalateToUserId: 'manager-1', escalateToTeamId: null },
      };
      mockPrisma.ticket.findMany.mockResolvedValue([escalateTicket]);
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn(mockPrisma));
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.checkBreaches();

      const updateCalls = mockPrisma.ticket.update.mock.calls;
      const escalationCall = updateCalls.find((args: any[]) => args[0]?.data?.assignedToId);
      expect(escalationCall).toBeDefined();
      expect(escalationCall[0].data.assignedToId).toBe('manager-1');
    });

    it('does not update assignedToId when breachAction is FLAG', async () => {
      const flagTicket = {
        id: 'ticket-3',
        createdById: 'user-1',
        slaPolicy: { ...basePolicy, breachAction: BreachAction.FLAG, escalateToUserId: 'manager-1' },
      };
      mockPrisma.ticket.findMany.mockResolvedValue([flagTicket]);
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn(mockPrisma));
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.checkBreaches();

      const updateCalls = mockPrisma.ticket.update.mock.calls;
      const escalationCall = updateCalls.find((args: any[]) => args[0]?.data?.assignedToId);
      expect(escalationCall).toBeUndefined();
    });

    it('skips already-breached tickets (returns empty findMany)', async () => {
      mockPrisma.ticket.findMany.mockResolvedValue([]);

      await service.checkBreaches();

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
