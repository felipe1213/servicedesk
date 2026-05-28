import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { ConnectorConfigService } from './connectors-config.service';
import { ConnectorsService } from './connectors.service';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { SyncSchedulerService } from './sync-scheduler.service';
import { SaveSharePointConfigDto, SaveConfluenceConfigDto, ExportArticleDto } from './dto/connector-config.dto';
import { ResolveConflictDto } from './dto/resolve-conflict.dto';

@Controller('connectors')
@Roles(Role.ADMIN)
export class ConnectorsController {
  constructor(
    private readonly configService: ConnectorConfigService,
    private readonly connectorsService: ConnectorsService,
    private readonly sharepoint: SharePointService,
    private readonly confluence: ConfluenceService,
    private readonly scheduler: SyncSchedulerService,
  ) {}

  @Get('sharepoint/config')
  getSharePointConfig() { return this.configService.getRedactedConfig('sharepoint'); }

  @Put('sharepoint/config')
  async saveSharePointConfig(@Body() dto: SaveSharePointConfigDto) {
    await this.configService.saveConfig('sharepoint', dto);
    await this.scheduler.registerSharePoint();
    return { ok: true };
  }

  @Post('sharepoint/test')
  testSharePoint() { return this.sharepoint.testConnection(); }

  @Post('sharepoint/sync')
  syncSharePoint() { return this.scheduler.runSharePoint(); }

  @Get('confluence/config')
  getConfluenceConfig() { return this.configService.getRedactedConfig('confluence'); }

  @Put('confluence/config')
  async saveConfluenceConfig(@Body() dto: SaveConfluenceConfigDto) {
    await this.configService.saveConfig('confluence', dto);
    await this.scheduler.registerConfluence();
    return { ok: true };
  }

  @Post('confluence/test')
  testConfluence() { return this.confluence.testConnection(); }

  @Post('confluence/sync')
  syncConfluence() { return this.scheduler.runConfluence(); }

  @Get('conflicts')
  listConflicts() { return this.connectorsService.listConflicts(); }

  @Post('conflicts/:articleId/resolve')
  resolveConflict(@Param('articleId') articleId: string, @Body() dto: ResolveConflictDto) {
    return this.connectorsService.resolveConflict(articleId, dto.resolution, dto.mergedBody);
  }

  @Get('logs')
  getLogs() { return this.connectorsService.getLogs(); }

  @Post('export/:articleId')
  @Roles(Role.ADMIN, Role.MANAGER)
  async exportArticle(@Param('articleId') articleId: string, @Body() dto: ExportArticleDto) {
    if (dto.connector === 'SHAREPOINT') {
      await this.sharepoint.exportArticle(articleId);
    } else {
      await this.confluence.exportArticle(articleId);
    }
    return { ok: true };
  }
}
