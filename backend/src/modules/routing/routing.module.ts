// backend/src/modules/routing/routing.module.ts
import { Module } from '@nestjs/common';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';
import { RoutingListener } from './routing.listener';

@Module({
  controllers: [RoutingController],
  providers: [RoutingService, RoutingListener],
})
export class RoutingModule {}
