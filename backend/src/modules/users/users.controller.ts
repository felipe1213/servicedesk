import { Controller, Get, Request, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { Role } from '@prisma/client';

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('agents')
  findAgents(@Request() req: { user: { id: string; role: Role } }) {
    if (req.user.role === Role.END_USER) throw new ForbiddenException();
    return this.users.findAgents();
  }
}
