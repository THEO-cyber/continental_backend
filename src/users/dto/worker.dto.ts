import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWorkerDto {
  @IsString()
  @IsNotEmpty({ message: 'Name, username and password are required' })
  @MaxLength(100)
  name: string;

  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @Matches(/^[a-z0-9_.-]{3,30}$/, { message: 'Username: 3-30 characters, letters/numbers/._- only' })
  username: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  // Which branch this worker sells from. Optional: defaults to the shop's
  // first branch when there's only one location.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branch_id?: number;
}

export class PatchWorkerDto {
  @IsOptional()
  @Transform(({ value }) => (value === true || value === 1 || value === '1' ? 1 : 0))
  active?: number;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branch_id?: number;
}
