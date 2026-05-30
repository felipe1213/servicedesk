import { Injectable, NotFoundException } from '@nestjs/common';
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

  findAll() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, authProvider: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateRole(id: string, role: Role) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, name: true, email: true, role: true },
    });
  }
}
