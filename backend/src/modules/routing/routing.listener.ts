// backend/src/modules/routing/routing.listener.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RoutingService } from './routing.service';

@Injectable()
export class RoutingListener {
  private readonly logger = new Logger(RoutingListener.name);

  constructor(private routing: RoutingService) {}

  @OnEvent('ticket.created')
  async handle(ticket: any) {
    try {
      await this.routing.applyRules(ticket);
    } catch (err) {
      this.logger.error(`Routing failed for ticket ${ticket?.id}`, err);
    }
  }
}
