import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { InboundEmailConfigController } from './inbound-email-config.controller';
import { InboundEmailConfigService } from './inbound-email-config.service';
import { InboundEmailService } from './inbound-email.service';

@Module({
  imports: [PrismaModule, TicketsModule, AttachmentsModule],
  controllers: [InboundEmailConfigController],
  providers: [InboundEmailService, InboundEmailConfigService],
})
export class InboundEmailModule {}
