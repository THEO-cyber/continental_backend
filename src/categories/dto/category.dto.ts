import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty({ message: 'Category name is required' })
  @MaxLength(60)
  name_en: string;

  @IsOptional() @IsString() @MaxLength(60) name_fr?: string;
  @IsOptional() @IsString() @MaxLength(60) name_zh?: string;
}
