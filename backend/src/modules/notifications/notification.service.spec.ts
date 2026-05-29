// backend/src/modules/notifications/notification.service.spec.ts
import { Test } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { EmailService } from './email.service';
import { NotificationConfigService } from './notification-config.service';
import { NotificationService } from './notification.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('nodemailer');

describe('NotificationService', () => {
  let service: NotificationService;
  let emailService: jest.Mocked<EmailService>;
  let configService: jest.Mocked<NotificationConfigService>;
  let prisma: any;

  beforeEach(async () => {
    emailService = { send: jest.fn().mockResolvedValue(undefined) } as any;
    configService = { isEventEnabled: jest.fn() } as any;
    prisma = {
      notification: { create: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn(), findMany: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get(NotificationService);
  });

  it('handleTicketAssigned: creates in-app notification and sends email when toggle is enabled', async () => {
    configService.isEventEnabled.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({ id: 'agent-1', email: 'agent@test.com' });

    await service.handleTicketAssigned({ ticketId: 'ticket-1', assignedToId: 'agent-1', title: 'Fix it' });

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'agent-1', ticketId: 'ticket-1' }),
      }),
    );
    expect(emailService.send).toHaveBeenCalledWith(
      'agent@test.com', expect.any(String), expect.any(String),
    );
  });

  it('handleTicketAssigned: does nothing when toggle is disabled', async () => {
    configService.isEventEnabled.mockResolvedValue(false);

    await service.handleTicketAssigned({ ticketId: 'ticket-1', assignedToId: 'agent-1', title: 'Fix it' });

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('handleTicketCommented: notifies creator and assignee, deduplicates when same user', async () => {
    configService.isEventEnabled.mockResolvedValue(true);
    // creator === assignee → Set deduplicates → findMany returns one user
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'user@test.com' }]);

    await service.handleTicketCommented({
      ticketId: 't1', commentId: 'c1', authorId: 'agent-1',
      title: 'Issue', creatorId: 'user-1', assignedToId: 'user-1',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['user-1'] } },
      }),
    );
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('handleSlaBreached: notifies assignee and all MANAGER-role users', async () => {
    configService.isEventEnabled.mockResolvedValue(true);
    prisma.user.findMany.mockResolvedValue([
      { id: 'mgr-1', email: 'mgr1@test.com' },
      { id: 'mgr-2', email: 'mgr2@test.com' },
    ]);
    prisma.user.findUnique.mockResolvedValue({ id: 'agent-1', email: 'agent@test.com' });

    await service.handleSlaBreached({ ticketId: 't1', assignedToId: 'agent-1', title: 'SLA' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: Role.MANAGER },
      }),
    );
    // 2 managers + 1 assignee = 3 unique recipients
    expect(prisma.notification.create).toHaveBeenCalledTimes(3);
    expect(emailService.send).toHaveBeenCalledTimes(3);
  });
});

describe('EmailService', () => {
  let service: EmailService;
  let configService: jest.Mocked<NotificationConfigService>;

  afterEach(() => {
    jest.clearAllMocks();
  });

  beforeEach(async () => {
    configService = { getEmailConfig: jest.fn() } as any;
    const module = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: NotificationConfigService, useValue: configService },
      ],
    }).compile();
    service = module.get(EmailService);
  });

  it('calls Nodemailer sendMail when transport is SMTP', async () => {
    const mockSendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: mockSendMail });
    configService.getEmailConfig.mockResolvedValue({
      transport: 'SMTP',
      config: { host: 'smtp.test.com', port: 587, secure: false, user: 'u', pass: 'p', fromAddress: 'from@test.com' },
    });

    await service.send('to@test.com', 'Hello', 'World');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'to@test.com', subject: 'Hello' }),
    );
  });

  it('is a no-op and does not call Nodemailer when transport is NONE', async () => {
    const mockSendMail = jest.fn();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: mockSendMail });
    configService.getEmailConfig.mockResolvedValue({ transport: 'NONE', config: {} });

    await service.send('to@test.com', 'Hello', 'World');

    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('NotificationConfigService', () => {
  let service: NotificationConfigService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      appConfig: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        NotificationConfigService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('a'.repeat(64)) },
        },
      ],
    }).compile();

    service = module.get(NotificationConfigService);
  });

  it('encrypts SMTP credentials on save and decrypts them on load', async () => {
    let storedSmtp = '';
    prisma.appConfig.upsert.mockImplementation((args: any) => {
      if (args.where.key === 'notification.email.smtp') storedSmtp = args.create.value;
      return {};
    });

    await service.saveEmailConfig({
      transport: 'SMTP',
      host: 'smtp.test.com', port: 587, secure: false,
      user: 'testuser', pass: 'supersecret', fromAddress: 'from@test.com',
    });

    expect(storedSmtp).toBeTruthy();
    const parsed = JSON.parse(storedSmtp);
    expect(parsed.pass).not.toBe('supersecret'); // must be encrypted

    prisma.appConfig.findUnique.mockImplementation((args: any) => {
      if (args.where.key === 'notification.email.transport') return { value: 'SMTP' };
      if (args.where.key === 'notification.email.smtp') return { value: storedSmtp };
      return null;
    });

    const loaded = await service.getEmailConfig();
    expect(loaded.config.pass).toBe('supersecret'); // decrypted correctly
  });
});
