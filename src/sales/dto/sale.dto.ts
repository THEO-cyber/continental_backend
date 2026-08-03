import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class RecordSaleDto {
  @IsMongoId({ message: 'A product and a quantity of at least 1 are required' })
  product_id: string;

  // Which of the product's part numbers the stock comes off of.
  @IsString()
  @IsNotEmpty({ message: 'A part number is required' })
  part_number: string;

  @Type(() => Number)
  @IsInt({ message: 'A product and a quantity of at least 1 are required' })
  @Min(1, { message: 'A product and a quantity of at least 1 are required' })
  quantity: number;

  // The price actually sold at — parts prices are negotiated/vary, so this is
  // not locked to the product's reference price. Falls back to it when omitted.
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Sale price must be a non-negative number' })
  @Min(0, { message: 'Sale price must be a non-negative number' })
  unit_price?: number;
}
