import { Test } from '@nestjs/testing';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaService } from '../sla/sla.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role, TicketStatus } from '@prisma/client';

describe('TicketsService events', () => {
  let service: TicketsService;
  let emitter: jest.Mocked<EventEmitter2>;
  let prisma: any;

  const mockUser = { id: 'user-1', role: Role.AGENT };
  const baseTicket = {
    id: 'ticket-1', title: 'Test ticket', description: 'Desc',
    status: TicketStatus.NEW, priority: 'MEDIUM' as any,
    createdById: 'creator-1', assignedToId: null,
    createdAt: new Date(), updatedAt: new Date(),
    slaBreached: false, slaPolicyId: null,
    sourceChannel: 'WEB' as any, category: null, teamId: null,
    responseDeadline: null, resolutionDeadline: null,
  };

  beforeEach(async () => {
    emitter = { emit: jest.fn() } as any;
    prisma = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue(baseTicket),
        update: jest.fn().mockResolvedValue({ ...baseTicket, assignedToId: 'agent-1', assignedTo: { name: 'Agent' } }),
      },
      auditLog: { create: jest.fn() },
      comment: {
        create: jest.fn().mockResolvedValue({
          id: 'comment-1', body: 'hello', authorId: 'user-1',
          ticketId: 'ticket-1', isInternal: false, createdAt: new Date(),
          author: { id: 'user-1', name: 'Agent', email: 'agent@test.com' },
        }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SlaService, useValue: { stampDeadlines: jest.fn() } },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get(TicketsService);
  });

  it('emits ticket.assigned when assignedToId changes', async () => {
    await service.update('ticket-1', { assignedToId: 'agent-1' }, mockUser);
    expect(emitter.emit).toHaveBeenCalledWith('ticket.assigned', {
      ticketId: 'ticket-1', assignedToId: 'agent-1', title: 'Test ticket',
    });
  });

  it('emits ticket.status_changed for non-RESOLVED status', async () => {
    prisma.ticket.update.mockResolvedValue({
      ...baseTicket, status: TicketStatus.IN_PROGRESS, assignedToId: null, assignedTo: null,
    });
    await service.update('ticket-1', { status: TicketStatus.IN_PROGRESS }, mockUser);
    expect(emitter.emit).toHaveBeenCalledWith('ticket.status_changed', {
      ticketId: 'ticket-1', status: TicketStatus.IN_PROGRESS, title: 'Test ticket',
      creatorId: 'creator-1', assignedToId: null,
    });
  });

  it('emits ticket.resolved when status changes to RESOLVED', async () => {
    prisma.ticket.update.mockResolvedValue({
      ...baseTicket, status: TicketStatus.RESOLVED, assignedToId: null, assignedTo: null,
    });
    await service.update('ticket-1', { status: TicketStatus.RESOLVED }, mockUser);
    expect(emitter.emit).toHaveBeenCalledWith('ticket.resolved', {
      ticketId: 'ticket-1', title: 'Test ticket', creatorId: 'creator-1',
    });
  });

  it('emits ticket.commented when a comment is created', async () => {
    await service.addComment('ticket-1', { body: 'hello', isInternal: false }, mockUser);
    expect(emitter.emit).toHaveBeenCalledWith('ticket.commented', {
      ticketId: 'ticket-1', commentId: 'comment-1', authorId: 'user-1',
      title: 'Test ticket', creatorId: 'creator-1', assignedToId: null,
    });
  });

  it('emits both ticket.status_changed(ASSIGNED) and ticket.assigned when assigning a NEW ticket', async () => {
    await service.update('ticket-1', { assignedToId: 'agent-1' }, mockUser);
    expect(emitter.emit).toHaveBeenCalledWith('ticket.status_changed', {
      ticketId: 'ticket-1', status: TicketStatus.ASSIGNED, title: 'Test ticket',
      creatorId: 'creator-1', assignedToId: 'agent-1',
    });
    expect(emitter.emit).toHaveBeenCalledWith('ticket.assigned', {
      ticketId: 'ticket-1', assignedToId: 'agent-1', title: 'Test ticket',
    });
  });

  it('does not emit ticket.commented for internal comments', async () => {
    await service.addComment('ticket-1', { body: 'internal note', isInternal: true }, { id: 'user-1', role: Role.AGENT });
    expect(emitter.emit).not.toHaveBeenCalledWith('ticket.commented', expect.anything());
  });
});
