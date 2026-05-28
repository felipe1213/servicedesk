import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ResolveConflictDto {
  @IsEnum(['LOCAL', 'REMOTE', 'MERGED']) resolution!: 'LOCAL' | 'REMOTE' | 'MERGED';
  @IsString() @IsNotEmpty() @IsOptional() mergedBody?: string;
}
