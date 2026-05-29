import { IsArray, IsBoolean, IsEnum, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { WidgetId, WIDGET_IDS } from '../dashboard.service';

export { WidgetId };

export class WidgetConfigItemDto {
  @IsEnum(WIDGET_IDS)
  id!: WidgetId;

  @IsBoolean()
  visible!: boolean;

  @IsInt()
  @Min(0)
  order!: number;
}

export class SaveWidgetLayoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WidgetConfigItemDto)
  widgets!: WidgetConfigItemDto[];
}
