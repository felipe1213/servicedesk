import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { Priority, TicketStatus } from '@prisma/client';

export class UpdateTicketDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(Priority)
  @IsOptional()
  priority?: Priority;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @IsString()
  @IsOptional()
  assignedToId?: string;
}
