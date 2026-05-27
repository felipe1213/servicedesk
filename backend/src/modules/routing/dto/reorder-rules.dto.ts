// backend/src/modules/routing/dto/reorder-rules.dto.ts
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class ReorderItemDto {
  @IsString() id!: string;
  @IsInt() @Min(1) priorityOrder!: number;
}

export class ReorderRulesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReorderItemDto) rules!: ReorderItemDto[];
}
