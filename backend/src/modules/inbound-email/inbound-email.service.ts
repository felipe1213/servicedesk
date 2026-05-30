import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthProvider, Channel, Priority, Role } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { InboundEmailConfigService } from './inbound-email-config.service';

interface InboundMessage {
  externalId: string;
  from: string;
  fromName: string;
  subject: string;
  body: string;
  attachments: Array<{ filename: string; contentType: string; data: Buffer }>;
}

@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsService: TicketsService,
    private readonly attachmentsService: AttachmentsService,
    private readonly configService: InboundEmailConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron('* * * * *')
  async scheduledPoll(): Promise<void> {
    try {
      await this.pollOnce();
    } catch (err) {
      this.logger.error('Scheduled email poll failed', err);
    }
  }

  async pollOnce(): Promise<{ processed: number }> {
    const { transport } = await this.configService.getConfig();
    if (transport === 'IMAP') return { processed: await this.pollImap() };
    if (transport === 'GRAPH') return { processed: await this.pollGraph() };
    return { processed: 0 };
  }

  private async pollImap(): Promise<number> {
    const { config } = await this.configService.getConfig();
    const cfg = config as { host: string; port: number; secure: boolean; user: string; pass: string; mailbox: string };

    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      logger: false,
    });

    let processed = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock(cfg.mailbox || 'INBOX');
      try {
        const uids = await client.search({ seen: false }, { uid: true });
        if (!uids || uids.length === 0) return 0;

        for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
          try {
            const parsed = await simpleParser(msg.source as Buffer);
            const from = (parsed.from?.value?.[0]?.address ?? '') as string;
            const fromName = (parsed.from?.value?.[0]?.name ?? from) as string;
            const attachments = (parsed.attachments ?? [])
              .filter((a) => a.content)
              .map((a) => ({
                filename: a.filename ?? 'attachment',
                contentType: a.contentType ?? 'application/octet-stream',
                data: a.content,
              }));

            const uid = msg.uid ?? 0;
            await this.processMessage({
              externalId: String(uid),
              from,
              fromName,
              subject: parsed.subject ?? '(no subject)',
              body: parsed.text ?? (parsed.html || undefined) ?? '(no body)',
              attachments,
            });

            if (uid) {
              await client.messageFlagsAdd([uid], ['\\Seen'], { uid: true });
            }
            processed++;
          } catch (err) {
            this.logger.error(`Failed to process IMAP message uid=${msg.uid}`, err);
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return processed;
  }

  private async pollGraph(): Promise<number> {
    const { config } = await this.configService.getConfig();
    const cfg = config as { tenantId: string; clientId: string; clientSecret: string; mailboxAddress: string };

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
      },
    );
    if (!tokenRes.ok) {
      this.logger.error(`Graph token request failed (${tokenRes.status}): ${await tokenRes.text()}`);
      return 0;
    }
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) {
      this.logger.error('Graph token response missing access_token');
      return 0;
    }

    const listRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${cfg.mailboxAddress}/messages?$filter=isRead eq false&$top=50&$select=id,from,subject,body,hasAttachments`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    if (!listRes.ok) {
      this.logger.error(`Graph messages fetch failed (${listRes.status}): ${await listRes.text()}`);
      return 0;
    }
    const { value: messages } = (await listRes.json()) as { value: any[] };

    let processed = 0;
    for (const msg of messages) {
      try {
        let attachments: InboundMessage['attachments'] = [];
        if (msg.hasAttachments) {
          const attRes = await fetch(
            `https://graph.microsoft.com/v1.0/users/${cfg.mailboxAddress}/messages/${msg.id}/attachments`,
            { headers: { Authorization: `Bearer ${access_token}` } },
          );
          if (attRes.ok) {
            const { value } = (await attRes.json()) as { value: any[] };
            attachments = value
              .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes)
              .map((a) => ({
                filename: a.name ?? 'attachment',
                contentType: a.contentType ?? 'application/octet-stream',
                data: Buffer.from(a.contentBytes as string, 'base64'),
              }));
          }
        }

        await this.processMessage({
          externalId: msg.id as string,
          from: (msg.from?.emailAddress?.address ?? '') as string,
          fromName: (msg.from?.emailAddress?.name ?? msg.from?.emailAddress?.address ?? '') as string,
          subject: (msg.subject ?? '(no subject)') as string,
          body: (msg.body?.content ?? '(no body)') as string,
          attachments,
        });

        await fetch(
          `https://graph.microsoft.com/v1.0/users/${cfg.mailboxAddress}/messages/${msg.id}`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ isRead: true }),
          },
        );
        processed++;
      } catch (err) {
        this.logger.error(`Failed to process Graph message id=${msg.id}`, err);
      }
    }
    return processed;
  }

  async processMessage(msg: InboundMessage): Promise<void> {
    if (!msg.from) return;

    // 1. Access control
    const { mode, list } = await this.configService.getAccessControl();
    const domain = msg.from.split('@')[1]?.toLowerCase() ?? '';
    if (mode === 'DOMAINS' && !list.map((d) => d.toLowerCase()).includes(domain)) return;
    if (mode === 'USERS' && !list.map((e) => e.toLowerCase()).includes(msg.from.toLowerCase())) return;

    // 2. Reply threading — look for [#123] in subject
    const match = /\[#(\d+)\]/.exec(msg.subject);
    if (match) {
      const ticketNumber = parseInt(match[1], 10);
      const ticket = await this.prisma.ticket.findUnique({ where: { ticketNumber } });
      if (ticket) {
        const user = await this.findOrCreateUser(msg.from, msg.fromName, mode);
        if (!user) return;

        const comment = await this.prisma.comment.create({
          data: {
            ticketId: ticket.id,
            authorId: user.id,
            body: msg.body || '(no body)',
            isInternal: false,
          },
        });

        this.eventEmitter.emit('ticket.commented', {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          commentId: comment.id,
          authorId: user.id,
          title: ticket.title,
          creatorId: ticket.createdById,
          assignedToId: ticket.assignedToId,
        });

        for (const att of msg.attachments) {
          await this.attachmentsService
            .uploadBuffer(ticket.id, user.id, att.filename, att.contentType, att.data)
            .catch((err) => this.logger.warn(`Attachment upload failed: ${att.filename}`, err));
        }
        return;
      }
    }

    // 3. New ticket
    const user = await this.findOrCreateUser(msg.from, msg.fromName, mode);
    if (!user) return;

    const ticket = await this.ticketsService.create(
      {
        title: msg.subject || '(no subject)',
        description: msg.body || '(no body)',
        sourceChannel: Channel.EMAIL,
        priority: Priority.MEDIUM,
      },
      user.id,
    );

    for (const att of msg.attachments) {
      await this.attachmentsService
        .uploadBuffer(ticket.id, user.id, att.filename, att.contentType, att.data)
        .catch((err) => this.logger.warn(`Attachment upload failed: ${att.filename}`, err));
    }
  }

  private async findOrCreateUser(
    email: string,
    name: string,
    mode: string,
  ): Promise<{ id: string } | null> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing;

    if (mode === 'USERS') return null;

    try {
      return await this.prisma.user.create({
        data: {
          email,
          name: name || email,
          role: Role.END_USER,
          authProvider: AuthProvider.LOCAL,
        },
      });
    } catch {
      // Race condition — re-fetch
      return this.prisma.user.findUnique({ where: { email } });
    }
  }
}
