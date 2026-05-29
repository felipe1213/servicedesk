// backend/src/modules/notifications/notification.controller.ts
import { Controller, Get, Patch, Param, Query, Request } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';

type RequestUser = { id: string };

@Controller('notifications')
export class NotificationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getNotifications(
    @Request() req: { user: RequestUser },
    @Query() query: GetNotificationsQueryDto,
  ) {
    const limit = Math.min(query.limit ?? 50, 100);
    const where: Record<string, unknown> = { userId: req.user.id };
    if (query.unread === true) where.read = false;

    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  @Patch('read-all')
  async markAllRead(@Request() req: { user: RequestUser }) {
    await this.prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true },
    });
    return { success: true };
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    await this.prisma.notification.updateMany({
      where: { id, userId: req.user.id },
      data: { read: true },
    });
    return { success: true };
  }
}
