import { Controller } from '@nestjs/common';
import { KbService } from './kb.service';

@Controller('kb')
export class KbController {
  constructor(private readonly kb: KbService) {}
}
