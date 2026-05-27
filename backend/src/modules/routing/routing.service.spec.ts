// backend/src/modules/routing/routing.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Channel, Priority, TicketStatus } from '@prisma/client';
import { RoutingService } from './routing.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  routingRule: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  ticket: { update: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};

describe('RoutingService', () => {
  let service: RoutingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<RoutingService>(RoutingService);
    jest.clearAllMocks();
  });

  const baseTicket = {
    id: 'ticket-1',
    title: 'Login broken',
    description: 'Cannot log in',
    category: 'Auth',
    sourceChannel: Channel.WEB,
    priority: Priority.HIGH,
    status: TicketStatus.NEW,
    createdById: 'user-1',
  };

  describe('applyRules', () => {
    it('assigns ticket to agent when first rule matches', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          priorityOrder: 1,
          isActive: true,
          conditions: [{ field: 'category', operator: 'eq', value: 'Auth' }],
          assignToAgentId: 'agent-1',
          assignToTeamId: null,
        },
      ]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.applyRules(baseTicket);

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ticket-1' },
          data: expect.objectContaining({ assignedToId: 'agent-1', status: TicketStatus.ASSIGNED }),
        }),
      );
    });

    it('stops at first matching rule and skips subsequent rules', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1', priorityOrder: 1, isActive: true,
          conditions: [{ field: 'category', operator: 'eq', value: 'Auth' }],
          assignToAgentId: 'agent-1', assignToTeamId: null,
        },
        {
          id: 'rule-2', priorityOrder: 2, isActive: true,
          conditions: [{ field: 'channel', operator: 'eq', value: 'WEB' }],
          assignToAgentId: 'agent-2', assignToTeamId: null,
        },
      ]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.applyRules(baseTicket);

      const updateCalls = mockPrisma.ticket.update.mock.calls;
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0][0].data.assignedToId).toBe('agent-1');
    });

    it('leaves ticket unassigned when no rule matches', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1', priorityOrder: 1, isActive: true,
          conditions: [{ field: 'category', operator: 'eq', value: 'Networking' }],
          assignToAgentId: 'agent-1', assignToTeamId: null,
        },
      ]);

      await service.applyRules(baseTicket);

      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });

    it('skips inactive rules', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([]);

      await service.applyRules(baseTicket);

      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });

    it('matches keyword in ticket title with contains operator', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1', priorityOrder: 1, isActive: true,
          conditions: [{ field: 'keyword', operator: 'contains', value: 'login' }],
          assignToAgentId: 'agent-1', assignToTeamId: null,
        },
      ]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.applyRules({ ...baseTicket, title: 'Login broken', description: 'nothing' });

      expect(mockPrisma.ticket.update).toHaveBeenCalled();
    });

    it('matches keyword in ticket description with contains operator', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1', priorityOrder: 1, isActive: true,
          conditions: [{ field: 'keyword', operator: 'contains', value: 'vpn' }],
          assignToAgentId: 'agent-1', assignToTeamId: null,
        },
      ]);
      mockPrisma.ticket.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.applyRules({ ...baseTicket, title: 'Network issue', description: 'VPN connection fails' });

      expect(mockPrisma.ticket.update).toHaveBeenCalled();
    });

    it('requires ALL conditions to match (AND logic)', async () => {
      mockPrisma.routingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1', priorityOrder: 1, isActive: true,
          conditions: [
            { field: 'category', operator: 'eq', value: 'Auth' },
            { field: 'channel', operator: 'eq', value: 'EMAIL' },
          ],
          assignToAgentId: 'agent-1', assignToTeamId: null,
        },
      ]);

      // category matches but channel does not
      await service.applyRules({ ...baseTicket, sourceChannel: Channel.WEB });

      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.routingRule.findUnique.mockResolvedValue(null);
      await expect(service.update('bad', { isActive: false })).rejects.toThrow(NotFoundException);
    });
  });
});
