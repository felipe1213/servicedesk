import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { FindTicketsQueryDto } from './dto/find-tickets-query.dto';
import { Role } from '@prisma/client';

type RequestUser = { id: string; role: Role };

@Controller('tickets')
export class TicketsController {
  constructor(private tickets: TicketsService) {}

  @Post()
  create(@Body() dto: CreateTicketDto, @Request() req: { user: RequestUser }) {
    return this.tickets.create(dto, req.user.id);
  }

  @Get()
  findAll(@Request() req: { user: RequestUser }, @Query() query: FindTicketsQueryDto) {
    return this.tickets.findAll(req.user, query);
  }

  @Get('stats')
  getStats() {
    return this.tickets.getStats();
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.tickets.findOne(id, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @Request() req: { user: RequestUser }) {
    return this.tickets.update(id, dto, req.user);
  }

  @Post(':id/comments')
  addComment(@Param('id') ticketId: string, @Body() dto: CreateCommentDto, @Request() req: { user: RequestUser }) {
    return this.tickets.addComment(ticketId, dto, req.user);
  }
}
