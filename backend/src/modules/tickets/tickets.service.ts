import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaService } from '../sla/sla.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { FindTicketsQueryDto } from './dto/find-tickets-query.dto';
import { Prisma, Role, TicketStatus } from '@prisma/client';

type RequestUser = { id: string; role: Role };

const TICKET_INCLUDE = {
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  team: { select: { id: true, name: true } },
} as const;

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private slaService: SlaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreateTicketDto, userId: string) {
    const ticket = await this.prisma.ticket.create({
      data: { ...dto, createdById: userId, status: TicketStatus.NEW },
      include: TICKET_INCLUDE,
    });

    await this.prisma.auditLog.create({
      data: { ticketId: ticket.id, actorId: userId, action: 'CREATED', newValue: TicketStatus.NEW },
    });

    await this.slaService.stampDeadlines({
      id: ticket.id,
      priority: ticket.priority,
      createdAt: ticket.createdAt,
    });

    this.eventEmitter.emit('ticket.created', ticket);

    return ticket;
  }

  async findAll(user: RequestUser, query: FindTicketsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const skip = (page - 1) * limit;

    const where: Prisma.TicketWhereInput = {};
    if (user.role === Role.END_USER) where.createdById = user.id;
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: TICKET_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        ...TICKET_INCLUDE,
        comments: {
          include: { author: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
        auditLogs: {
          include: { actor: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();

    if (user.role === Role.END_USER) {
      ticket.comments = ticket.comments.filter((c) => !c.isInternal);
    }

    return ticket;
  }

  async update(id: string, dto: UpdateTicketDto, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();
    if (user.role === Role.END_USER && dto.assignedToId !== undefined) {
      throw new ForbiddenException('End users cannot assign tickets');
    }

    const autoAdvance = !!dto.assignedToId && ticket.status === TicketStatus.NEW;

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { ...dto, ...(autoAdvance ? { status: TicketStatus.ASSIGNED } : {}) },
      include: TICKET_INCLUDE,
    });

    const effectiveNewStatus = autoAdvance ? TicketStatus.ASSIGNED : dto.status;
    if (effectiveNewStatus && effectiveNewStatus !== ticket.status) {
      await this.prisma.auditLog.create({
        data: {
          ticketId: id,
          actorId: user.id,
          action: 'STATUS_CHANGED',
          oldValue: ticket.status,
          newValue: effectiveNewStatus,
        },
      });
      if (effectiveNewStatus === TicketStatus.RESOLVED) {
        this.eventEmitter.emit('ticket.resolved', {
          ticketId: id,
          title: updated.title,
          creatorId: ticket.createdById,
        });
      } else {
        this.eventEmitter.emit('ticket.status_changed', {
          ticketId: id,
          status: effectiveNewStatus,
          title: updated.title,
          creatorId: ticket.createdById,
          assignedToId: updated.assignedToId,
        });
      }
    }

    if (dto.assignedToId && dto.assignedToId !== ticket.assignedToId) {
      await this.prisma.auditLog.create({
        data: {
          ticketId: id,
          actorId: user.id,
          action: 'ASSIGNED',
          newValue: (updated.assignedTo as { name: string } | null)?.name ?? dto.assignedToId,
        },
      });
      this.eventEmitter.emit('ticket.assigned', {
        ticketId: id,
        assignedToId: dto.assignedToId,
        title: updated.title,
      });
    }

    return updated;
  }

  async addComment(ticketId: string, dto: CreateCommentDto, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();

    const isInternal = user.role !== Role.END_USER ? (dto.isInternal ?? false) : false;

    const comment = await this.prisma.comment.create({
      data: { ticketId, authorId: user.id, body: dto.body, isInternal },
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    if (!isInternal) {
      this.eventEmitter.emit('ticket.commented', {
        ticketId,
        commentId: comment.id,
        authorId: user.id,
        title: ticket.title,
        creatorId: ticket.createdById,
        assignedToId: ticket.assignedToId,
      });
    }

    return comment;
  }

  async getStats() {
    const [total, byStatus, byPriority] = await Promise.all([
      this.prisma.ticket.count(),
      this.prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['priority'], _count: { _all: true } }),
    ]);
    return { total, byStatus, byPriority };
  }
}
