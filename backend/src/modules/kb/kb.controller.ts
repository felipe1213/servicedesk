import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Request,
} from '@nestjs/common';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DeflectionType, Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { KbService } from './kb.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

class DeflectDto {
  @IsEnum(DeflectionType) type!: DeflectionType;
  @IsString() @IsOptional() ticketId?: string;
}

type RequestUser = { id: string; role: Role };

@Controller('kb')
export class KbController {
  constructor(private readonly kb: KbService) {}

  @Get()
  findAll(@Request() req: { user: RequestUser }) {
    return this.kb.findAll(req.user);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  create(@Body() dto: CreateArticleDto, @Request() req: { user: RequestUser }) {
    return this.kb.create(dto, req.user);
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.kb.search(q ?? '');
  }

  @Get('suggest')
  @Roles(Role.AGENT, Role.MANAGER, Role.ADMIN)
  suggest(@Query('ticketId') ticketId: string) {
    return this.kb.suggest(ticketId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.kb.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  update(@Param('id') id: string, @Body() dto: UpdateArticleDto) {
    return this.kb.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.kb.remove(id);
  }

  @Post(':id/deflect')
  deflect(
    @Param('id') articleId: string,
    @Body() dto: DeflectDto,
    @Request() req: { user: RequestUser },
  ) {
    return this.kb.deflect(articleId, dto.ticketId, dto.type, req.user);
  }
}
