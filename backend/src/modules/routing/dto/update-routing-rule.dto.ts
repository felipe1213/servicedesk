// backend/src/modules/routing/dto/update-routing-rule.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateRoutingRuleDto } from './create-routing-rule.dto';

export class UpdateRoutingRuleDto extends PartialType(CreateRoutingRuleDto) {}
