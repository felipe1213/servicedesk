// backend/src/modules/sla/sla.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { SlaService } from './sla.service';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';

@Controller('sla-policies')
@Roles(Role.ADMIN)
export class SlaController {
  constructor(private sla: SlaService) {}

  @Get()
  findAll() { return this.sla.findAll(); }

  @Post()
  create(@Body() dto: CreateSlaPolicyDto) { return this.sla.create(dto); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSlaPolicyDto) { return this.sla.update(id, dto); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.sla.remove(id); }
}
