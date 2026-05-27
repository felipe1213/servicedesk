import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { MINIO_CLIENT } from './attachments.constants';

@Module({
  controllers: [AttachmentsController],
  providers: [
    {
      provide: MINIO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const raw = config.get<string>('MINIO_ENDPOINT', 'http://minio:9000');
        const url = new URL(raw);
        return new Minio.Client({
          endPoint: url.hostname,
          port: parseInt(url.port || '9000', 10),
          useSSL: url.protocol === 'https:',
          accessKey: config.get<string>('MINIO_ROOT_USER', 'minioadmin'),
          secretKey: config.get<string>('MINIO_ROOT_PASSWORD', 'minioadmin'),
        });
      },
    },
    AttachmentsService,
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
