import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { S3ConnectorService } from './s3.service';
import { ConnectorConfigService } from './connectors-config.service';

@Injectable()
export class SyncSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncSchedulerService.name);
  private spTimer: NodeJS.Timeout | null = null;
  private cfTimer: NodeJS.Timeout | null = null;
  private s3Timer: NodeJS.Timeout | null = null;
  private spSyncing = false;
  private cfSyncing = false;
  private s3Syncing = false;

  constructor(
    private readonly sharepoint: SharePointService,
    private readonly confluence: ConfluenceService,
    private readonly s3: S3ConnectorService,
    private readonly configService: ConnectorConfigService,
  ) {}

  async onModuleInit() {
    await this.registerSharePoint();
    await this.registerConfluence();
    await this.registerS3();
  }

  onModuleDestroy() {
    if (this.spTimer) clearInterval(this.spTimer);
    if (this.cfTimer) clearInterval(this.cfTimer);
    if (this.s3Timer) clearInterval(this.s3Timer);
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

  async registerS3() {
    if (this.s3Timer) clearInterval(this.s3Timer);
    try {
      const config = await this.configService.getConfig('s3');
      if (!config?.enabled) return;
      const ms = config.syncIntervalMinutes * 60 * 1000;
      this.s3Timer = setInterval(() => this.runS3(), ms);
      this.logger.log(`S3 sync scheduled every ${config.syncIntervalMinutes}min`);
    } catch (e) {
      this.logger.warn(`Could not register S3 scheduler: ${(e as Error).message}`);
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

  async runS3() {
    if (this.s3Syncing) { this.logger.log('S3 sync already running, skipping'); return; }
    this.s3Syncing = true;
    try { await this.s3.sync(); } catch (e) { this.logger.error('S3 sync error', (e as Error).message); } finally { this.s3Syncing = false; }
  }
}
