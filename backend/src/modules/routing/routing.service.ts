// backend/src/modules/routing/routing.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Channel, Prisma, Priority, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConditionDto, CreateRoutingRuleDto } from './dto/create-routing-rule.dto';
import { UpdateRoutingRuleDto } from './dto/update-routing-rule.dto';
import { ReorderRulesDto } from './dto/reorder-rules.dto';

type TicketForRouting = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  sourceChannel: Channel;
  priority: Priority;
  status: TicketStatus;
  createdById: string;
};

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.routingRule.findMany({
      include: {
        assignToAgent: { select: { id: true, name: true, email: true } },
        assignToTeam: { select: { id: true, name: true } },
      },
      orderBy: { priorityOrder: 'asc' },
    });
  }

  create(dto: CreateRoutingRuleDto) {
    const data: Prisma.RoutingRuleUncheckedCreateInput = {
      priorityOrder: dto.priorityOrder,
      conditions: dto.conditions as unknown as Prisma.InputJsonValue,
      ...(dto.assignToAgentId !== undefined && { assignToAgentId: dto.assignToAgentId }),
      ...(dto.assignToTeamId !== undefined && { assignToTeamId: dto.assignToTeamId }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    return this.prisma.routingRule.create({ data });
  }

  async update(id: string, dto: UpdateRoutingRuleDto) {
    const existing = await this.prisma.routingRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Routing rule not found');
    const data: Prisma.RoutingRuleUncheckedUpdateInput = {
      ...(dto.priorityOrder !== undefined && { priorityOrder: dto.priorityOrder }),
      ...(dto.conditions !== undefined && { conditions: dto.conditions as unknown as Prisma.InputJsonValue }),
      ...(dto.assignToAgentId !== undefined && { assignToAgentId: dto.assignToAgentId }),
      ...(dto.assignToTeamId !== undefined && { assignToTeamId: dto.assignToTeamId }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    return this.prisma.routingRule.update({ where: { id }, data });
  }

  async remove(id: string) {
    const existing = await this.prisma.routingRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Routing rule not found');
    return this.prisma.routingRule.delete({ where: { id } });
  }

  async reorder(dto: ReorderRulesDto) {
    await this.prisma.$transaction(
      dto.rules.map(({ id, priorityOrder }) =>
        this.prisma.routingRule.update({ where: { id }, data: { priorityOrder } }),
      ),
    );
  }

  private matchesCondition(condition: ConditionDto, ticket: TicketForRouting): boolean {
    if (condition.field === 'category') {
      return condition.operator === 'eq' && ticket.category === condition.value;
    }
    if (condition.field === 'channel') {
      return condition.operator === 'eq' && ticket.sourceChannel === condition.value;
    }
    if (condition.field === 'keyword') {
      const haystack = `${ticket.title} ${ticket.description}`.toLowerCase();
      return haystack.includes(condition.value.toLowerCase());
    }
    return false;
  }

  private ruleMatches(conditions: ConditionDto[], ticket: TicketForRouting): boolean {
    return conditions.every((c) => this.matchesCondition(c, ticket));
  }

  async applyRules(ticket: TicketForRouting) {
    const rules = await this.prisma.routingRule.findMany({
      where: { isActive: true },
      orderBy: { priorityOrder: 'asc' },
    });

    for (const rule of rules) {
      const conditions = rule.conditions as unknown as ConditionDto[];
      if (this.ruleMatches(conditions, ticket)) {
        const updateData: { assignedToId?: string; teamId?: string; status?: TicketStatus } = {};
        if (rule.assignToAgentId) {
          updateData.assignedToId = rule.assignToAgentId;
          if (ticket.status === TicketStatus.NEW) updateData.status = TicketStatus.ASSIGNED;
        }
        if (rule.assignToTeamId) updateData.teamId = rule.assignToTeamId;

        await this.prisma.ticket.update({ where: { id: ticket.id }, data: updateData });
        await this.prisma.auditLog.create({
          data: {
            ticketId: ticket.id,
            actorId: ticket.createdById,
            action: 'ASSIGNED',
            newValue: `routing-rule:${rule.id}`,
          },
        });
        return; // first match wins
      }
    }
  }
}
