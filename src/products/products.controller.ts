import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put,
  Query, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDto, StockDto, UpdateProductDto } from './dto/product.dto';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';

// Superadmin has full control (edit/delete/stock/approve). Workers may only
// submit new inventory items (POST) for review — never edit an existing
// listing or remove one, so the superadmin isn't the sole person who can
// grow the catalog, but stays the sole one who can change or retire what's
// already listed, and the sole one who decides what goes live.
@Controller('api/admin/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Roles('superadmin')
  list(
    @Query('search') search = '',
    @Query('category') category = '',
    @Query('branchId') branchId?: string,
    @Query('stock') stock?: string,
  ) {
    return this.products.list(search, category, { branchId: branchId || undefined, stock });
  }

  @Get('pending')
  @Roles('superadmin')
  pending() {
    return this.products.pendingList();
  }

  @Post(':id/approve')
  @Roles('superadmin')
  approve(@Param('id') id: string) {
    return this.products.approve(id);
  }

  @Post(':id/reject')
  @Roles('superadmin')
  reject(@Param('id') id: string) {
    return this.products.reject(id);
  }

  @Post()
  @Roles('superadmin', 'worker')
  @UseInterceptors(FileInterceptor('image'))
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthUser,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.products.create(dto, image, user);
  }

  @Put(':id')
  @Roles('superadmin')
  @UseInterceptors(FileInterceptor('image'))
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.products.update(id, dto, image);
  }

  @Patch(':id/stock')
  @Roles('superadmin')
  stock(@Param('id') id: string, @Body() dto: StockDto) {
    return this.products.adjustStock(id, dto);
  }

  // Bulk delete: all products, or every product in one category when
  // ?category= is given. Distinct from DELETE /:id below (no extra path
  // segment), so routing never confuses the two.
  @Delete()
  @Roles('superadmin')
  removeAll(@Query('category') category?: string) {
    return this.products.removeAll(category);
  }

  @Delete(':id')
  @Roles('superadmin')
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }
}
