import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const toFlag = ({ value }: { value: unknown }) =>
  value === 1 || value === true || value === '1' || value === 'true' ? 1 : 0;

export class PartNumberDto {
  @IsString()
  @IsNotEmpty({ message: 'Each part number needs a value' })
  @MaxLength(60)
  part_number: string;

  @Type(() => Number)
  @IsInt({ message: 'Each part number needs a non-negative quantity' })
  @Min(0, { message: 'Each part number needs a non-negative quantity' })
  quantity: number;

  @Type(() => Number)
  @IsInt({ message: 'Each part number needs a non-negative price' })
  @Min(0, { message: 'Each part number needs a non-negative price' })
  price: number;
}

// Product create/edit arrives as multipart/form-data (an image file rides
// along), so the part-numbers array can't travel as real JSON — the
// frontend JSON.stringifies it into one text field. Parsing *and*
// instantiating PartNumberDto happen in this one transform (rather than a
// plain @Transform feeding into a separate @Type(() => PartNumberDto)):
// stacking those two independently doesn't reliably produce populated
// instances here, silently leaving part_number/quantity undefined.
function parsePartNumbers({ value }: { value: unknown }) {
  const raw = typeof value === 'string' ? tryParseJson(value) : value;
  if (!Array.isArray(raw)) return value;
  return raw.map((item) => Object.assign(new PartNumberDto(), item));
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty({ message: 'name_en is required' })
  @MaxLength(200)
  name_en: string;

  @IsOptional() @IsString() @MaxLength(200) name_fr?: string = '';
  @IsOptional() @IsString() @MaxLength(200) name_zh?: string = '';
  @IsOptional() @IsString() @MaxLength(4000) desc_en?: string = '';
  @IsOptional() @IsString() @MaxLength(4000) desc_fr?: string = '';
  @IsOptional() @IsString() @MaxLength(4000) desc_zh?: string = '';
  @IsOptional() @IsString() @MaxLength(50) category?: string = 'accessories';
  @IsOptional() @IsString() @MaxLength(100) brand?: string = '';

  @Transform(parsePartNumbers)
  @IsArray({ message: 'At least one part number is required' })
  @ArrayMinSize(1, { message: 'At least one part number is required' })
  @ValidateNested({ each: true })
  part_numbers: PartNumberDto[];

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
  @IsString()
  @IsNotEmpty({ message: 'part_number is required' })
  part_number: string;

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
