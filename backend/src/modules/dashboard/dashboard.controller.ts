import { Body, Controller, Get, Param, ParseEnumPipe, Put, Request } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { SaveWidgetLayoutDto } from './dto/save-widget-layout.dto';

type RequestUser = { id: string; role: Role };

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('config')
  getConfig(@Request() req: { user: RequestUser }) {
    return this.dashboardService.getConfig(req.user.id, req.user.role);
  }

  @Put('config')
  saveConfig(@Request() req: { user: RequestUser }, @Body() dto: SaveWidgetLayoutDto) {
    return this.dashboardService.saveConfig(req.user.id, req.user.role, dto.widgets);
  }

  @Get('defaults/:role')
  @Roles(Role.ADMIN)
  getRoleDefault(@Param('role', new ParseEnumPipe(Role)) role: Role) {
    return this.dashboardService.getRoleDefault(role);
  }

  @Put('defaults/:role')
  @Roles(Role.ADMIN)
  saveRoleDefault(@Param('role', new ParseEnumPipe(Role)) role: Role, @Body() dto: SaveWidgetLayoutDto) {
    return this.dashboardService.saveRoleDefault(role, dto.widgets);
  }
}
