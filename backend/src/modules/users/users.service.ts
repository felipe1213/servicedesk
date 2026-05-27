import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAgents() {
    return this.prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.MANAGER, Role.AGENT] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }
}
