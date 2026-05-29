// backend/src/modules/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailService } from './email.service';
import { NotificationConfigController } from './notification-config.controller';
import { NotificationConfigService } from './notification-config.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationController, NotificationConfigController],
  providers: [NotificationService, NotificationConfigService, EmailService],
})
export class NotificationsModule {}
