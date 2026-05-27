// backend/src/modules/sla/dto/create-sla-policy.dto.ts
import { IsEnum, IsInt, IsOptional, IsString, Min, IsNotEmpty } from 'class-validator';
import { BreachAction, Priority } from '@prisma/client';

export class CreateSlaPolicyDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsEnum(Priority) priorityLevel!: Priority;
  @IsInt() @Min(1) responseTimeMinutes!: number;
  @IsInt() @Min(1) resolutionTimeMinutes!: number;
  @IsEnum(BreachAction) @IsOptional() breachAction?: BreachAction;
  @IsString() @IsOptional() escalateToUserId?: string;
  @IsString() @IsOptional() escalateToTeamId?: string;
}
