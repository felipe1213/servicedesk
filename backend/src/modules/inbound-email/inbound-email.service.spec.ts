import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InboundEmailService } from './inbound-email.service';
import { InboundEmailConfigService } from './inbound-email-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuthProvider, Role } from '@prisma/client';

jest.mock('imapflow');

describe('InboundEmailService', () => {
  let service: InboundEmailService;
  let configService: jest.Mocked<InboundEmailConfigService>;
  let prisma: any;
  let ticketsService: jest.Mocked<TicketsService>;
  let attachmentsService: jest.Mocked<AttachmentsService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  beforeEach(async () => {
    configService = {
      getConfig: jest.fn(),
      getAccessControl: jest.fn(),
    } as any;

    prisma = {
      ticket: { findUnique: jest.fn() },
      comment: { create: jest.fn().mockResolvedValue({ id: 'comment-1' }) },
      user: { findUnique: jest.fn(), create: jest.fn() },
    };

    ticketsService = { create: jest.fn().mockResolvedValue({ id: 'ticket-new', ticketNumber: 1 }) } as any;
    attachmentsService = { uploadBuffer: jest.fn().mockResolvedValue(undefined) } as any;
    eventEmitter = { emit: jest.fn() } as any;

    const module = await Test.createTestingModule({
      providers: [
        InboundEmailService,
        { provide: InboundEmailConfigService, useValue: configService },
        { provide: PrismaService, useValue: prisma },
        { provide: TicketsService, useValue: ticketsService },
        { provide: AttachmentsService, useValue: attachmentsService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(InboundEmailService);
  });

  const baseMsg = {
    externalId: 'msg-1',
    from: 'alice@contoso.com',
    fromName: 'Alice',
    subject: 'Need help',
    body: 'My printer is broken.',
    attachments: [],
  };

  it('creates a ticket when mode is ANYONE and sender is unknown', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'ANYONE', list: [] });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-user' });

    await service.processMessage(baseMsg);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'alice@contoso.com', role: Role.END_USER, authProvider: AuthProvider.LOCAL }),
    });
    expect(ticketsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Need help', sourceChannel: 'EMAIL' }),
      'new-user',
    );
  });

  it('creates a ticket when sender domain is in DOMAINS allowlist', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'DOMAINS', list: ['contoso.com'] });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

    await service.processMessage(baseMsg);

    expect(ticketsService.create).toHaveBeenCalledTimes(1);
  });

  it('discards message when sender domain is NOT in DOMAINS allowlist', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'DOMAINS', list: ['fabrikam.com'] });

    await service.processMessage(baseMsg);

    expect(ticketsService.create).not.toHaveBeenCalled();
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('discards message when mode is USERS and sender not in list', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'USERS', list: ['bob@contoso.com'] });

    await service.processMessage(baseMsg);

    expect(ticketsService.create).not.toHaveBeenCalled();
  });

  it('creates a comment when subject contains [#N] matching an existing ticket', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'ANYONE', list: [] });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.ticket.findUnique.mockResolvedValue({
      id: 'ticket-1', ticketNumber: 42, title: 'Printer issue',
      createdById: 'user-1', assignedToId: null,
    });

    await service.processMessage({ ...baseMsg, subject: '[#42] Re: Printer issue' });

    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ticketId: 'ticket-1', authorId: 'user-1', isInternal: false }),
    });
    expect(ticketsService.create).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith('ticket.commented', expect.objectContaining({ ticketNumber: 42 }));
  });

  it('creates a new ticket when [#N] subject tag does not match any ticket', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'ANYONE', list: [] });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.ticket.findUnique.mockResolvedValue(null);

    await service.processMessage({ ...baseMsg, subject: '[#999] orphan reply' });

    expect(ticketsService.create).toHaveBeenCalledTimes(1);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('saves attachments to the created ticket', async () => {
    configService.getAccessControl.mockResolvedValue({ mode: 'ANYONE', list: [] });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    ticketsService.create.mockResolvedValue({ id: 'ticket-new', ticketNumber: 2 } as any);

    await service.processMessage({
      ...baseMsg,
      attachments: [{ filename: 'log.txt', contentType: 'text/plain', data: Buffer.from('err') }],
    });

    expect(attachmentsService.uploadBuffer).toHaveBeenCalledWith(
      'ticket-new', 'user-1', 'log.txt', 'text/plain', expect.any(Buffer),
    );
  });

  it('returns processed:0 when transport is NONE', async () => {
    configService.getConfig = jest.fn().mockResolvedValue({ transport: 'NONE', config: {} });

    const result = await service.pollOnce();

    expect(result).toEqual({ processed: 0 });
  });
});
