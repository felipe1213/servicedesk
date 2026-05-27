import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { Priority, Channel } from '@prisma/client';

export class CreateTicketDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  description!: string;

  @IsEnum(Priority)
  @IsOptional()
  priority?: Priority;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @IsEnum(Channel)
  sourceChannel!: Channel;
}
