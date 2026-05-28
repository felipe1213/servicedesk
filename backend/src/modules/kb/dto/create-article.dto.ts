import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { KbArticleStatus } from '@prisma/client';

export class CreateArticleDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @IsNotEmpty() body!: string;
  @IsArray() @IsString({ each: true }) @IsOptional() tags?: string[];
  @IsEnum(KbArticleStatus) @IsOptional() status?: KbArticleStatus;
}
