// backend/src/modules/routing/dto/create-routing-rule.dto.ts
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional,
  IsString, Min, ValidateNested,
} from 'class-validator';

export class ConditionDto {
  @IsIn(['category', 'channel', 'keyword']) field!: string;
  @IsIn(['eq', 'contains']) operator!: string;
  @IsString() @IsNotEmpty() value!: string;
}

export class CreateRoutingRuleDto {
  @IsInt() @Min(1) priorityOrder!: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ConditionDto) conditions!: ConditionDto[];
  @IsString() @IsOptional() assignToAgentId?: string;
  @IsString() @IsOptional() assignToTeamId?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
