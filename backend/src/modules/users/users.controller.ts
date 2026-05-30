import { Body, Controller, Get, Param, Patch, Request, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { IsEnum } from 'class-validator';

class UpdateRoleDto {
  @IsEnum(Role)
  role!: Role;
}

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('agents')
  findAgents(@Request() req: { user: { id: string; role: Role } }) {
    if (req.user.role === Role.END_USER) throw new ForbiddenException();
    return this.users.findAgents();
  }

  @Get()
  @Roles(Role.ADMIN)
  findAll() {
    return this.users.findAll();
  }

  @Patch(':id/role')
  @Roles(Role.ADMIN)
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.users.updateRole(id, dto.role);
  }
}
