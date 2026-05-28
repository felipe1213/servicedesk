import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SaveSharePointConfigDto {
  @IsString() tenantId!: string;
  @IsString() clientId!: string;
  @IsString() clientSecret!: string;
  @IsString() siteUrl!: string;
  @IsEnum(['library', 'pages']) syncType!: 'library' | 'pages';
  @IsString() @IsOptional() libraryName?: string;
  @IsString() @IsOptional() rootPageId?: string;
  @IsBoolean() enabled!: boolean;
  @IsNumber() @Min(1) syncIntervalMinutes!: number;
}

export class SaveConfluenceConfigDto {
  @IsString() baseUrl!: string;
  @IsString() email!: string;
  @IsString() apiToken!: string;
  @IsEnum(['space', 'pagetree']) syncType!: 'space' | 'pagetree';
  @IsString() @IsOptional() spaceKey?: string;
  @IsString() @IsOptional() rootPageId?: string;
  @IsBoolean() enabled!: boolean;
  @IsNumber() @Min(1) syncIntervalMinutes!: number;
}
