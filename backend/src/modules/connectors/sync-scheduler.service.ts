import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { ConnectorConfigService } from './connectors-config.service';

@Injectable()
export class SyncSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncSchedulerService.name);
  private spTimer: NodeJS.Timeout | null = null;
  private cfTimer: NodeJS.Timeout | null = null;
  private spSyncing = false;
  private cfSyncing = false;

  constructor(
    private readonly sharepoint: SharePointService,
    private readonly confluence: ConfluenceService,
    private readonly configService: ConnectorConfigService,
  ) {}

  async onModuleInit() {
    await this.registerSharePoint();
    await this.registerConfluence();
  }

  onModuleDestroy() {
    if (this.spTimer) clearInterval(this.spTimer);
    if (this.cfTimer) clearInterval(this.cfTimer);
  }

  async registerSharePoint() {
    if (this.spTimer) clearInterval(this.spTimer);
    try {
      const config = await this.configService.getConfig('sharepoint');
      if (!config?.enabled) return;
      const ms = config.syncIntervalMinutes * 60 * 1000;
      this.spTimer = setInterval(() => this.runSharePoint(), ms);
      this.logger.log(`SharePoint sync scheduled every ${config.syncIntervalMinutes}min`);
    } catch (e) {
      this.logger.warn(`Could not register SharePoint scheduler: ${(e as Error).message}`);
    }
  }

  async registerConfluence() {
    if (this.cfTimer) clearInterval(this.cfTimer);
    try {
      const config = await this.configService.getConfig('confluence');
      if (!config?.enabled) return;
      const ms = config.syncIntervalMinutes * 60 * 1000;
      this.cfTimer = setInterval(() => this.runConfluence(), ms);
      this.logger.log(`Confluence sync scheduled every ${config.syncIntervalMinutes}min`);
    } catch (e) {
      this.logger.warn(`Could not register Confluence scheduler: ${(e as Error).message}`);
    }
  }

  async runSharePoint() {
    if (this.spSyncing) { this.logger.log('SharePoint sync already running, skipping'); return; }
    this.spSyncing = true;
    try { await this.sharepoint.sync(); } catch (e) { this.logger.error('SharePoint sync error', (e as Error).message); } finally { this.spSyncing = false; }
  }

  async runConfluence() {
    if (this.cfSyncing) { this.logger.log('Confluence sync already running, skipping'); return; }
    this.cfSyncing = true;
    try { await this.confluence.sync(); } catch (e) { this.logger.error('Confluence sync error', (e as Error).message); } finally { this.cfSyncing = false; }
  }
}
