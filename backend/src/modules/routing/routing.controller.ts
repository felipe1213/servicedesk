// backend/src/modules/routing/routing.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { RoutingService } from './routing.service';
import { CreateRoutingRuleDto } from './dto/create-routing-rule.dto';
import { UpdateRoutingRuleDto } from './dto/update-routing-rule.dto';
import { ReorderRulesDto } from './dto/reorder-rules.dto';

@Controller('routing-rules')
@Roles(Role.ADMIN, Role.MANAGER)
export class RoutingController {
  constructor(private routing: RoutingService) {}

  @Get()
  findAll() { return this.routing.findAll(); }

  @Post()
  create(@Body() dto: CreateRoutingRuleDto) { return this.routing.create(dto); }

  @Patch('reorder')
  reorder(@Body() dto: ReorderRulesDto) { return this.routing.reorder(dto); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoutingRuleDto) { return this.routing.update(id, dto); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.routing.remove(id); }
}
