import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { TicketsModule } from '../tickets/tickets.module';
import { KbController } from './kb.controller';
import { KbService } from './kb.service';

@Module({
  imports: [
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        node: config.get<string>('ELASTICSEARCH_URL', 'http://elasticsearch:9200'),
      }),
      inject: [ConfigService],
    }),
    TicketsModule,
  ],
  controllers: [KbController],
  providers: [KbService],
  exports: [KbService],
})
export class KbModule {}
