// backend/src/modules/notifications/notification-config.controller.ts
import { BadRequestException, Body, Controller, Get, Post, Put, Request } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmailService } from './email.service';
import { NotificationConfigService } from './notification-config.service';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';
import { UpdateEventConfigDto } from './dto/update-event-config.dto';

type RequestUser = { id: string; email: string };

@Controller('notifications')
export class NotificationConfigController {
  constructor(
    private readonly configService: NotificationConfigService,
    private readonly emailService: EmailService,
  ) {}

  @Get('config')
  @Roles(Role.ADMIN)
  getEventConfig() {
    return this.configService.getEventToggles();
  }

  @Put('config')
  @Roles(Role.ADMIN)
  updateEventConfig(@Body() dto: UpdateEventConfigDto) {
    return this.configService.updateEventToggles(dto.toggles);
  }

  @Get('email-config')
  @Roles(Role.ADMIN)
  getEmailConfig() {
    return this.configService.getRedactedEmailConfig();
  }

  @Put('email-config')
  @Roles(Role.ADMIN)
  saveEmailConfig(@Body() dto: UpdateEmailConfigDto) {
    return this.configService.saveEmailConfig(dto);
  }

  @Post('email-config/test')
  @Roles(Role.ADMIN)
  async testEmailConfig(@Request() req: { user: RequestUser }) {
    const { transport } = await this.configService.getEmailConfig();
    if (transport === 'NONE') {
      throw new BadRequestException('Email transport not configured');
    }
    await this.emailService.send(
      req.user.email,
      'Service Desk — Test Email',
      'This is a test email from the Service Desk notification system.',
    );
    return { success: true };
  }
}
