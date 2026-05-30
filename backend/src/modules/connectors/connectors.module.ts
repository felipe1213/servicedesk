import { Module } from '@nestjs/common';
import { KbModule } from '../kb/kb.module';
import { ConnectorConfigService } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';
import { S3ConnectorService } from './s3.service';
import { ConnectorsService } from './connectors.service';
import { SyncSchedulerService } from './sync-scheduler.service';
import { ConnectorsController } from './connectors.controller';

@Module({
  imports: [KbModule],
  controllers: [ConnectorsController],
  providers: [
    ConnectorConfigService,
    ContentConverterService,
    SharePointService,
    ConfluenceService,
    S3ConnectorService,
    ConnectorsService,
    SyncSchedulerService,
  ],
})
export class ConnectorsModule {}
