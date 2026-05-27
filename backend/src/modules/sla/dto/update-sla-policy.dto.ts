import { PartialType } from '@nestjs/mapped-types';
import { CreateSlaPolicyDto } from './create-sla-policy.dto';

export class UpdateSlaPolicyDto extends PartialType(CreateSlaPolicyDto) {}
