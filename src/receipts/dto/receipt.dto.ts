import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

class ReceiptItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  product_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  product_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @Type(() => Number)
  @IsInt({ message: 'Each item needs a quantity of at least 1' })
  @Min(1, { message: 'Each item needs a quantity of at least 1' })
  @Max(100000)
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Item price must be a non-negative number' })
  @Min(0, { message: 'Item price must be a non-negative number' })
  unit_price?: number;
}

export class CreateReceiptDto {
  @IsIn(['company', 'individual'], { message: 'buyer_type must be "company" or "individual"' })
  buyer_type: string;

  @IsString()
  @IsNotEmpty({ message: 'Buyer name is required' })
  @MaxLength(150)
  buyer_name: string;

  @IsOptional() @IsString() @MaxLength(40) buyer_phone?: string;
  @IsOptional() @IsString() @MaxLength(300) buyer_address?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one item is required' })
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items: ReceiptItemDto[];
}
