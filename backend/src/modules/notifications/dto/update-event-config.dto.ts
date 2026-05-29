import { IsObject } from 'class-validator';

export class UpdateEventConfigDto {
  // @IsObject() confirms shape; value types not validated at DTO level (ADMIN-only endpoint,
  // service filters to known keys and coerces values via boolean truthiness)
  @IsObject()
  toggles!: Record<string, boolean>;
}
