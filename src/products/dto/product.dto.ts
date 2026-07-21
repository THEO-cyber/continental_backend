import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const toFlag = ({ value }: { value: unknown }) =>
  value === 1 || value === true || value === '1' || value === 'true' ? 1 : 0;

export class CreateProductDto {
  @IsString()
  @IsNotEmpty({ message: 'name_en is required' })
  @MaxLength(200)
  name_en: string;

  @IsOptional() @IsString() @MaxLength(200) name_fr?: string = '';
  @IsOptional() @IsString() @MaxLength(200) name_zh?: string = '';
  @IsOptional() @IsString() @MaxLength(2000) desc_en?: string = '';
  @IsOptional() @IsString() @MaxLength(2000) desc_fr?: string = '';
  @IsOptional() @IsString() @MaxLength(2000) desc_zh?: string = '';
  @IsOptional() @IsString() @MaxLength(50) category?: string = 'accessories';
  @IsOptional() @IsString() @MaxLength(100) brand?: string = '';
  @IsOptional() @IsString() @MaxLength(60) sku?: string = '';

  @Type(() => Number)
  @IsInt({ message: 'price must be a non-negative number' })
  @Min(0, { message: 'price must be a non-negative number' })
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'quantity must be a non-negative number' })
  @Min(0, { message: 'quantity must be a non-negative number' })
  quantity?: number = 0;

  @IsOptional()
  @Transform(toFlag)
  published?: number = 1;

  // Which branch this stock belongs to. Optional: superadmin defaults to the
  // first branch when omitted; workers can never choose — it's forced to
  // their own branch regardless of what's sent here.
  @IsOptional()
  @IsMongoId()
  branch_id?: string;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class StockDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Resulting quantity must be a non-negative number' })
  delta?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Resulting quantity must be a non-negative number' })
  @Min(0, { message: 'Resulting quantity must be a non-negative number' })
  quantity?: number;
}
