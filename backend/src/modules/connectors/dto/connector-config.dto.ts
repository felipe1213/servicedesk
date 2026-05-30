import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SaveSharePointConfigDto {
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsString() @IsNotEmpty() clientId!: string;
  @IsString() @IsNotEmpty() clientSecret!: string;
  @IsString() @IsNotEmpty() siteUrl!: string;
  @IsEnum(['library', 'pages']) syncType!: 'library' | 'pages';
  @IsString() @IsOptional() libraryName?: string;
  @IsString() @IsOptional() rootPageId?: string;
  @IsBoolean() enabled!: boolean;
  @IsNumber() @Min(1) syncIntervalMinutes!: number;
}

export class SaveConfluenceConfigDto {
  @IsString() @IsNotEmpty() baseUrl!: string;
  @IsString() @IsNotEmpty() email!: string;
  @IsString() @IsNotEmpty() apiToken!: string;
  @IsEnum(['space', 'pagetree']) syncType!: 'space' | 'pagetree';
  @IsString() @IsOptional() spaceKey?: string;
  @IsString() @IsOptional() rootPageId?: string;
  @IsBoolean() enabled!: boolean;
  @IsNumber() @Min(1) syncIntervalMinutes!: number;
}

export class ExportArticleDto {
  @IsEnum(['SHAREPOINT', 'CONFLUENCE']) connector!: 'SHAREPOINT' | 'CONFLUENCE';
}

export class SaveS3ConfigDto {
  @IsString() @IsNotEmpty() accessKeyId!: string;
  @IsString() @IsOptional() secretAccessKey?: string;
  @IsString() @IsNotEmpty() region!: string;
  @IsString() @IsNotEmpty() bucket!: string;
  @IsString() @IsOptional() prefix?: string;
  @IsBoolean() enabled!: boolean;
  @IsNumber() @Min(1) syncIntervalMinutes!: number;
}
