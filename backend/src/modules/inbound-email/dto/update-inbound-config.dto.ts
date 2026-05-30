import { IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateInboundTransportDto {
  @IsEnum(['IMAP', 'GRAPH', 'NONE'])
  transport!: 'IMAP' | 'GRAPH' | 'NONE';

  // IMAP fields — required when transport = IMAP
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() secure?: boolean;
  @IsOptional() @IsString() user?: string;
  @IsOptional() @IsString() pass?: string;
  @IsOptional() @IsString() mailbox?: string;

  // Graph fields — required when transport = GRAPH
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
  @IsOptional() @IsEmail() mailboxAddress?: string;
}

export class UpdateInboundAccessDto {
  @IsEnum(['ANYONE', 'DOMAINS', 'USERS'])
  mode!: 'ANYONE' | 'DOMAINS' | 'USERS';

  @IsOptional() @IsArray() @IsString({ each: true }) list?: string[];
}
