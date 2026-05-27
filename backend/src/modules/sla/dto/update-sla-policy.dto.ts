// backend/src/modules/sla/dto/update-sla-policy.dto.ts
import { IsEnum, IsInt, IsOptional, IsString, Min, IsNotEmpty } from 'class-validator';
import { BreachAction, Priority } from '@prisma/client';

export class UpdateSlaPolicyDto {
  @IsString() @IsNotEmpty() @IsOptional() name?: string;
  @IsEnum(Priority) @IsOptional() priorityLevel?: Priority;
  @IsInt() @Min(1) @IsOptional() responseTimeMinutes?: number;
  @IsInt() @Min(1) @IsOptional() resolutionTimeMinutes?: number;
  @IsEnum(BreachAction) @IsOptional() breachAction?: BreachAction;
  @IsString() @IsOptional() escalateToUserId?: string;
  @IsString() @IsOptional() escalateToTeamId?: string;
}
