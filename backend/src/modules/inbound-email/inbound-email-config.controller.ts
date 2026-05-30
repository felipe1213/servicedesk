import { BadRequestException, Body, Controller, Get, Put, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { InboundEmailConfigService } from './inbound-email-config.service';
import { InboundEmailService } from './inbound-email.service';
import { UpdateInboundTransportDto, UpdateInboundAccessDto } from './dto/update-inbound-config.dto';

@Controller('inbound-email')
export class InboundEmailConfigController {
  constructor(
    private readonly configService: InboundEmailConfigService,
    private readonly inboundEmailService: InboundEmailService,
  ) {}

  @Get('config')
  @Roles(Role.ADMIN)
  getConfig() {
    return this.configService.getRedactedConfig();
  }

  @Put('config')
  @Roles(Role.ADMIN)
  saveConfig(@Body() dto: UpdateInboundTransportDto) {
    return this.configService.saveConfig(dto);
  }

  @Get('access')
  @Roles(Role.ADMIN)
  getAccess() {
    return this.configService.getAccessControl();
  }

  @Put('access')
  @Roles(Role.ADMIN)
  saveAccess(@Body() dto: UpdateInboundAccessDto) {
    return this.configService.saveAccessControl(dto);
  }

  @Post('test')
  @Roles(Role.ADMIN)
  async testPoll() {
    const { transport } = await this.configService.getConfig();
    if (transport === 'NONE') {
      throw new BadRequestException('Inbound email transport not configured');
    }
    return this.inboundEmailService.pollOnce();
  }
}
