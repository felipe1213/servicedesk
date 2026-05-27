import { IsString, IsBoolean, IsOptional } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  body!: string;

  @IsBoolean()
  @IsOptional()
  isInternal?: boolean;
}
