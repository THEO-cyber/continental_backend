import { IsNotEmpty, IsString, MinLength } from 'class-validator';

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
