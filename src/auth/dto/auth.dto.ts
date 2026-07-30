import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Username and password are required' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: 'Username and password are required' })
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Current and new password are required' })
  current: string;

  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  next: string;
}

export class ChangeUsernameDto {
  @IsString()
  @IsNotEmpty({ message: 'Your current password is required' })
  password: string;

  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @Matches(/^[a-z0-9_.-]{3,30}$/, { message: 'Username: 3-30 characters, letters/numbers/._- only' })
  username: string;
}
