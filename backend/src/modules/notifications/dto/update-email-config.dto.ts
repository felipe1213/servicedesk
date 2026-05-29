import { IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateEmailConfigDto {
  @IsEnum(['SMTP', 'GRAPH', 'NONE'])
  transport!: 'SMTP' | 'GRAPH' | 'NONE';

  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() secure?: boolean;
  @IsOptional() @IsString() user?: string;
  @IsOptional() @IsString() pass?: string;

  @IsOptional() @IsEmail() fromAddress?: string;

  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
}
