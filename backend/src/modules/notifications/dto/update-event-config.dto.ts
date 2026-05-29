import { IsObject } from 'class-validator';

export class UpdateEventConfigDto {
  @IsObject()
  toggles!: Record<string, boolean>;
}
