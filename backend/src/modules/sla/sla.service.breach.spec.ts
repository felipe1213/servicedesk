import { Test } from '@nestjs/testing';
import { SlaService } from './sla.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BreachAction, Priority, TicketStatus } from '@prisma/client';

describe('SlaService.checkBreaches — sla.breached event', () => {
  let service: SlaService;
  let emitter: jest.Mocked<EventEmitter2>;
  let prisma: any;

  const breachingTicket = {
    id: 'ticket-1', title: 'Urgent issue', createdById: 'user-1',
    assignedToId: 'agent-1', priority: Priority.HIGH,
    slaBreached: false, slaPolicyId: 'policy-1',
    slaPolicy: {
      id: 'policy-1', priorityLevel: Priority.HIGH,
      breachAction: BreachAction.FLAG,
      escalateToUserId: null, escalateToTeamId: null,
    },
    status: TicketStatus.IN_PROGRESS,
    createdAt: new Date(Date.now() - 9999999),
    responseDeadline: new Date(Date.now() - 1000),
    resolutionDeadline: new Date(Date.now() - 1000),
  };

  beforeEach(async () => {
    emitter = { emit: jest.fn() } as any;
    prisma = {
      ticket: {
        findMany: jest.fn().mockResolvedValue([breachingTicket]),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(prisma)),
    };

    const module = await Test.createTestingModule({
      providers: [
        SlaService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get(SlaService);
  });

  it('emits sla.breached after the transaction succeeds', async () => {
    await service.checkBreaches();
    expect(emitter.emit).toHaveBeenCalledWith('sla.breached', {
      ticketId: 'ticket-1',
      assignedToId: 'agent-1',
      title: 'Urgent issue',
    });
  });

  it('does not emit sla.breached when the transaction fails', async () => {
    prisma.$transaction.mockRejectedValue(new Error('DB error'));
    await service.checkBreaches();
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
