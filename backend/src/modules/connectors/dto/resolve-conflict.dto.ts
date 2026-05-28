import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ResolveConflictDto {
  @IsEnum(['LOCAL', 'REMOTE', 'MERGED']) resolution!: 'LOCAL' | 'REMOTE' | 'MERGED';
  @IsString() @IsOptional() mergedBody?: string;
}
