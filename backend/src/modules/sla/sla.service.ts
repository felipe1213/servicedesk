// backend/src/modules/sla/sla.service.ts
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BreachAction, Priority, TicketStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';

type TicketForSla = {
  id: string;
  priority: Priority;
  createdAt: Date;
};

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  findAll() {
    return this.prisma.slaPolicy.findMany({ orderBy: { priorityLevel: 'asc' } });
  }

  async create(dto: CreateSlaPolicyDto) {
    const existing = await this.prisma.slaPolicy.findUnique({
      where: { priorityLevel: dto.priorityLevel },
    });
    if (existing) throw new ConflictException(`SLA policy for ${dto.priorityLevel} already exists`);
    return this.prisma.slaPolicy.create({ data: dto });
  }

  async update(id: string, dto: UpdateSlaPolicyDto) {
    const existing = await this.prisma.slaPolicy.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('SLA policy not found');
    return this.prisma.slaPolicy.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const existing = await this.prisma.slaPolicy.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('SLA policy not found');
    return this.prisma.slaPolicy.delete({ where: { id } });
  }

  async stampDeadlines(ticket: TicketForSla) {
    const policy = await this.prisma.slaPolicy.findUnique({
      where: { priorityLevel: ticket.priority },
    });
    if (!policy) {
      this.logger.warn(`No SLA policy for priority ${ticket.priority}, skipping deadline stamp for ticket ${ticket.id}`);
      return;
    }

    const responseDeadline = new Date(
      ticket.createdAt.getTime() + policy.responseTimeMinutes * 60 * 1000,
    );
    const resolutionDeadline = new Date(
      ticket.createdAt.getTime() + policy.resolutionTimeMinutes * 60 * 1000,
    );

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { responseDeadline, resolutionDeadline, slaPolicyId: policy.id },
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkBreaches() {
    const now = new Date();
    const tickets = await this.prisma.ticket.findMany({
      where: {
        slaBreached: false,
        slaPolicyId: { not: null },
        status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        OR: [
          { responseDeadline: { lt: now } },
          { resolutionDeadline: { lt: now } },
        ],
      },
      include: { slaPolicy: true },
    });

    for (const ticket of tickets) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.ticket.update({
            where: { id: ticket.id },
            data: { slaBreached: true },
          });

          await tx.auditLog.create({
            data: {
              ticketId: ticket.id,
              actorId: ticket.createdById,
              action: 'SLA_BREACHED',
              newValue: ticket.slaPolicy?.priorityLevel,
            },
          });

          const policy = ticket.slaPolicy;
          if (policy && (policy.breachAction === BreachAction.ESCALATE || policy.breachAction === BreachAction.BOTH)) {
            const updateData: { assignedToId?: string; teamId?: string } = {};
            if (policy.escalateToUserId) updateData.assignedToId = policy.escalateToUserId;
            if (policy.escalateToTeamId) updateData.teamId = policy.escalateToTeamId;
            if (Object.keys(updateData).length > 0) {
              await tx.ticket.update({ where: { id: ticket.id }, data: updateData });
            }
          }
        });

        this.eventEmitter.emit('sla.breached', {
          ticketId: ticket.id,
          assignedToId: ticket.assignedToId,
          title: ticket.title,
        });
      } catch (err) {
        this.logger.error(`Failed to process breach for ticket ${ticket.id}`, err);
      }
    }
  }
}
