// backend/src/modules/notifications/notification.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';
import { NotificationConfigService } from './notification-config.service';

type TicketCreatedPayload = {
  id: string;
  title: string;
  createdById: string;
  createdBy: { id: string; name: string; email: string };
  ticketNumber: number;
};
type TicketAssignedPayload = { ticketId: string; assignedToId: string; title: string; ticketNumber: number };
type TicketCommentedPayload = {
  ticketId: string; commentId: string; authorId: string;
  title: string; creatorId: string; assignedToId: string | null;
  ticketNumber: number;
};
type TicketStatusChangedPayload = {
  ticketId: string; status: string; title: string;
  creatorId: string; assignedToId: string | null;
  ticketNumber: number;
};
type TicketResolvedPayload = { ticketId: string; title: string; creatorId: string; ticketNumber: number };
type SlaBreachedPayload = { ticketId: string; assignedToId: string | null; title: string; ticketNumber: number };

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: NotificationConfigService,
    private readonly emailService: EmailService,
  ) {}

  private async notify(
    userId: string,
    email: string | null,
    title: string,
    body: string,
    ticketId?: string,
  ) {
    await this.prisma.notification.create({ data: { userId, title, body, ticketId } });
    if (email) {
      await this.emailService.send(email, title, body).catch((err) =>
        this.logger.error(`Email to ${email} failed`, err),
      );
    }
  }

  @OnEvent('ticket.created')
  async handleTicketCreated(event: TicketCreatedPayload): Promise<void> {
    try {
      if (!(await this.configService.isEventEnabled('notification.event.ticket_created'))) return;

      const title = `[#${event.ticketNumber}] Ticket created: ${event.title}`;
      const body = `Your ticket '${event.title}' has been received and will be reviewed shortly.`;
      await this.notify(event.createdById, event.createdBy?.email ?? null, title, body, event.id);
    } catch (err) {
      this.logger.error('handleTicketCreated failed', err);
    }
  }

  @OnEvent('ticket.assigned')
  async handleTicketAssigned(event: TicketAssignedPayload): Promise<void> {
    try {
      if (!(await this.configService.isEventEnabled('notification.event.ticket_assigned'))) return;

      const user = await this.prisma.user.findUnique({
        where: { id: event.assignedToId },
        select: { id: true, email: true },
      });
      if (!user) return;

      const title = `[#${event.ticketNumber}] Ticket assigned to you: ${event.title}`;
      const body = `You have been assigned ticket '${event.title}'.`;
      await this.notify(user.id, user.email, title, body, event.ticketId);
    } catch (err) {
      this.logger.error('handleTicketAssigned failed', err);
    }
  }

  @OnEvent('ticket.commented')
  async handleTicketCommented(event: TicketCommentedPayload): Promise<void> {
    try {
      if (!(await this.configService.isEventEnabled('notification.event.ticket_commented'))) return;

      const ids = [...new Set([event.creatorId, event.assignedToId].filter(Boolean) as string[])];
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true },
      });

      const title = `[#${event.ticketNumber}] New comment on: ${event.title}`;
      const body = `A new comment was posted on ticket '${event.title}'.`;
      await Promise.allSettled(users.map((u) => this.notify(u.id, u.email, title, body, event.ticketId)));
    } catch (err) {
      this.logger.error('handleTicketCommented failed', err);
    }
  }

  @OnEvent('ticket.status_changed')
  async handleStatusChanged(event: TicketStatusChangedPayload): Promise<void> {
    try {
      if (!(await this.configService.isEventEnabled('notification.event.ticket_status_changed'))) return;

      const user = await this.prisma.user.findUnique({
        where: { id: event.creatorId },
        select: { id: true, email: true },
      });
      if (!user) return;

      const title = `[#${event.ticketNumber}] Ticket status updated: ${event.title}`;
      const body = `Ticket '${event.title}' status changed to ${event.status.replace(/_/g, ' ')}.`;
      await this.notify(user.id, user.email, title, body, event.ticketId);
    } catch (err) {
      this.logger.error('handleStatusChanged failed', err);
    }
  }

  @OnEvent('ticket.resolved')
  async handleTicketResolved(event: TicketResolvedPayload): Promise<void> {
    try {
      if (!(await this.configService.isEventEnabled('notification.event.ticket_status_changed'))) return;

      const user = await this.prisma.user.findUnique({
        where: { id: event.creatorId },
        select: { id: true, email: true },
      });
      if (!user) return;

      const title = `[#${event.ticketNumber}] Ticket resolved: ${event.title}`;
      const body = `Your ticket '${event.title}' has been resolved.`;
      await this.notify(user.id, user.email, title, body, event.ticketId);
    } catch (err) {
      this.logger.error('handleTicketResolved failed', err);
    }
  }

  @OnEvent('sla.breached')
  async handleSlaBreached(event: SlaBreachedPayload): Promise<void> {
    try {
      if (!(await this.configService.isEventEnabled('notification.event.sla_breach'))) return;

      const managers = await this.prisma.user.findMany({
        where: { role: Role.MANAGER },
        select: { id: true, email: true },
      });

      const recipientMap = new Map<string, string | null>(
        managers.map((m) => [m.id, m.email]),
      );

      if (event.assignedToId) {
        const assignee = await this.prisma.user.findUnique({
          where: { id: event.assignedToId },
          select: { id: true, email: true },
        });
        if (assignee) recipientMap.set(assignee.id, assignee.email);
      }

      const title = `[#${event.ticketNumber}] SLA breached: ${event.title}`;
      const body = `Ticket '${event.title}' has breached its SLA deadline.`;
      await Promise.allSettled(
        [...recipientMap.entries()].map(([userId, email]) =>
          this.notify(userId, email, title, body, event.ticketId),
        ),
      );
    } catch (err) {
      this.logger.error('handleSlaBreached failed', err);
    }
  }
}
